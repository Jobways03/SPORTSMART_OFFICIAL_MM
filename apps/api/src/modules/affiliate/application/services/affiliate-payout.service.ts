import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AffiliateEncryptionService } from './affiliate-encryption.service';

/**
 * Manual payout flow per SRS §15.
 *
 * Phase 1 scope:
 *   - addPayoutMethod / listPayoutMethods (affiliate)
 *   - requestPayout (bundles all CONFIRMED commissions)
 *   - admin approve → mark paid → mark failed
 *
 * Phase 2 additions (now in scope):
 *   - TDS auto-deduction at request time per §16 / Section 194H
 *     (10% over ₹15k FY cumulative).
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
   * from post-payout returns, SRS §13.4) and deducts §194H TDS at
   * 10% on the cumulative FY commission income above ₹15,000.
   *
   * Eligibility (SRS §15.1):
   *   - affiliate.status === 'ACTIVE'
   *   - kycStatus === 'VERIFIED'
   *   - at least one primary payout method
   *   - balance after reversal-netting ≥ ₹500
   */
  async requestPayout(input: { affiliateId: string }) {
    const MIN_PAYOUT = new Prisma.Decimal(500);
    const TDS_THRESHOLD = new Prisma.Decimal(15000);
    const TDS_RATE = new Prisma.Decimal('0.10');
    const ZERO = new Prisma.Decimal(0);

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: input.affiliateId },
      select: { id: true, status: true, kycStatus: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');

    if (affiliate.status !== 'ACTIVE') {
      throw new ForbiddenAppException('Only ACTIVE affiliates can request payouts.');
    }
    if (affiliate.kycStatus !== 'VERIFIED') {
      throw new ForbiddenAppException(
        'Please complete KYC verification before requesting a payout.',
      );
    }

    const primary = await this.prisma.affiliatePayoutMethodRecord.findFirst({
      where: { affiliateId: input.affiliateId, isPrimary: true },
      select: { id: true },
    });
    if (!primary) {
      throw new BadRequestAppException(
        'Add a primary bank account or UPI before requesting a payout.',
      );
    }

    const fy = this.currentFinancialYear();

    return this.prisma.$transaction(async (tx) => {
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

      // §16 / Section 194H: 10% TDS on the slice of FY commission
      // income above ₹15,000. We include in-flight (REQUESTED /
      // APPROVED / PROCESSING) requests in the cumulative so two
      // concurrent withdrawals don't both reclaim the same threshold
      // headroom.
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

      const cumulativeGrossAfter = paidGross
        .plus(inflightGross)
        .plus(grossAmount);
      const taxable = cumulativeGrossAfter.minus(TDS_THRESHOLD);
      const expectedTotalTds = taxable.greaterThan(0)
        ? taxable.mul(TDS_RATE)
        : ZERO;
      const alreadyDeductedTds = paidTds.plus(inflightTds);
      const tdsCandidate = expectedTotalTds.minus(alreadyDeductedTds);
      // Round to 2dp for currency consistency.
      const tdsAmount = new Prisma.Decimal(
        (tdsCandidate.greaterThan(0) ? tdsCandidate : ZERO).toFixed(2),
      );

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
          status: 'REQUESTED',
        },
      });

      await tx.affiliateCommission.updateMany({
        where: { id: { in: eligible.map((c) => c.id) } },
        data: { payoutRequestId: request.id },
      });

      if (reversedUnsettled.length > 0) {
        await tx.affiliateCommission.updateMany({
          where: { id: { in: reversedUnsettled.map((c) => c.id) } },
          data: { reversalNettedInPayoutRequestId: request.id },
        });
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

      return request;
    });
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

  async approve(input: { payoutRequestId: string; adminId: string }) {
    const r = await this.prisma.affiliatePayoutRequest.findUnique({
      where: { id: input.payoutRequestId },
    });
    if (!r) throw new NotFoundAppException('Payout request not found');
    if (r.status !== 'REQUESTED') {
      throw new BadRequestAppException(
        `Cannot approve a payout request in ${r.status} state`,
      );
    }
    return this.prisma.affiliatePayoutRequest.update({
      where: { id: input.payoutRequestId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: input.adminId,
      },
    });
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
  }) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayoutRequest.findUnique({
        where: { id: input.payoutRequestId },
      });
      if (!r) throw new NotFoundAppException('Payout request not found');
      if (!['APPROVED', 'PROCESSING', 'REQUESTED'].includes(r.status)) {
        throw new BadRequestAppException(
          `Cannot mark paid from ${r.status} state`,
        );
      }
      const now = new Date();
      const updated = await tx.affiliatePayoutRequest.update({
        where: { id: input.payoutRequestId },
        data: {
          status: 'PAID',
          paidAt: now,
          processedAt: r.processedAt ?? now,
          transactionRef: input.transactionRef ?? r.transactionRef ?? null,
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
      return updated;
    });
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
  }) {
    return this.prisma.$transaction(async (tx) => {
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
          failureReason: input.reason,
        },
      });
      // Release the commissions so the affiliate can re-request after
      // fixing the underlying issue (e.g. corrected bank details).
      await tx.affiliateCommission.updateMany({
        where: { payoutRequestId: input.payoutRequestId },
        data: { payoutRequestId: null },
      });
      return updated;
    });
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
}
