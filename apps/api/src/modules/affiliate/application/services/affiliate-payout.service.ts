import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { AffiliateEncryptionService } from './affiliate-encryption.service';
// Phase 159f — reuse the pure Form 16A template (no cross-module DI).
import {
  renderForm16AHtml,
  Form16AInput,
} from '../../../tax/domain/form-16a-template';
// Phase 159g — shared CSV escaper (RFC 4180 + formula-injection guard).
import { escapeCsvField } from '../../../../core/utils/csv.util';

/**
 * Manual payout flow per SRS §15.
 *
 * Phase 1 scope:
 *   - addPayoutMethod / listPayoutMethods (affiliate)
 *   - requestPayout (bundles all CONFIRMED commissions)
 *   - admin approve → mark paid → mark failed
 *
 * Phase 2 additions (now in scope):
 *   - TDS auto-deduction at request time. The regime is finance-
 *     configurable (AffiliateSettings.tdsSection), implementing internal
 *     SRS §16:
 *       • '194O' (DEFAULT — IT-Act Section 194-O, e-commerce
 *         participant): per-payout, PAN-aware — 1% with PAN on file, 5%
 *         without (§194-O(4)); quarterly Form 26Q / Form 16A lifecycle.
 *       • '194H' (IT-Act Section 194H, commission/brokerage): 10% on the
 *         FY cumulative slice above ₹15,000; §206AA escalates a PAN-less
 *         deductee to 20%.
 *     ("§16" here is the internal SRS section, NOT an IT-Act section.)
 *   - Reversal-balance netting per §13.4 — REVERSED commissions are
 *     deducted from the next payout until cleared.
 *
 * Still out of scope:
 *   - Bank-transfer adapter (admin still marks paid manually).
 */
@Injectable()
export class AffiliatePayoutService {
  private readonly logger = new Logger(AffiliatePayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: AffiliateEncryptionService,
    // Phase 154 — KYC-gate feature flag + audit trail + finance notification.
    private readonly env: EnvService,
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Payout methods (affiliate) ──────────────────────────────

  async addPayoutMethod(input: {
    affiliateId: string;
    type: 'BANK' | 'UPI';
    accountNumber?: string;
    ifscCode?: string;
    accountHolderName?: string;
    bankName?: string;
    upiId?: string;
    setPrimary?: boolean;
  }) {
    if (input.type === 'BANK') {
      if (!input.accountNumber || !input.ifscCode || !input.accountHolderName) {
        throw new BadRequestAppException(
          'Bank account number, IFSC, and account holder name are required.',
        );
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(input.ifscCode)) {
        throw new BadRequestAppException(
          'IFSC must be 11 chars: 4 letters, 0, 6 alphanumeric (e.g. HDFC0001234)',
        );
      }
    } else if (input.type === 'UPI') {
      if (!input.upiId || !/^[\w.-]+@[\w.-]+$/.test(input.upiId)) {
        throw new BadRequestAppException('Provide a valid UPI ID (e.g. name@upi)');
      }
    } else {
      throw new BadRequestAppException(`Unsupported payout method type: ${input.type}`);
    }

    const acctEnc = input.accountNumber ? this.encryption.encrypt(input.accountNumber) : null;

    return this.prisma.$transaction(async (tx) => {
      // SRS §5.3 — multiple methods allowed; one is primary. If the
      // caller asked for primary OR this is the first method, demote
      // any existing primaries and crown this one.
      const existingCount = await tx.affiliatePayoutMethodRecord.count({
        where: { affiliateId: input.affiliateId },
      });
      const shouldBePrimary = input.setPrimary || existingCount === 0;
      if (shouldBePrimary) {
        await tx.affiliatePayoutMethodRecord.updateMany({
          where: { affiliateId: input.affiliateId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const created = await tx.affiliatePayoutMethodRecord.create({
        data: {
          affiliateId: input.affiliateId,
          type: input.type,
          accountNumberEnc: acctEnc?.enc ?? null,
          accountNumberIv: acctEnc?.iv ?? null,
          accountLast4: input.accountNumber
            ? this.encryption.last4(input.accountNumber)
            : null,
          ifscCode: input.ifscCode?.toUpperCase() ?? null,
          accountHolderName: input.accountHolderName ?? null,
          bankName: input.bankName ?? null,
          upiId: input.upiId ?? null,
          isPrimary: shouldBePrimary,
          // Self-added methods aren't auto-verified — admin (or a
          // payout-gateway probe in Phase 2) marks them isVerified.
          isVerified: false,
        },
      });
      return this.toPublicMethod(created);
    });
  }

  async listPayoutMethods(affiliateId: string) {
    const methods = await this.prisma.affiliatePayoutMethodRecord.findMany({
      where: { affiliateId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
    return methods.map((m) => this.toPublicMethod(m));
  }

  async setPrimaryMethod(affiliateId: string, methodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.affiliatePayoutMethodRecord.findUnique({
        where: { id: methodId },
        select: { id: true, affiliateId: true },
      });
      if (!m || m.affiliateId !== affiliateId) {
        throw new NotFoundAppException('Payout method not found');
      }
      await tx.affiliatePayoutMethodRecord.updateMany({
        where: { affiliateId, isPrimary: true },
        data: { isPrimary: false },
      });
      const updated = await tx.affiliatePayoutMethodRecord.update({
        where: { id: methodId },
        data: { isPrimary: true },
      });
      return this.toPublicMethod(updated);
    });
  }

  // ── Payout requests (affiliate) ─────────────────────────────

  /**
   * Affiliate requests a withdrawal. Bundles ALL their currently-
   * CONFIRMED commissions (per SRS §15.1) into a new request and
   * locks them by setting `payoutRequestId`. Status stays CONFIRMED
   * until admin marks the request PAID.
   *
   * Phase 2 — also nets unsettled REVERSED commissions (clawbacks
   * from post-payout returns, SRS §13.4) and deducts TDS per the
   * finance-configured regime (default §194-O, 1%/5% PAN-aware;
   * §194H is the switchable alternative — see the class docstring).
   *
   * Eligibility (SRS §15.1):
   *   - affiliate.status === 'ACTIVE'
   *   - kycStatus === 'VERIFIED'
   *   - at least one primary payout method
   *   - balance after reversal-netting ≥ ₹500
   */
  async requestPayout(input: {
    affiliateId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const MIN_PAYOUT = new Prisma.Decimal(500);
    const ZERO = new Prisma.Decimal(0);
    // Phase 159e — TDS rate/section/threshold are NO LONGER hardcoded here;
    // they're read from AffiliateSettings inside the tx below (default §194-O).

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: input.affiliateId },
      select: { id: true, status: true, kycStatus: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');

    if (affiliate.status !== 'ACTIVE') {
      throw new ForbiddenAppException('Only ACTIVE affiliates can request payouts.');
    }
    // Phase 154 — KYC gate (PMLA / RBI: KYC before paying out). Enforced by
    // default; the product can explicitly pause it by setting
    // AFFILIATE_KYC_GATE_ENABLED='false'. Default-ON closes the regulatory gap
    // the audit flagged (the block was previously commented out).
    if (
      this.env.getBoolean('AFFILIATE_KYC_GATE_ENABLED', true) &&
      affiliate.kycStatus !== 'VERIFIED'
    ) {
      throw new ForbiddenAppException(
        'Please complete KYC verification before requesting a payout.',
      );
    }

    // Phase 154 — require a VERIFIED primary method + pull the fields we'll
    // snapshot onto the request (so a later edit/delete can't redirect money).
    const primary = await this.prisma.affiliatePayoutMethodRecord.findFirst({
      where: { affiliateId: input.affiliateId, isPrimary: true, isVerified: true },
      select: {
        id: true,
        type: true,
        accountLast4: true,
        ifscCode: true,
        accountHolderName: true,
        bankName: true,
        upiId: true,
      },
    });
    if (!primary) {
      throw new BadRequestAppException(
        'Add and verify a primary bank account or UPI before requesting a payout.',
      );
    }
    const methodSnapshot = {
      type: primary.type,
      accountLast4: primary.accountLast4 ?? null,
      ifscCode: primary.ifscCode ?? null,
      accountHolderName: primary.accountHolderName ?? null,
      bankName: primary.bankName ?? null,
      upiId: primary.upiId ?? null,
    };

    const fy = this.currentFinancialYear();

    const request = await this.prisma.$transaction(async (tx) => {
      const eligible = await tx.affiliateCommission.findMany({
        where: {
          affiliateId: input.affiliateId,
          status: 'CONFIRMED',
          payoutRequestId: null,
        },
        select: { id: true, adjustedAmount: true },
      });
      const reversedUnsettled = await tx.affiliateCommission.findMany({
        where: {
          affiliateId: input.affiliateId,
          status: 'REVERSED',
          reversalNettedInPayoutRequestId: null,
        },
        select: { id: true, adjustedAmount: true },
      });

      if (eligible.length === 0) {
        if (reversedUnsettled.length > 0) {
          throw new BadRequestAppException(
            'You have pending reversal debits but no confirmed commissions to net them against. Earn more commissions to clear the balance.',
          );
        }
        throw new BadRequestAppException(
          'No confirmed commissions available for payout right now.',
        );
      }

      const grossAmount = eligible.reduce(
        (acc, c) => acc.plus(c.adjustedAmount),
        ZERO,
      );
      const reversalDebit = reversedUnsettled.reduce(
        (acc, c) => acc.plus(c.adjustedAmount),
        ZERO,
      );
      const grossAfterReversal = grossAmount.minus(reversalDebit);
      if (grossAfterReversal.lessThan(MIN_PAYOUT)) {
        const note = reversalDebit.greaterThan(0)
          ? ` (after deducting ₹${reversalDebit.toString()} in reversed commissions)`
          : '';
        throw new BadRequestAppException(
          `Minimum payout balance is ₹${MIN_PAYOUT.toString()}. Current eligible balance is ₹${grossAfterReversal.toString()}${note}.`,
        );
      }

      // ── TDS deduction (Phase 159e — §194-O default, config-driven) ──
      // Section lives in AffiliateSettings so the §194H↔§194-O determination
      // is a finance decision, not a code change. Both rate + threshold are
      // read from settings (the §194H rate was previously a hardcoded 0.10).
      const settings = await tx.affiliateSettings.findUnique({
        where: { id: 'singleton' },
        select: {
          tdsSection: true,
          tdsRate: true,
          tdsThresholdPerFY: true,
          tdsRateWithPanBps: true,
          tdsRateWithoutPanBps: true,
        },
      });
      const tdsSection = settings?.tdsSection ?? '194O';
      const filingQuarter = this.currentFilingQuarter();

      let tdsAmount: Prisma.Decimal;
      let tdsRateBps: number;
      // PAN status is needed by BOTH regimes now: §194-O picks 1% vs 5%,
      // §194H applies the §206AA 20% escalation when no PAN is furnished.
      const kyc = await tx.affiliateKyc.findUnique({
        where: { affiliateId: input.affiliateId },
        select: { panNumberEnc: true, panLast4: true },
      });
      const panOnFile = !!kyc?.panNumberEnc;
      const panLast4: string | null = kyc?.panLast4 ?? null;

      if (tdsSection === '194O') {
        // §194-O e-commerce-participant TDS: PER-TRANSACTION, NO threshold,
        // PAN-aware. PAN "furnished" (present on the KYC row) → 1%, else 5%
        // (§194-O(4); a PAN-less §194-O deductee is capped at 5%, NOT the
        // §206AA 20% — §194-O has its own no-PAN rate).
        tdsRateBps = panOnFile
          ? settings?.tdsRateWithPanBps ?? 100
          : settings?.tdsRateWithoutPanBps ?? 500;
        tdsAmount = new Prisma.Decimal(
          grossAmount.mul(tdsRateBps).div(10000).toFixed(2),
        );
      } else {
        // §194H commission/brokerage: cumulative FY slice above the threshold,
        // rate + threshold from settings. In-flight aggregation prevents two
        // concurrent withdrawals from both reclaiming the same headroom.
        //
        // §206AA escalation (audit B6): a deductee who has NOT furnished a PAN
        // is withheld at the HIGHER of the in-force rate and 20%. With no PAN
        // on file we floor the rate at 20% so a PAN-less affiliate isn't
        // under-withheld (a statutory + recovery exposure for the platform).
        const SECTION_206AA_FLOOR_PCT = new Prisma.Decimal(20);
        const configuredRatePct = new Prisma.Decimal(settings?.tdsRate ?? 10);
        const effectiveRatePct = panOnFile
          ? configuredRatePct
          : Prisma.Decimal.max(configuredRatePct, SECTION_206AA_FLOOR_PCT);
        const rate = effectiveRatePct.div(100);
        const threshold = new Prisma.Decimal(settings?.tdsThresholdPerFY ?? 15000);
        tdsRateBps = Number(effectiveRatePct.mul(100).toFixed(0));
        const tdsRecord = await tx.affiliateTdsRecord.findUnique({
          where: {
            affiliateId_financialYear: {
              affiliateId: input.affiliateId,
              financialYear: fy,
            },
          },
        });
        const paidGross = tdsRecord?.cumulativeGross ?? ZERO;
        const paidTds = tdsRecord?.cumulativeTds ?? ZERO;
        const inflight = await tx.affiliatePayoutRequest.aggregate({
          where: {
            affiliateId: input.affiliateId,
            financialYear: fy,
            status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
          },
          _sum: { grossAmount: true, tdsAmount: true },
        });
        const inflightGross = inflight._sum.grossAmount ?? ZERO;
        const inflightTds = inflight._sum.tdsAmount ?? ZERO;
        const cumulativeGrossAfter = paidGross.plus(inflightGross).plus(grossAmount);
        const taxable = cumulativeGrossAfter.minus(threshold);
        const expectedTotalTds = taxable.greaterThan(0) ? taxable.mul(rate) : ZERO;
        const alreadyDeductedTds = paidTds.plus(inflightTds);
        const tdsCandidate = expectedTotalTds.minus(alreadyDeductedTds);
        tdsAmount = new Prisma.Decimal(
          (tdsCandidate.greaterThan(0) ? tdsCandidate : ZERO).toFixed(2),
        );
      }

      const netAmount = grossAmount.minus(reversalDebit).minus(tdsAmount);

      const request = await tx.affiliatePayoutRequest.create({
        data: {
          affiliateId: input.affiliateId,
          payoutMethodId: primary.id,
          grossAmount,
          reversalDebit,
          tdsAmount,
          netAmount,
          financialYear: fy,
          // Phase 159e — frozen TDS snapshot. panOnFileAtDeduction is now
          // recorded for BOTH regimes (§194-O rate selection AND §194H §206AA
          // escalation depend on it, so it's audit-relevant either way).
          tdsSection,
          tdsRateBps,
          panOnFileAtDeduction: panOnFile,
          filingQuarter,
          status: 'REQUESTED',
          // Phase 154 — immutable method snapshot (method-as-of-request-time).
          payoutMethodType: primary.type,
          payoutMethodSnapshot: methodSnapshot,
        },
      });

      // Phase 159e — §194-O per-payout ledger entry (COMPUTED now; flipped to
      // WITHHELD at mark-paid). Quarterly Form-26Q export aggregates these.
      if (tdsSection === '194O' && tdsAmount.greaterThan(0)) {
        await tx.affiliateTds194OLedger.create({
          data: {
            affiliateId: input.affiliateId,
            payoutRequestId: request.id,
            filingPeriod: filingQuarter,
            panLast4,
            hadPanOnFile: panOnFile,
            grossInPaise: BigInt(grossAmount.mul(100).toFixed(0)),
            tdsInPaise: BigInt(tdsAmount.mul(100).toFixed(0)),
            tdsRateBps,
            status: 'COMPUTED',
          },
        });
      }

      // Phase 154 — claim the commissions with a status-CAS: the WHERE re-asserts
      // payoutRequestId:null + CONFIRMED, so a concurrent request that grabbed
      // some of these rows between the SELECT and here lowers the count → we
      // throw and the whole transaction rolls back (no overlapping claims, and
      // the stored grossAmount always matches the commissions pointing at it).
      const eligibleIds = eligible.map((c) => c.id);
      const claimed = await tx.affiliateCommission.updateMany({
        where: { id: { in: eligibleIds }, payoutRequestId: null, status: 'CONFIRMED' },
        data: { payoutRequestId: request.id },
      });
      if (claimed.count !== eligibleIds.length) {
        throw new ConflictAppException(
          'Some commissions were claimed by a concurrent payout request. ' +
            'No request was created — refresh and try again.',
        );
      }

      if (reversedUnsettled.length > 0) {
        const reversedIds = reversedUnsettled.map((c) => c.id);
        const netted = await tx.affiliateCommission.updateMany({
          where: {
            id: { in: reversedIds },
            status: 'REVERSED',
            reversalNettedInPayoutRequestId: null,
          },
          data: { reversalNettedInPayoutRequestId: request.id },
        });
        if (netted.count !== reversedIds.length) {
          throw new ConflictAppException(
            'A reversal debit was netted by a concurrent request. ' +
              'No request was created — refresh and try again.',
          );
        }
        // Audit trail: one adjustment row per netted reversal so
        // finance can trace where each clawback was settled.
        await tx.affiliateCommissionAdjustment.createMany({
          data: reversedUnsettled.map((c) => ({
            commissionId: c.id,
            kind: 'REVERSAL_NETTED',
            deltaAmount: c.adjustedAmount.negated(),
            beforeAmount: c.adjustedAmount,
            afterAmount: ZERO,
            reason: `Netted into payout request ${request.id}`,
          })),
        });
      }

      // Phase 154 — open the status-history trail.
      await tx.affiliatePayoutRequestStatusHistory.create({
        data: {
          payoutRequestId: request.id,
          fromStatus: null,
          toStatus: 'REQUESTED',
          changedByActorType: 'AFFILIATE',
          changedByActorId: input.affiliateId,
        },
      });

      return request;
    });

    // Phase 154 — audit + finance notification (post-commit, best-effort: the
    // request is already durably created; these can't roll it back).
    this.audit
      .writeAuditLog({
        actorId: input.affiliateId,
        actorRole: 'AFFILIATE',
        action: 'affiliate.payout.requested',
        module: 'affiliate',
        resource: 'affiliate_payout_request',
        resourceId: request.id,
        newValue: {
          grossAmount: request.grossAmount.toString(),
          reversalDebit: request.reversalDebit.toString(),
          tdsAmount: request.tdsAmount.toString(),
          netAmount: request.netAmount.toString(),
          financialYear: request.financialYear,
          payoutMethodType: request.payoutMethodType,
          // Phase 160 (§194-O affiliate audit #14) — make the TDS DECISION
          // itself reconstructable from the audit row: which section + rate
          // applied, the filing quarter, and whether a PAN drove the rate.
          tdsSection: request.tdsSection,
          tdsRateBps: request.tdsRateBps,
          filingQuarter: request.filingQuarter,
          panOnFileAtDeduction: request.panOnFileAtDeduction,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (payout requested) failed: ${e}`));

    this.eventBus
      .publish({
        eventName: 'affiliate.payout.requested',
        aggregate: 'AffiliatePayoutRequest',
        aggregateId: request.id,
        occurredAt: new Date(),
        payload: {
          affiliateId: input.affiliateId,
          requestId: request.id,
          grossAmount: request.grossAmount.toString(),
          netAmount: request.netAmount.toString(),
          tdsAmount: request.tdsAmount.toString(),
          payoutMethodType: request.payoutMethodType,
          financialYear: request.financialYear,
        },
      })
      .catch(() => undefined);

    return request;
  }

  async listMyPayouts(affiliateId: string) {
    return this.prisma.affiliatePayoutRequest.findMany({
      where: { affiliateId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ── Admin actions ───────────────────────────────────────────

  async listForAdmin(params: {
    page?: number;
    limit?: number;
    status?: string;
    affiliateId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.affiliateId) where.affiliateId = params.affiliateId;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.affiliatePayoutRequest.findMany({
        where,
        include: {
          affiliate: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliatePayoutRequest.count({ where }),
    ]);
    return {
      requests,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Phase 155 — shared post-commit audit + finance event for a payout
  // transition. Best-effort (the DB transition already committed).
  private auditPayoutTransition(
    action: string,
    r: { id: string; affiliateId: string; status: string; netAmount?: Prisma.Decimal },
    input: { adminId: string; ipAddress?: string; userAgent?: string },
    extra: Record<string, unknown> = {},
  ): void {
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action,
        module: 'affiliate',
        resource: 'affiliate_payout_request',
        resourceId: r.id,
        newValue: {
          status: r.status,
          affiliateId: r.affiliateId,
          netAmount: r.netAmount?.toString() ?? null,
          ...extra,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (${action}) failed: ${e}`));
    this.eventBus
      .publish({
        eventName: action,
        aggregate: 'AffiliatePayoutRequest',
        aggregateId: r.id,
        occurredAt: new Date(),
        payload: { affiliateId: r.affiliateId, payoutRequestId: r.id, status: r.status, ...extra },
      })
      .catch(() => undefined);
  }

  async approve(input: {
    payoutRequestId: string;
    adminId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayoutRequest.findUnique({
        where: { id: input.payoutRequestId },
      });
      if (!r) throw new NotFoundAppException('Payout request not found');
      if (r.status !== 'REQUESTED') {
        throw new BadRequestAppException(
          `Cannot approve a payout request in ${r.status} state`,
        );
      }
      // Phase 155 — status-CAS so two concurrent approves can't both win
      // (the previous read-then-update split let the second overwrite the first).
      const claim = await tx.affiliatePayoutRequest.updateMany({
        where: { id: input.payoutRequestId, status: 'REQUESTED' },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: input.adminId },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Payout request changed state concurrently — refresh and retry.',
        );
      }
      await tx.affiliatePayoutRequestStatusHistory.create({
        data: {
          payoutRequestId: input.payoutRequestId,
          fromStatus: 'REQUESTED',
          toStatus: 'APPROVED',
          changedByActorType: 'ADMIN',
          changedByActorId: input.adminId,
        },
      });
      return tx.affiliatePayoutRequest.findUniqueOrThrow({
        where: { id: input.payoutRequestId },
      });
    });
    this.auditPayoutTransition('affiliate.payout.approved', result, input);
    return result;
  }

  /**
   * Admin marks the bank transfer complete. Flips all bundled
   * commissions to PAID, stamps `paidAt`, and updates the per-FY TDS
   * aggregation row (TDS auto-deduction lands in Phase 2; we record
   * the gross/net so the row exists).
   */
  async markPaid(input: {
    payoutRequestId: string;
    adminId: string;
    transactionRef?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    // Phase 155 — a bank UTR is mandatory to mark real money paid (was
    // optional → UTR-less PAID rows). DTO validates shape; this is the
    // service-level backstop.
    const utr = (input.transactionRef ?? '').trim();
    if (utr.length < 8) {
      throw new BadRequestAppException(
        'A bank UTR / transaction reference (min 8 chars) is required to mark a payout paid.',
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayoutRequest.findUnique({
        where: { id: input.payoutRequestId },
        include: { affiliate: { select: { status: true } } },
      });
      if (!r) throw new NotFoundAppException('Payout request not found');
      // Phase 159h (audit Critical) — re-check the affiliate is still ACTIVE at
      // mark-paid. An APPROVED request whose affiliate was suspended afterwards
      // must NOT disburse (the suspend flow also cancels in-flight requests, so
      // this is the belt-and-suspenders backstop against a money leak).
      if (r.affiliate.status !== 'ACTIVE') {
        throw new ForbiddenAppException(
          `Cannot mark paid — the affiliate is ${r.affiliate.status}, not ACTIVE.`,
        );
      }
      // Phase 155 — REQUESTED dropped: a payout must be APPROVED first (4-eyes;
      // no single-admin REQUESTED → PAID shortcut).
      if (!['APPROVED', 'PROCESSING'].includes(r.status)) {
        throw new BadRequestAppException(
          `Cannot mark paid from ${r.status} state — the request must be APPROVED first.`,
        );
      }
      const now = new Date();
      const updated = await tx.affiliatePayoutRequest.update({
        where: { id: input.payoutRequestId },
        data: {
          status: 'PAID',
          paidAt: now,
          processedAt: r.processedAt ?? now,
          transactionRef: utr,
          paidById: input.adminId,
        },
      });
      await tx.affiliateCommission.updateMany({
        where: { payoutRequestId: input.payoutRequestId, status: 'CONFIRMED' },
        data: { status: 'PAID', paidAt: now },
      });
      // Upsert TDS aggregation row for this FY.
      await tx.affiliateTdsRecord.upsert({
        where: {
          affiliateId_financialYear: {
            affiliateId: r.affiliateId,
            financialYear: r.financialYear,
          },
        },
        update: {
          cumulativeGross: { increment: r.grossAmount },
          cumulativeTds: { increment: r.tdsAmount },
          cumulativeNet: { increment: r.netAmount },
        },
        create: {
          affiliateId: r.affiliateId,
          financialYear: r.financialYear,
          cumulativeGross: r.grossAmount,
          cumulativeTds: r.tdsAmount,
          cumulativeNet: r.netAmount,
        },
      });
      // Phase 159e — flip the §194-O ledger entry to WITHHELD (TDS is now held
      // by the platform pending challan deposit). No-op for §194H payouts.
      await tx.affiliateTds194OLedger.updateMany({
        where: { payoutRequestId: input.payoutRequestId, status: 'COMPUTED' },
        data: { status: 'WITHHELD', withheldAt: now },
      });
      await tx.affiliatePayoutRequestStatusHistory.create({
        data: {
          payoutRequestId: input.payoutRequestId,
          fromStatus: r.status,
          toStatus: 'PAID',
          changedByActorType: 'ADMIN',
          changedByActorId: input.adminId,
        },
      });
      return updated;
    });
    this.auditPayoutTransition('affiliate.payout.paid', result, input, {
      transactionRef: utr,
    });
    return result;
  }

  /**
   * SRS §15.5 — bank transfer failed. Roll the bundled commissions
   * back to CONFIRMED so they can be re-submitted on a future
   * request. Capture the failure reason for the affiliate to see.
   */
  async markFailed(input: {
    payoutRequestId: string;
    adminId: string;
    reason: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const reason = (input.reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (reason.length < 1) {
      throw new BadRequestAppException('A failure reason is required.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayoutRequest.findUnique({
        where: { id: input.payoutRequestId },
      });
      if (!r) throw new NotFoundAppException('Payout request not found');
      if (r.status === 'PAID') {
        throw new BadRequestAppException(
          'Cannot fail a payout that has already been marked paid.',
        );
      }
      const updated = await tx.affiliatePayoutRequest.update({
        where: { id: input.payoutRequestId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: reason,
          failedById: input.adminId,
        },
      });
      // Release the commissions so the affiliate can re-request after fixing
      // the underlying issue. Phase 155 — status-filtered (never un-link a
      // commission already PAID) as defence-in-depth.
      await tx.affiliateCommission.updateMany({
        where: { payoutRequestId: input.payoutRequestId, status: { not: 'PAID' } },
        data: { payoutRequestId: null },
      });
      // Phase 159e — the payout failed, so no §194-O TDS was withheld. Drop the
      // COMPUTED ledger entry so it never reaches a Form-26Q export; a retry
      // creates a fresh request + ledger row. (WITHHELD rows are never deleted.)
      await tx.affiliateTds194OLedger.deleteMany({
        where: { payoutRequestId: input.payoutRequestId, status: 'COMPUTED' },
      });
      await tx.affiliatePayoutRequestStatusHistory.create({
        data: {
          payoutRequestId: input.payoutRequestId,
          fromStatus: r.status,
          toStatus: 'FAILED',
          changedByActorType: 'ADMIN',
          changedByActorId: input.adminId,
          reason,
        },
      });
      return updated;
    });
    this.auditPayoutTransition('affiliate.payout.failed', result, input, { reason });
    return result;
  }

  /**
   * Admin rejects a payout request before approval. Only allowed from
   * REQUESTED — once approved, the right paths are mark-paid or
   * mark-failed. Bundled commissions go back to CONFIRMED so the
   * affiliate can re-request after fixing whatever the admin flagged
   * (e.g. wrong KYC, suspicious activity).
   */
  async reject(input: {
    payoutRequestId: string;
    adminId: string;
    reason: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const reason = (input.reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (reason.length < 1) {
      throw new BadRequestAppException('A rejection reason is required.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayoutRequest.findUnique({
        where: { id: input.payoutRequestId },
      });
      if (!r) throw new NotFoundAppException('Payout request not found');
      if (r.status !== 'REQUESTED') {
        throw new BadRequestAppException(
          `Only REQUESTED payouts can be rejected. Current status: ${r.status}.`,
        );
      }
      const updated = await tx.affiliatePayoutRequest.update({
        where: { id: input.payoutRequestId },
        data: {
          // Phase 155 — proper REJECTED status + dedicated rejection columns
          // (was status:CANCELLED reusing the bank-FAILED columns — affiliates
          // saw "Cancelled" for an admin rejection).
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedById: input.adminId,
          rejectionReason: reason,
        },
      });
      await tx.affiliatePayoutRequestStatusHistory.create({
        data: {
          payoutRequestId: input.payoutRequestId,
          fromStatus: 'REQUESTED',
          toStatus: 'REJECTED',
          changedByActorType: 'ADMIN',
          changedByActorId: input.adminId,
          reason,
        },
      });
      await tx.affiliateCommission.updateMany({
        where: { payoutRequestId: input.payoutRequestId, status: { not: 'PAID' } },
        data: { payoutRequestId: null },
      });
      // Phase 159e — rejected before payout → no §194-O TDS withheld; drop the
      // COMPUTED ledger entry so it can't reach a Form-26Q export.
      await tx.affiliateTds194OLedger.deleteMany({
        where: { payoutRequestId: input.payoutRequestId, status: 'COMPUTED' },
      });
      return updated;
    });
    this.auditPayoutTransition('affiliate.payout.rejected', result, input, { reason });
    return result;
  }

  /**
   * Phase 159e — §194-O quarterly TDS report for Form 26Q. Per-affiliate
   * aggregation over WITHHELD/FILED ledger rows for a filing quarter
   * ("YYYY-Qn"). The per-payout snapshots on AffiliatePayoutRequest remain the
   * line-item source of truth; this is the filing roll-up.
   */
  async get194OTdsReport(filingPeriod: string) {
    const grouped = await this.prisma.affiliateTds194OLedger.groupBy({
      by: ['affiliateId'],
      where: { filingPeriod, status: { in: ['WITHHELD', 'DEPOSITED', 'CERTIFICATE_ISSUED'] } },
      _sum: { grossInPaise: true, tdsInPaise: true },
      _count: true,
    });
    if (grouped.length === 0) {
      return { filingPeriod, rows: [], totals: { grossInPaise: '0', tdsInPaise: '0', affiliates: 0 } };
    }
    const affiliateIds = grouped.map((g) => g.affiliateId);
    const [affiliates, meta] = await Promise.all([
      this.prisma.affiliate.findMany({
        where: { id: { in: affiliateIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      // One representative PAN/rate snapshot per affiliate for this quarter.
      this.prisma.affiliateTds194OLedger.findMany({
        where: { filingPeriod, status: { in: ['WITHHELD', 'DEPOSITED', 'CERTIFICATE_ISSUED'] } },
        select: { affiliateId: true, panLast4: true, hadPanOnFile: true, tdsRateBps: true },
        distinct: ['affiliateId'],
      }),
    ]);
    const affById = new Map(affiliates.map((a) => [a.id, a]));
    const metaById = new Map(meta.map((m) => [m.affiliateId, m]));
    let totalGross = 0n;
    let totalTds = 0n;
    const rows = grouped.map((g) => {
      const a = affById.get(g.affiliateId);
      const m = metaById.get(g.affiliateId);
      const gross = g._sum?.grossInPaise ?? 0n;
      const tds = g._sum?.tdsInPaise ?? 0n;
      totalGross += gross;
      totalTds += tds;
      return {
        affiliateId: g.affiliateId,
        affiliateName: a ? `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email : g.affiliateId,
        email: a?.email ?? null,
        panLast4: m?.panLast4 ?? null,
        hadPanOnFile: m?.hadPanOnFile ?? false,
        tdsRateBps: m?.tdsRateBps ?? null,
        payoutCount: g._count,
        grossInPaise: gross.toString(),
        tdsInPaise: tds.toString(),
      };
    });
    return {
      filingPeriod,
      rows,
      totals: {
        grossInPaise: totalGross.toString(),
        tdsInPaise: totalTds.toString(),
        affiliates: rows.length,
      },
    };
  }

  // ── §194-O deposit + Form 16A lifecycle (Phase 159f) ────────

  /**
   * Bulk WITHHELD → DEPOSITED after the marketplace deposits the TDS challan.
   * Status-guarded updateMany (atomic, idempotent, race-safe — mirrors the
   * seller Tds194OService.markDeposited).
   */
  async markTds194ODeposited(args: {
    ledgerIds: string[];
    depositedBy: string;
    challanReference: string;
    // Phase 159g — CBDT Form 26Q fields (optional at the API; required for a
    // filing-grade export).
    bsrCode?: string;
    challanDate?: Date;
    audit?: { ipAddress?: string; userAgent?: string };
  }): Promise<{ flipped: number }> {
    if (args.ledgerIds.length === 0) return { flipped: 0 };
    const now = new Date();
    const result = await this.prisma.affiliateTds194OLedger.updateMany({
      where: { id: { in: args.ledgerIds }, status: 'WITHHELD' },
      data: {
        status: 'DEPOSITED',
        depositedAt: now,
        depositedBy: args.depositedBy,
        challanReference: args.challanReference,
        bsrCode: args.bsrCode ?? null,
        challanDate: args.challanDate ?? null,
      },
    });
    this.audit
      .writeAuditLog({
        actorId: args.depositedBy,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_TDS_DEPOSITED',
        module: 'affiliate',
        resource: 'AffiliateTds194OLedger',
        resourceId: args.ledgerIds.join(','),
        newValue: { challanReference: args.challanReference, flipped: result.count },
        ipAddress: args.audit?.ipAddress,
        userAgent: args.audit?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (TDS deposited) failed: ${e}`));
    this.logger.log(
      `Affiliate TDS mark-deposited: requested=${args.ledgerIds.length} flipped=${result.count} challan=${args.challanReference}`,
    );
    return { flipped: result.count };
  }

  /**
   * Bulk DEPOSITED → CERTIFICATE_ISSUED after Form 16A is issued. Apply ONE
   * certificate number across an affiliate's quarter so renderForm16A can
   * aggregate the quarter under a single certificate.
   */
  async markTds194OCertificateIssued(args: {
    ledgerIds: string[];
    issuedBy: string;
    certificateNumber: string;
    audit?: { ipAddress?: string; userAgent?: string };
  }): Promise<{ flipped: number }> {
    if (args.ledgerIds.length === 0) return { flipped: 0 };
    const now = new Date();
    const result = await this.prisma.affiliateTds194OLedger.updateMany({
      where: { id: { in: args.ledgerIds }, status: 'DEPOSITED' },
      data: {
        status: 'CERTIFICATE_ISSUED',
        certificateIssuedAt: now,
        certificateIssuedBy: args.issuedBy,
        certificateNumber: args.certificateNumber,
      },
    });
    this.audit
      .writeAuditLog({
        actorId: args.issuedBy,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_TDS_CERTIFICATE_ISSUED',
        module: 'affiliate',
        resource: 'AffiliateTds194OLedger',
        resourceId: args.ledgerIds.join(','),
        newValue: { certificateNumber: args.certificateNumber, flipped: result.count },
        ipAddress: args.audit?.ipAddress,
        userAgent: args.audit?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (TDS cert issued) failed: ${e}`));
    return { flipped: result.count };
  }

  /**
   * Phase 160 (§194-O affiliate audit #16) — correction flow. Marks a
   * single ledger row REVERSED from ANY non-REVERSED state (a wrong
   * deduction discovered after deposit, a duplicate, etc.). Idempotent
   * (re-reversing is a no-op that keeps the original reason). CAS-guarded
   * so a concurrent reverse can't double-apply. The reversed row drops out
   * of the Form 26Q export + quarterly report (both count only
   * WITHHELD/DEPOSITED/CERTIFICATE_ISSUED). Audited.
   *
   * The reversal also DECREMENTS the annual AffiliateTdsRecord cumulative
   * (gross/TDS/net) by the reversed row's amounts — but ONLY when the row
   * was past WITHHELD (i.e. markPaid had bumped the cumulative). Without
   * this, a stale cumulative would over-count the §194H ₹15k-threshold base
   * on a subsequent payout (review fix). The ledger update + the cumulative
   * decrement run in ONE transaction so they can't diverge.
   */
  async reverseTds194O(args: {
    ledgerId: string;
    reversedBy: string;
    reason: string;
    audit?: { ipAddress?: string; userAgent?: string };
  }): Promise<{ reversed: boolean; previousStatus: string; wasAlreadyReversed: boolean }> {
    const reason = (args.reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (reason.length < 6) {
      throw new BadRequestAppException(
        'A reversal reason (min 6 characters) is required.',
      );
    }
    const ledger = await this.prisma.affiliateTds194OLedger.findUnique({
      where: { id: args.ledgerId },
      select: {
        id: true,
        status: true,
        affiliateId: true,
        filingPeriod: true,
        grossInPaise: true,
        tdsInPaise: true,
      },
    });
    if (!ledger) throw new NotFoundAppException('TDS ledger row not found');
    if (ledger.status === 'REVERSED') {
      return { reversed: false, previousStatus: 'REVERSED', wasAlreadyReversed: true };
    }
    const now = new Date();
    // markPaid bumps AffiliateTdsRecord only once the payout is PAID — which
    // is exactly when the ledger row leaves COMPUTED. So we decrement the
    // cumulative iff the row was already past COMPUTED (a COMPUTED row's
    // payout was never paid → nothing was added → nothing to subtract).
    const cumulativeWasBumped = ledger.status !== 'COMPUTED';
    const grossRupees = new Prisma.Decimal(ledger.grossInPaise.toString()).div(100);
    const tdsRupees = new Prisma.Decimal(ledger.tdsInPaise.toString()).div(100);
    const netRupees = grossRupees.minus(tdsRupees);
    const financialYear = financialYearOfQuarter(ledger.filingPeriod);

    const result = await this.prisma.$transaction(async (tx) => {
      // CAS: only flip if STILL in the previously-read non-REVERSED status, so
      // a concurrent reverse / lifecycle transition can't be clobbered.
      const upd = await tx.affiliateTds194OLedger.updateMany({
        where: { id: args.ledgerId, status: ledger.status },
        data: {
          status: 'REVERSED',
          reversedAt: now,
          reversedBy: args.reversedBy,
          reversalReason: reason,
        },
      });
      if (upd.count === 1 && cumulativeWasBumped && financialYear) {
        // updateMany (not update) so a missing record is a silent no-op
        // rather than a throw; clamp via the WHERE so we never touch another
        // affiliate's row. Decrement keeps the cumulative consistent with the
        // surviving (non-reversed) ledger rows.
        await tx.affiliateTdsRecord.updateMany({
          where: { affiliateId: ledger.affiliateId, financialYear },
          data: {
            cumulativeGross: { decrement: grossRupees },
            cumulativeTds: { decrement: tdsRupees },
            cumulativeNet: { decrement: netRupees },
          },
        });
      }
      return upd;
    });
    if (result.count === 0) {
      // Lost the race — re-read for an accurate response.
      const fresh = await this.prisma.affiliateTds194OLedger.findUnique({
        where: { id: args.ledgerId },
        select: { status: true },
      });
      return {
        reversed: false,
        previousStatus: fresh?.status ?? ledger.status,
        wasAlreadyReversed: fresh?.status === 'REVERSED',
      };
    }
    this.audit
      .writeAuditLog({
        actorId: args.reversedBy,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_TDS_REVERSED',
        module: 'affiliate',
        resource: 'AffiliateTds194OLedger',
        resourceId: args.ledgerId,
        oldValue: { status: ledger.status },
        newValue: { status: 'REVERSED', reason },
        ipAddress: args.audit?.ipAddress,
        userAgent: args.audit?.userAgent,
      })
      .catch((e) => this.logger.error(`Audit (TDS reversed) failed: ${e}`));
    this.logger.log(
      `Affiliate TDS reversed: ledger=${args.ledgerId} from=${ledger.status} by=${args.reversedBy}`,
    );
    return { reversed: true, previousStatus: ledger.status, wasAlreadyReversed: false };
  }

  /** Admin ops list — §194-O ledger rows for a quarter (optionally by status). */
  async listTds194OLedger(params: { filingPeriod: string; status?: string }) {
    const where: any = { filingPeriod: params.filingPeriod };
    if (params.status) where.status = params.status;
    const rows = await this.prisma.affiliateTds194OLedger.findMany({
      where,
      include: { affiliate: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { computedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      affiliateId: r.affiliateId,
      affiliateName:
        `${r.affiliate.firstName ?? ''} ${r.affiliate.lastName ?? ''}`.trim() || r.affiliate.email,
      filingPeriod: r.filingPeriod,
      status: r.status,
      panLast4: r.panLast4,
      tdsRateBps: r.tdsRateBps,
      grossInPaise: r.grossInPaise.toString(),
      tdsInPaise: r.tdsInPaise.toString(),
      challanReference: r.challanReference,
      certificateNumber: r.certificateNumber,
    }));
  }

  /**
   * Affiliate-facing per-quarter tax summary. Status is the LEAST-advanced
   * across the quarter's payouts — the Form 16A is downloadable only when every
   * row reached CERTIFICATE_ISSUED.
   */
  async getAffiliateTaxSummary(affiliateId: string) {
    const rows = await this.prisma.affiliateTds194OLedger.findMany({
      // Phase 160 (§194-O affiliate audit #16, review fix) — exclude REVERSED
      // rows: a cancelled deduction must not inflate the affiliate's quarterly
      // gross/TDS totals or drag the quarter's status label. A quarter whose
      // only rows are REVERSED correctly disappears from the summary.
      where: { affiliateId, status: { not: 'REVERSED' } },
      select: { filingPeriod: true, status: true, grossInPaise: true, tdsInPaise: true },
    });
    const RANK: Record<string, number> = {
      COMPUTED: 0,
      WITHHELD: 1,
      DEPOSITED: 2,
      CERTIFICATE_ISSUED: 3,
      REVERSED: 0,
    };
    const byQuarter = new Map<
      string,
      { filingPeriod: string; grossInPaise: bigint; tdsInPaise: bigint; minRank: number; count: number }
    >();
    for (const r of rows) {
      const cur = byQuarter.get(r.filingPeriod) ?? {
        filingPeriod: r.filingPeriod,
        grossInPaise: 0n,
        tdsInPaise: 0n,
        minRank: 3,
        count: 0,
      };
      cur.grossInPaise += r.grossInPaise;
      cur.tdsInPaise += r.tdsInPaise;
      cur.minRank = Math.min(cur.minRank, RANK[r.status] ?? 0);
      cur.count += 1;
      byQuarter.set(r.filingPeriod, cur);
    }
    const STATUS_LABEL = ['Pending deposit', 'Pending deposit', 'Deposited', 'Certificate ready'];
    return Array.from(byQuarter.values())
      .sort((a, b) => (a.filingPeriod < b.filingPeriod ? 1 : -1))
      .map((q) => ({
        filingPeriod: q.filingPeriod,
        grossInPaise: q.grossInPaise.toString(),
        tdsInPaise: q.tdsInPaise.toString(),
        payoutCount: q.count,
        status: STATUS_LABEL[q.minRank] ?? 'Pending deposit',
        canDownloadForm16A: q.minRank === 3,
      }));
  }

  /**
   * Render the affiliate's Form 16A (HTML) for a quarter — aggregates all
   * CERTIFICATE_ISSUED rows for (affiliate, quarter) under one certificate.
   * Returns null if the certificate hasn't been issued yet. Reuses the pure
   * tax-module template (PAN shown masked from the frozen ledger snapshot).
   */
  async renderAffiliateForm16A(
    affiliateId: string,
    filingPeriod: string,
  ): Promise<string | null> {
    const rows = await this.prisma.affiliateTds194OLedger.findMany({
      where: { affiliateId, filingPeriod, status: 'CERTIFICATE_ISSUED' },
      include: { affiliate: { select: { firstName: true, lastName: true } } },
      orderBy: { certificateIssuedAt: 'desc' },
    });
    if (rows.length === 0) return null;
    const head = rows[0]!;
    const grossInPaise = rows.reduce((s, r) => s + r.grossInPaise, 0n);
    const tdsInPaise = rows.reduce((s, r) => s + r.tdsInPaise, 0n);

    const platform = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: { legalBusinessName: true, panNumber: true, registeredAddressJson: true },
    });
    const flattenAddress = (j: unknown): string => {
      if (!j || typeof j !== 'object') return '';
      const a = j as Record<string, unknown>;
      return [a.line1, a.line2, a.city, a.state, a.pincode, a.country]
        .filter((v) => typeof v === 'string' && v)
        .join(', ');
    };
    const fyStart = parseInt(filingPeriod.split('-Q')[0]!, 10);
    const financialYear = `${fyStart}-${(fyStart + 1).toString().slice(-2)}`;

    const input: Form16AInput = {
      deductorName: platform?.legalBusinessName ?? 'Sportsmart',
      deductorTan: 'TAN-PENDING',
      deductorPan: platform?.panNumber ?? null,
      deductorAddress: flattenAddress(platform?.registeredAddressJson),
      deducteeName:
        `${head.affiliate.firstName ?? ''} ${head.affiliate.lastName ?? ''}`.trim() || 'Affiliate',
      // Full PAN isn't snapshotted on the ledger (only last4); show masked.
      deducteePan: null,
      deducteePanLast4: head.panLast4 ?? null,
      section: '194-O',
      filingPeriod,
      financialYear,
      grossAmountPaidInPaise: grossInPaise,
      tdsRateBps: head.tdsRateBps,
      tdsDeductedInPaise: tdsInPaise,
      certificateNumber: head.certificateNumber ?? '(draft)',
      challanReference: head.challanReference ?? null,
      dateOfDeposit: head.depositedAt ?? null,
      dateOfIssue: head.certificateIssuedAt ?? new Date(),
    };
    return renderForm16AHtml(input);
  }

  /**
   * Phase 159g — affiliate Form 26Q CSV for a filing quarter (CBDT-canonical).
   * Reads the §194-O ledger, decrypts each deductee's full PAN from KYC at
   * export time (filing requires the full PAN, not the masked snapshot), and
   * emits injection-safe CSV via the shared escaper. NIL quarters return a
   * header-only CSV (CBDT requires NIL returns be filed).
   *
   * Column order intentionally extends the seller Form 26Q (Deductee Type +
   * BSR Code + Challan Date added per CBDT) so the two exports concatenate.
   */
  async generateAffiliateForm26QCsv(filingPeriod: string): Promise<string> {
    if (!/^\d{4}-Q[1-4]$/.test(filingPeriod)) {
      throw new BadRequestAppException(
        'filingPeriod must be YYYY-Qn (e.g. 2026-Q1).',
      );
    }
    const header = [
      'Deductee PAN',
      'Deductee Name',
      'Deductee Type',
      'Section',
      'Filing Period',
      'Gross Amount Paid',
      'TDS Rate (%)',
      'TDS Amount',
      'Challan Reference',
      'BSR Code',
      'Date of Deposit',
      'Challan Date',
      'Form 16A Certificate Number',
      'Status',
    ];
    const lines = [header.map((h) => escapeCsvField(h)).join(',')];

    const rows = await this.prisma.affiliateTds194OLedger.findMany({
      // Phase 160 (§194-O affiliate audit #16) — never file a REVERSED row
      // (it's been corrected out). The filing CSV is the TDS-withheld trail;
      // a reversed deduction must not reach NSDL.
      where: { filingPeriod, status: { not: 'REVERSED' } },
      include: { affiliate: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { computedAt: 'asc' },
    });
    if (rows.length === 0) return lines.join('\n'); // NIL return

    // Full PAN per affiliate, decrypted from KYC (batched). Falls back to ''
    // when KYC/PAN is absent or undecryptable — never throws the export.
    const affiliateIds = [...new Set(rows.map((r) => r.affiliateId))];
    const kycs = await this.prisma.affiliateKyc.findMany({
      where: { affiliateId: { in: affiliateIds } },
      select: { affiliateId: true, panNumberEnc: true, panNumberIv: true },
    });
    const panByAffiliate = new Map<string, string>();
    for (const k of kycs) {
      if (!k.panNumberEnc || !k.panNumberIv) continue;
      try {
        panByAffiliate.set(k.affiliateId, this.encryption.decrypt(k.panNumberEnc, k.panNumberIv));
      } catch {
        // leave unset → empty PAN cell (NSDL will flag a no-PAN deductee)
      }
    }

    for (const r of rows) {
      const name = `${r.affiliate.firstName ?? ''} ${r.affiliate.lastName ?? ''}`.trim();
      const cells = [
        panByAffiliate.get(r.affiliateId) ?? '',
        name,
        'AFFILIATE',
        '194O',
        r.filingPeriod,
        affiliatePaiseToRupees(r.grossInPaise),
        (r.tdsRateBps / 100).toFixed(2),
        affiliatePaiseToRupees(r.tdsInPaise),
        r.challanReference ?? '',
        r.bsrCode ?? '',
        r.depositedAt ? affiliateFormatIstDate(r.depositedAt) : '',
        r.challanDate ? affiliateFormatIstDate(r.challanDate) : '',
        r.certificateNumber ?? '',
        r.status,
      ];
      lines.push(cells.map((c) => escapeCsvField(c)).join(','));
    }
    return lines.join('\n');
  }

  // ── Helpers ─────────────────────────────────────────────────

  private toPublicMethod(m: any) {
    return {
      id: m.id,
      type: m.type,
      accountLast4: m.accountLast4,
      ifscCode: m.ifscCode,
      accountHolderName: m.accountHolderName,
      bankName: m.bankName,
      upiId: m.upiId,
      isPrimary: m.isPrimary,
      isVerified: m.isVerified,
      verifiedAt: m.verifiedAt,
      createdAt: m.createdAt,
    };
  }

  /** Indian financial year string, e.g. "2026-27" for the year
   *  starting Apr 2026. Used as the partition key for TDS records. */
  private currentFinancialYear(): string {
    const now = new Date();
    const month = now.getMonth(); // 0-indexed, so 3 = April
    const year = now.getFullYear();
    const startYear = month >= 3 ? year : year - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  /**
   * Phase 159e — Indian-FY filing quarter as "YYYY-Qn" (YYYY = FY start year),
   * matching the seller §194-O ledger's filingPeriod format:
   *   Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
   */
  private currentFilingQuarter(now: Date = new Date()): string {
    const month = now.getMonth(); // 0 = Jan
    const year = now.getFullYear();
    const fyStartYear = month >= 3 ? year : year - 1;
    let q: number;
    if (month >= 3 && month <= 5) q = 1;
    else if (month >= 6 && month <= 8) q = 2;
    else if (month >= 9 && month <= 11) q = 3;
    else q = 4; // Jan-Mar
    return `${fyStartYear}-Q${q}`;
  }
}

// Phase 159g — BigInt-safe paise → rupees (no float drift), and IST DD/MM/YYYY
// for the Form 26Q CSV. Local mirrors of the seller report helpers.
function affiliatePaiseToRupees(p: bigint): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  return `${neg ? '-' : ''}${rupees.toString()}.${paise.toString().padStart(2, '0')}`;
}

// Phase 160 (review fix) — "2026-Q1" → "2026-27" (matches
// currentFinancialYear()'s format). Returns null for a malformed quarter so
// the caller skips the cumulative decrement rather than touching a wrong row.
function financialYearOfQuarter(filingPeriod: string): string | null {
  const m = /^(\d{4})-Q[1-4]$/.exec(filingPeriod);
  if (!m) return null;
  const startYear = parseInt(m[1]!, 10);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function affiliateFormatIstDate(d: Date): string {
  // Shift to IST (UTC+5:30) then format DD/MM/YYYY.
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60_000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
