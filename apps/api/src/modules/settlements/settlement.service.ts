import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../core/exceptions';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../audit/application/facades/audit-public.facade';
import { MoneyDualWriteHelper } from '../../core/money/money-dual-write.helper';
import { toPaise } from '../../core/money/money-field-registry';
// Phase 178 (Outstanding Payables audit #1/#10) — derive the settlement payout
// due-date (cycle periodEnd + SLA business days) for SLA / aging tracking.
import { addBusinessDays, parseHolidaySet } from '../../core/util/business-days';
// Phase 148 — formula-injection-safe CSV (the shared util neutralises
// =/+/-/@-leading cells); replaces the inline csvQuote (RFC-4180 only).
import { toCsv } from '../../core/utils';
import { SettlementTcsHookService } from '../tax/application/services/settlement-tcs-hook.service';
import { SettlementTds194OHookService } from '../tax/application/services/settlement-tds-194o-hook.service';
// Phase 159aa — at cycle-approval time the marketplace also issues a
// commission tax invoice per SellerSettlement (closes audit B1 + B2
// from the marketplace-commission-gstr flow audit). Same hook pattern
// as TCS / TDS — runs after the APPROVED cascade, errors don't roll
// back the cycle.
import { CommissionInvoiceService } from '../tax/application/services/commission-invoice.service';
import { computeCommissionGst } from '../tax/domain/commission-gst-calculator';

// Phase 142 — the per-seller aggregation shape shared by createCycle (writes)
// and previewCycle (dry-run). `records` only needs `id` for the consumer (the
// claim updateMany), though the full rows are stored during grouping.
interface EligibleSellerGroup {
  sellerName: string;
  // Phase 28 — captured for commission-GST place-of-supply; may be empty for
  // legacy sellers without a registered GSTIN (calculator falls back to IGST).
  sellerStateCode: string;
  records: Array<{ id: string }>;
  totalPlatformAmount: Prisma.Decimal;
  totalSettlementAmount: Prisma.Decimal;
  totalPlatformMargin: Prisma.Decimal;
  totalItems: number;
  orderIds: Set<string>;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    // Phase 7 (PR 7.5) — paise-sibling dual-write for cycle / seller
    // settlement / commission record / adjustment writes.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // Phase 17 GST — TCS deduction at approval + collection at mark-paid.
    private readonly tcsHook: SettlementTcsHookService,
    // Phase 27 — Section 194-O Income-Tax TDS deduction at approval +
    // withholding at mark-paid. Independent of TCS — both stamp
    // their own ledger row and denorm columns on SellerSettlement.
    private readonly tdsHook: SettlementTds194OHookService,
    // Phase 159aa — commission tax-invoice snapshot per settlement so
    // the marketplace GSTR-1 can emit one §4 B2B row per invoice (CBIC
    // contract) instead of a per-(seller, period) rollup.
    private readonly commissionInvoice: CommissionInvoiceService,
  ) {}

  /**
   * Phase 142 — single source of truth for "which PENDING commissions are
   * eligible for a cycle in [periodStart, periodEnd], grouped by seller, with
   * exact Decimal totals". createCycle (writes) and previewCycle (dry-run) BOTH
   * call this, so the dry-run numbers are — by construction — exactly what
   * createCycle would produce. (Previously the only preview path was a dead,
   * per-seller facade with different aggregation math.)
   */
  private async aggregateEligibleCommissions(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{
    pendingRecords: Array<{ id: string }>;
    sellerMap: Map<string, EligibleSellerGroup>;
    cycleTotalAmount: Prisma.Decimal;
    cycleTotalMargin: Prisma.Decimal;
  }> {
    const pendingRecords = await this.prisma.commissionRecord.findMany({
      where: {
        status: 'PENDING',
        settlementId: null,
        // Phase 136 — STABLE settlable date (sub-order return-window end), with
        // a createdAt fallback for legacy rows; a backfill no longer dumps
        // months-old deliveries into the current cycle.
        OR: [
          { settlableAt: { gte: periodStart, lte: periodEnd } },
          { settlableAt: null, createdAt: { gte: periodStart, lte: periodEnd } },
        ],
      },
      include: {
        seller: { select: { id: true, sellerShopName: true, gstStateCode: true } },
      },
    });

    const sellerMap = new Map<string, EligibleSellerGroup>();
    for (const rec of pendingRecords) {
      const existing = sellerMap.get(rec.sellerId);
      if (existing) {
        existing.records.push(rec);
        existing.totalPlatformAmount = existing.totalPlatformAmount.plus(
          rec.totalPlatformAmount,
        );
        existing.totalSettlementAmount = existing.totalSettlementAmount.plus(
          rec.totalSettlementAmount,
        );
        existing.totalPlatformMargin = existing.totalPlatformMargin.plus(
          rec.platformMargin,
        );
        existing.totalItems += rec.quantity;
        existing.orderIds.add(rec.subOrderId);
      } else {
        sellerMap.set(rec.sellerId, {
          sellerName: rec.seller?.sellerShopName || rec.sellerName,
          sellerStateCode: rec.seller?.gstStateCode ?? '',
          records: [rec],
          totalPlatformAmount: new Prisma.Decimal(rec.totalPlatformAmount),
          totalSettlementAmount: new Prisma.Decimal(rec.totalSettlementAmount),
          totalPlatformMargin: new Prisma.Decimal(rec.platformMargin),
          totalItems: rec.quantity,
          orderIds: new Set([rec.subOrderId]),
        });
      }
    }

    let cycleTotalAmount = new Prisma.Decimal(0);
    let cycleTotalMargin = new Prisma.Decimal(0);
    for (const data of sellerMap.values()) {
      cycleTotalAmount = cycleTotalAmount.plus(data.totalSettlementAmount);
      cycleTotalMargin = cycleTotalMargin.plus(data.totalPlatformMargin);
    }

    return { pendingRecords, sellerMap, cycleTotalAmount, cycleTotalMargin };
  }

  /* ── T3: Create settlement cycle ── */
  async createCycle(
    periodStart: Date,
    periodEnd: Date,
    actor?: { adminId?: string },
  ) {
    // Phase 141 — reject a period that overlaps an existing non-cancelled
    // cycle. The settlementId:null claim already prevents a record landing in
    // two cycles, but two coexisting cycles for overlapping ranges confuse
    // finance reporting. Fail fast before doing any work.
    const overlap = await this.prisma.settlementCycle.findFirst({
      where: {
        status: { notIn: ['CANCELLED'] },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
      select: { id: true, status: true },
    });
    if (overlap) {
      throw new BadRequestAppException(
        `An overlapping settlement cycle already exists (${overlap.id}, status ${overlap.status}). ` +
          'Cancel it or choose a non-overlapping period.',
      );
    }

    // Phase 142 — shared aggregator (identical SELECT + grouping + Decimal
    // totals as previewCycle, so a dry-run is exactly what this commits). The
    // settlementId:null filter inside keeps cycle assignment idempotent — a
    // record can only ever be grouped into one cycle.
    const { pendingRecords, sellerMap, cycleTotalAmount, cycleTotalMargin } =
      await this.aggregateEligibleCommissions(periodStart, periodEnd);

    if (pendingRecords.length === 0) {
      return {
        cycle: null,
        message: 'No pending commission records found in this date range',
      };
    }

    // Phase 28 — Look up the marketplace's own GST state code once
    // so every seller settlement uses the same place-of-supply origin.
    // Empty when no PlatformGstProfile is seeded — calculator falls
    // back to IGST conservatively in that case.
    const platformProfile = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: { gstStateCode: true },
    });
    const marketplaceStateCode = platformProfile?.gstStateCode ?? '';

    // Create cycle in a transaction. cycleTotalAmount / cycleTotalMargin come
    // from the shared aggregator above (same numbers the preview returned).
    const cycle = await this.prisma.$transaction(async (tx) => {
      // Phase 178 (#1/#10) — payout SLA: periodEnd + N business days (env
      // SETTLEMENT_SLA_BUSINESS_DAYS, default 7; BANK_HOLIDAYS skipped). The
      // cycle carries it; each settlement inherits it as its payoutDueBy.
      const slaDays = parseInt(process.env.SETTLEMENT_SLA_BUSINESS_DAYS || '7', 10) || 7;
      const cyclePayoutDueBy = addBusinessDays(
        periodEnd,
        slaDays,
        parseHolidaySet(process.env.BANK_HOLIDAYS),
      );

      const newCycle = await tx.settlementCycle.create({
        data: this.moneyDualWrite.applyPaise('settlementCycle', {
          periodStart,
          periodEnd,
          status: 'DRAFT',
          // Phase 141 — created-by provenance (the most consequential write
          // in the flow; the audit row below records the rest).
          createdByAdminId: actor?.adminId ?? null,
          // .toFixed(2) gives a Decimal-string so the helper's toPaise
          // can convert exactly; the previous `Math.round(x*100)/100`
          // expression yields a fractional JS Number that toPaise
          // rejects (PR 0.4 contract).
          totalAmount: cycleTotalAmount.toFixed(2),
          totalMargin: cycleTotalMargin.toFixed(2),
          payoutDueBy: cyclePayoutDueBy,
        }),
      });

      // ── Phase 150: Post-settlement reversal netting ──────────────────
      // Pull every PENDING SellerDebit for the sellers in this cycle so each
      // seller's payout is offset by the claw-backs recorded against their
      // already-settled commissions (returns / RTO / disputes). Without this
      // the debits accumulate forever and the platform silently eats every
      // post-settlement refund. One query (sellerId IN [...]) — no N+1 — then
      // grouped in-memory oldest-first so the earliest debts are recovered
      // first. settlementId stays null until applied (so a concurrent cycle /
      // a cancel can still claim or release it; we CAS on PENDING below).
      const cycleSellerIds = Array.from(sellerMap.keys());
      const pendingDebits = cycleSellerIds.length
        ? await tx.sellerDebit.findMany({
            where: { sellerId: { in: cycleSellerIds }, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      const debitsBySeller = new Map<string, typeof pendingDebits>();
      for (const d of pendingDebits) {
        const arr = debitsBySeller.get(d.sellerId) ?? [];
        arr.push(d);
        debitsBySeller.set(d.sellerId, arr);
      }
      // Σ claw-back netted across all sellers — used to reduce the cycle's
      // headline totalAmount so it stays equal to Σ net per-seller payouts.
      let cycleClawbackPaise = 0n;

      // Create per-seller settlements
      for (const [sellerId, data] of sellerMap) {
        // Phase 28 — compute the commission-GST split at row-creation
        // time so the settlement is fully GST-aware from the first
        // moment it exists. Frozen with the marketplace + seller state
        // codes so a later PlatformGstProfile / Seller.gstStateCode
        // change doesn't rewrite the historical split.
        const commissionGst = computeCommissionGst({
          commissionAmountInPaise: BigInt(
            data.totalPlatformMargin.mul(100).toFixed(0),
          ),
          marketplaceStateCode,
          sellerStateCode: data.sellerStateCode,
        });

        // ── Phase 150: net this seller's PENDING claw-backs into the payout.
        // Greedy: apply a debit in full only if the running payout can still
        // absorb it (floor at zero — a seller is never paid a negative amount).
        // Debits that would overdraw stay PENDING and carry forward to a future
        // cycle; we keep scanning so a smaller later debit can still fill the
        // remaining headroom. approvedSettlementAmount keeps the GROSS figure
        // (Phase 147 immutable snapshot); the claw-back is recorded as a
        // negative SettlementAdjustment and `totalSettlementAmount` is the net.
        const grossSettlementPaise = BigInt(
          data.totalSettlementAmount.mul(100).toFixed(0),
        );
        const sellerDebits = debitsBySeller.get(sellerId) ?? [];
        let appliedPaise = 0n;
        const appliedDebits: typeof sellerDebits = [];
        for (const debit of sellerDebits) {
          if (debit.amountInPaise <= 0n) continue;
          if (appliedPaise + debit.amountInPaise <= grossSettlementPaise) {
            appliedPaise += debit.amountInPaise;
            appliedDebits.push(debit);
          }
        }
        const netSettlementDec = data.totalSettlementAmount.sub(
          new Prisma.Decimal(appliedPaise.toString()).div(100),
        );
        cycleClawbackPaise += appliedPaise;

        const sellerSettlement = await tx.sellerSettlement.create({
          data: this.moneyDualWrite.applyPaise('sellerSettlement', {
            cycleId: newCycle.id,
            sellerId,
            sellerName: data.sellerName,
            totalOrders: data.orderIds.size,
            totalItems: data.totalItems,
            // Same Decimal-string conversion as the cycle totals above.
            totalPlatformAmount: data.totalPlatformAmount.toFixed(2),
            // Phase 150 — net of any post-settlement claw-backs applied below
            // (== gross when the seller has no PENDING debits).
            totalSettlementAmount: netSettlementDec.toFixed(2),
            // Phase 147 — immutable approved-gross snapshot (= the settlement
            // amount at creation; never mutated, so adjustments can't destroy it).
            // Stays GROSS even when a claw-back nets the payout down, so the
            // balance breakdown can show earnings vs adjustments separately.
            approvedSettlementAmount: data.totalSettlementAmount.toFixed(2),
            totalPlatformMargin: data.totalPlatformMargin.toFixed(2),
            status: 'PENDING',
            // Phase 28 — commission-GST denorm columns. Rate stored
            // even when total is 0 so the historical rate snapshot is
            // useful for audits.
            commissionGstRateBps: commissionGst.rateBps,
            commissionGstSplitType: commissionGst.splitType,
            cgstOnCommissionInPaise: commissionGst.cgstInPaise,
            sgstOnCommissionInPaise: commissionGst.sgstInPaise,
            igstOnCommissionInPaise: commissionGst.igstInPaise,
            totalCommissionGstInPaise: commissionGst.totalGstInPaise,
            commissionGstMarketplaceStateCode:
              marketplaceStateCode || null,
            commissionGstSellerStateCode:
              data.sellerStateCode || null,
            // Phase 178 (#1) — inherit the cycle's payout due-date for SLA/aging.
            payoutDueBy: cyclePayoutDueBy,
          }),
        });

        // Link commission records to the settlement. Filter on
        // `settlementId: null` so a concurrent createCycle racing the
        // same record loses the claim — only one cycle wins.
        const recordIds = data.records.map((r) => r.id);
        const attached = await tx.commissionRecord.updateMany({
          // Phase 137 — also require status PENDING. A record HELD (→ ON_HOLD)
          // between the (non-transactional) candidate read and this attach must
          // not be pulled into the cycle. If the count drops, a record changed
          // state mid-flight — abort the whole cycle (rolls back) so the cycle
          // totals can never include a record that wasn't actually attached
          // (which would otherwise risk a double-pay). The admin retries; the
          // next read excludes the held record.
          where: { id: { in: recordIds }, settlementId: null, status: 'PENDING' },
          data: this.moneyDualWrite.applyPaise('commissionRecord', {
            settlementId: sellerSettlement.id,
          }),
        });
        if (attached.count !== recordIds.length) {
          throw new ConflictAppException(
            'A commission record changed state (held / settled) during cycle ' +
              'creation. No cycle was created — retry.',
          );
        }

        // ── Phase 150: mark the netted claw-backs APPLIED + record each as a
        // negative adjustment line. The updateMany CAS on status PENDING means
        // a debit cancelled (or already applied by a racing op) between the
        // read above and here drops the count — we abort the whole cycle so a
        // debit can never be double-applied or applied after being contested.
        if (appliedDebits.length > 0) {
          const applied = await tx.sellerDebit.updateMany({
            where: {
              id: { in: appliedDebits.map((d) => d.id) },
              status: 'PENDING',
            },
            data: {
              status: 'APPLIED',
              settlementId: sellerSettlement.id,
              settlementAdjustedAt: new Date(),
            },
          });
          if (applied.count !== appliedDebits.length) {
            throw new ConflictAppException(
              'A seller debit changed state (cancelled / applied) during cycle ' +
                'creation. No cycle was created — retry.',
            );
          }
          for (const debit of appliedDebits) {
            // amount + amountInPaise set explicitly (negative) — NOT via
            // applyPaise, whose toPaise contract is for positive Decimal-strings.
            await tx.settlementAdjustment.create({
              data: {
                settlementId: sellerSettlement.id,
                amount: new Prisma.Decimal(debit.amountInPaise.toString())
                  .div(100)
                  .neg()
                  .toFixed(2),
                amountInPaise: -debit.amountInPaise,
                adjustmentType: 'CLAWBACK',
                status: 'ACTIVE',
                reason: `Post-settlement claw-back (${debit.sourceType})`.slice(
                  0,
                  200,
                ),
                notes: `SellerDebit ${debit.id} · source ${debit.sourceType}:${debit.sourceId}`,
                createdByAdminId: actor?.adminId ?? null,
              },
            });
          }
        }
      }

      // Phase 150 — reduce the cycle headline by the claw-backs netted across
      // all sellers, so cycle.totalAmount stays == Σ net per-seller payouts.
      if (cycleClawbackPaise > 0n) {
        return tx.settlementCycle.update({
          where: { id: newCycle.id },
          data: this.moneyDualWrite.applyPaise('settlementCycle', {
            totalAmount: cycleTotalAmount
              .sub(new Prisma.Decimal(cycleClawbackPaise.toString()).div(100))
              .toFixed(2),
          }),
        });
      }

      return newCycle;
    });

    // Phase 141 — audit the cycle creation (locking 100s/1000s of commission
    // records to a payout cycle is the flow's most consequential write).
    // Best-effort so the audit subsystem can't roll back a committed cycle.
    this.audit
      .writeAuditLog({
        actorId: actor?.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'settlement.cycle_created',
        module: 'settlements',
        resource: 'settlement_cycle',
        resourceId: cycle.id,
        newValue: {
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          sellerCount: sellerMap.size,
          recordCount: pendingRecords.length,
          totalAmount: cycle.totalAmount?.toString?.() ?? null,
        },
      })
      .catch((e) =>
        this.logger.error(`Failed to audit cycle creation: ${e}`),
      );

    return { cycle, message: 'Settlement cycle created successfully' };
  }

  /* ── Phase 141: Preview a cycle (read-only, no write) ── */
  /**
   * Runs the same candidate SELECT + per-seller grouping as createCycle but
   * commits nothing — so an operator can see "this cycle would include N
   * records totalling ₹X across M sellers" (and whether the period overlaps an
   * existing cycle) before committing.
   */
  async previewCycle(
    periodStart: Date,
    periodEnd: Date,
    actor?: { adminId?: string },
  ) {
    const overlap = await this.prisma.settlementCycle.findFirst({
      where: {
        status: { notIn: ['CANCELLED'] },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
      select: { id: true, status: true, periodStart: true, periodEnd: true },
    });

    // Phase 142 — SAME aggregator createCycle uses, so the dry-run numbers are
    // exactly what a subsequent create would write (only-PENDING, settlementId
    // null, settlableAt-windowed). No mutation: no transaction, no writes.
    const { pendingRecords, sellerMap, cycleTotalAmount, cycleTotalMargin } =
      await this.aggregateEligibleCommissions(periodStart, periodEnd);

    // Phase 150 — surface the post-settlement claw-backs createCycle will net
    // off each seller's payout, so the dry-run matches the commit (audit #6).
    const previewSellerIds = Array.from(sellerMap.keys());
    const previewDebits = previewSellerIds.length
      ? await this.prisma.sellerDebit.findMany({
          where: { sellerId: { in: previewSellerIds }, status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          select: { sellerId: true, amountInPaise: true },
        })
      : [];
    const previewDebitsBySeller = new Map<string, bigint[]>();
    for (const d of previewDebits) {
      const arr = previewDebitsBySeller.get(d.sellerId) ?? [];
      arr.push(d.amountInPaise);
      previewDebitsBySeller.set(d.sellerId, arr);
    }
    let previewClawbackPaise = 0n;

    const sellerBreakdown = Array.from(sellerMap.entries()).map(
      ([sellerId, data]) => {
        // Same greedy floor-at-zero apply createCycle does, read-only.
        const grossPaise = BigInt(
          data.totalSettlementAmount.mul(100).toFixed(0),
        );
        const sellerDebitAmounts = previewDebitsBySeller.get(sellerId) ?? [];
        let appliedPaise = 0n;
        let pendingPaise = 0n;
        for (const amt of sellerDebitAmounts) {
          if (amt <= 0n) continue;
          pendingPaise += amt;
          if (appliedPaise + amt <= grossPaise) appliedPaise += amt;
        }
        previewClawbackPaise += appliedPaise;
        const netDec = data.totalSettlementAmount.sub(
          new Prisma.Decimal(appliedPaise.toString()).div(100),
        );
        return {
          sellerId,
          sellerName: data.sellerName,
          recordCount: data.records.length,
          totalOrders: data.orderIds.size,
          // sum of quantity (not row count) — matches what createCycle writes.
          totalItems: data.totalItems,
          totalPlatformAmount: data.totalPlatformAmount.toFixed(2),
          totalSettlementAmount: data.totalSettlementAmount.toFixed(2),
          // Phase 150 — claw-back preview (pending = all owed; applied = what
          // fits under this cycle's payout; net = the actual payout).
          pendingClawbackInPaise: pendingPaise.toString(),
          appliedClawbackInPaise: appliedPaise.toString(),
          netSettlementAmount: netDec.toFixed(2),
          totalPlatformMargin: data.totalPlatformMargin.toFixed(2),
        };
      },
    );
    const netCycleTotalDec = cycleTotalAmount.sub(
      new Prisma.Decimal(previewClawbackPaise.toString()).div(100),
    );

    // Phase 142 — optional forensic trail: record what projected numbers the
    // operator saw before committing. Best-effort; never blocks the read.
    if (actor?.adminId) {
      this.audit
        .writeAuditLog({
          actorId: actor.adminId,
          actorRole: 'ADMIN',
          action: 'settlement.cycle_previewed',
          module: 'settlements',
          resource: 'settlement_cycle',
          resourceId: 'preview',
          newValue: {
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            recordCount: pendingRecords.length,
            sellerCount: sellerMap.size,
            totalAmount: cycleTotalAmount.toFixed(2),
          },
        })
        .catch((e) => this.logger.error(`Failed to audit cycle preview: ${e}`));
    }

    return {
      isDryRun: true,
      // The cycle service is seller-commission-scoped; franchise settlements
      // run on their own pipeline (franchise-settlement.service), so a seller
      // preview never silently omits franchise money — it's a different cycle.
      scope: 'SELLER' as const,
      periodStart,
      periodEnd,
      recordCount: pendingRecords.length,
      sellerCount: sellerMap.size,
      totalSettlementAmount: cycleTotalAmount.toFixed(2),
      // Phase 150 — claw-backs netted across all sellers + the resulting net
      // payout (== cycle.totalAmount that createCycle will write).
      totalClawbackInPaise: previewClawbackPaise.toString(),
      netSettlementAmount: netCycleTotalDec.toFixed(2),
      totalMargin: cycleTotalMargin.toFixed(2),
      sellerBreakdown,
      overlap: overlap
        ? {
            id: overlap.id,
            status: overlap.status,
            periodStart: overlap.periodStart,
            periodEnd: overlap.periodEnd,
          }
        : null,
      // "as of" — the result is a point-in-time snapshot; the commission cron
      // may add rows before the operator confirms (create re-aggregates).
      asOf: new Date().toISOString(),
    };
  }

  /* ── Phase 141: Cancel a DRAFT/PREVIEWED cycle ── */
  /**
   * Reverses an erroneously-created cycle: releases its claimed commission
   * records (settlementId → null, so a corrected cycle can re-claim them),
   * marks the seller settlements + the cycle CANCELLED, all in one transaction.
   * Only DRAFT/PREVIEWED cycles can be cancelled — once APPROVED/PAID the money
   * has moved (or TCS/TDS ledgers exist) and the reversal flow must be used.
   */
  async cancelCycle(
    cycleId: string,
    actor: { adminId?: string },
    reason: string,
  ) {
    const safeReason = (reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      throw new BadRequestAppException(
        'A reason (min 3 chars) is required to cancel a settlement cycle.',
      );
    }

    const released = await this.prisma.$transaction(async (tx) => {
      const cycle = await tx.settlementCycle.findUnique({
        where: { id: cycleId },
        include: { sellerSettlements: { select: { id: true } } },
      });
      if (!cycle) throw new NotFoundAppException('Settlement cycle not found');
      if (cycle.status !== 'DRAFT' && cycle.status !== 'PREVIEWED') {
        throw new BadRequestAppException(
          `Cannot cancel a cycle in ${cycle.status} state — only DRAFT/PREVIEWED cycles can be cancelled. Use the reversal flow for an approved/paid cycle.`,
        );
      }

      const settlementIds = cycle.sellerSettlements.map((s) => s.id);
      let releasedCount = 0;
      if (settlementIds.length > 0) {
        const released = await tx.commissionRecord.updateMany({
          where: { settlementId: { in: settlementIds } },
          data: this.moneyDualWrite.applyPaise('commissionRecord', {
            settlementId: null,
          }),
        });
        releasedCount = released.count;
        await tx.sellerSettlement.updateMany({
          where: { cycleId },
          data: { status: 'CANCELLED' as any },
        });
      }

      await tx.settlementCycle.update({
        where: { id: cycleId },
        data: { status: 'CANCELLED' },
      });

      return releasedCount;
    });

    this.audit
      .writeAuditLog({
        actorId: actor.adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'settlement.cycle_cancelled',
        module: 'settlements',
        resource: 'settlement_cycle',
        resourceId: cycleId,
        newValue: { reason: safeReason, releasedRecordCount: released },
      })
      .catch((e) =>
        this.logger.error(`Failed to audit cycle cancellation: ${e}`),
      );

    return {
      success: true,
      message: `Settlement cycle cancelled; ${released} commission record(s) released back to the pool.`,
      releasedRecordCount: released,
    };
  }

  /* ── T3: List cycles ── */
  async listCycles(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [cycles, total] = await Promise.all([
      this.prisma.settlementCycle.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { sellerSettlements: true } },
        },
      }),
      this.prisma.settlementCycle.count(),
    ]);

    return {
      // Phase 141 — key is `items` to match the FE contract. It previously
      // returned `cycles`, so the FE's `data.items` was always undefined and
      // the list silently rendered empty (the fallback unwrap didn't help).
      items: cycles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T3: Get cycle detail ── */
  async getCycleDetail(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          orderBy: { totalSettlementAmount: 'desc' },
          include: {
            _count: { select: { commissionRecords: true } },
            // Phase 145 — payout actor name for the row's "paid by X" display.
            paidByAdmin: { select: { name: true } },
          },
        },
        // Phase 144 — resolve the approving admin's name for the detail page.
        approvedByAdmin: { select: { name: true, email: true } },
      },
    });

    if (!cycle) {
      return null;
    }

    // Phase B (P0.5) — attach seller-funded discount deductions per
    // seller. Pulls from `discount_liability_ledger` filtered to
    // liability_party=SELLER and rolled up by seller. The UI uses
    // this to show a "Discount Deductions" line in the per-seller
    // breakdown.
    const sellerIds = (cycle.sellerSettlements ?? []).map((s: any) => s.sellerId);
    let discountDeductionsBySeller: Record<string, {
      // Net of returns: gross APPLIED/SETTLED (positive) + REVERSED (negative).
      totalAmountInPaise: string;
      // Phase 247 (#17) — surface the gross / reversed / net split so the UI
      // can show "₹X discount absorbed, ₹Y credited back on returns, ₹Z net".
      grossAmountInPaise: string;
      reversedAmountInPaise: string;
      netAmountInPaise: string;
      entries: Array<{
        masterOrderId: string;
        subOrderId: string | null;
        orderItemId: string | null;
        discountId: string;
        discountCode: string | null;
        fundingType: string;
        amountInPaise: string;
        status: string;
        reason: string | null;
        createdAt: Date;
      }>;
    }> = {};
    if (sellerIds.length > 0) {
      // Phase 247 (liability audit #17) — include REVERSED rows. A return
      // writes a NEW ledger row with a NEGATIVE amount_in_paise (status
      // REVERSED) and leaves the original APPLIED row intact. Filtering to
      // only APPLIED/SETTLED excluded that credit, so the seller kept eating
      // the full discount on returned items. Summing the SIGNED amount across
      // APPLIED + SETTLED + REVERSED nets the credit back correctly.
      const rows = await this.prisma.discountLiabilityLedger.findMany({
        where: {
          sellerId: { in: sellerIds },
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const row of rows) {
        if (!row.sellerId) continue;
        const bucket = (discountDeductionsBySeller[row.sellerId] ??= {
          totalAmountInPaise: '0',
          grossAmountInPaise: '0',
          reversedAmountInPaise: '0',
          netAmountInPaise: '0',
          entries: [],
        });
        const signed = BigInt(row.amountInPaise);
        // Signed net (do NOT abs() — REVERSED amounts are stored negative).
        const net = BigInt(bucket.netAmountInPaise) + signed;
        bucket.netAmountInPaise = net.toString();
        bucket.totalAmountInPaise = net.toString();
        if (row.status === 'REVERSED') {
          bucket.reversedAmountInPaise = (
            BigInt(bucket.reversedAmountInPaise) + signed
          ).toString();
        } else {
          bucket.grossAmountInPaise = (
            BigInt(bucket.grossAmountInPaise) + signed
          ).toString();
        }
        bucket.entries.push({
          masterOrderId: row.masterOrderId,
          subOrderId: row.subOrderId,
          orderItemId: row.orderItemId,
          discountId: row.discountId,
          discountCode: row.discountCode,
          fundingType: row.fundingType,
          amountInPaise: row.amountInPaise.toString(),
          status: row.status,
          reason: row.reason,
          createdAt: row.createdAt,
        });
      }
    }

    // Phase 141 — the stored totalAmount/totalMargin are a creation-time
    // snapshot. If a record was frozen (return) or adjusted after the cycle was
    // created, the snapshot drifts from what is actually payable. Recompute the
    // live payable totals (still-PENDING attached records — exactly what
    // markPaid will pay) so the detail/approval UI shows reality, and surface
    // the held count so the operator knows a record dropped out.
    const settlementIds = (cycle.sellerSettlements ?? []).map((s: any) => s.id);
    let liveTotals = {
      totalSettlementAmount: '0.00',
      totalMargin: '0.00',
      payableRecordCount: 0,
      heldRecordCount: 0,
      driftedFromSnapshot: false,
    };
    if (settlementIds.length > 0) {
      const payable = await this.prisma.commissionRecord.aggregate({
        where: { settlementId: { in: settlementIds }, status: 'PENDING' },
        _sum: { totalSettlementAmount: true, platformMargin: true },
        _count: true,
      });
      const heldRecordCount = await this.prisma.commissionRecord.count({
        where: {
          settlementId: { in: settlementIds },
          status: { in: ['ON_HOLD', 'REFUNDED'] },
        },
      });
      const liveAmount = payable._sum.totalSettlementAmount ?? new Prisma.Decimal(0);
      liveTotals = {
        totalSettlementAmount: liveAmount.toFixed(2),
        totalMargin: (payable._sum.platformMargin ?? new Prisma.Decimal(0)).toFixed(2),
        payableRecordCount: payable._count,
        heldRecordCount,
        driftedFromSnapshot: !new Prisma.Decimal(cycle.totalAmount).equals(liveAmount),
      };
    }

    return { ...cycle, discountDeductionsBySeller, liveTotals };
  }

  /* ── T3: Approve cycle ── */
  async approveCycle(cycleId: string, actorId?: string, notes?: string) {
    // Phase 144 — approval is the most consequential write in the finance
    // pipeline (it commits sellers' payouts + triggers TCS/TDS). Load the
    // settlements + their live commission state so we can re-validate before
    // committing, not blind-write creation-time totals.
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          include: {
            commissionRecords: {
              select: { id: true, status: true, platformMargin: true },
            },
          },
        },
      },
    });

    if (!cycle) {
      return { success: false, message: 'Settlement cycle not found' };
    }

    if (cycle.status !== 'DRAFT' && cycle.status !== 'PREVIEWED') {
      return {
        success: false,
        message: `Cannot approve a cycle with status: ${cycle.status}`,
      };
    }

    // Phase 144 — reject an empty cycle (every record reversed since creation).
    if (cycle.sellerSettlements.length === 0) {
      return {
        success: false,
        message: 'Cannot approve an empty cycle (it has no seller settlements).',
      };
    }

    // Phase 144 — re-validate the stored per-seller totals against the LIVE
    // commission state. A return arriving between creation and approval flips a
    // commission PENDING → ON_HOLD/REFUNDED; the stored settlement total still
    // counts it, so approving (and computing TCS/TDS) would use stale numbers.
    // We reject on any drift and route the operator to cancel + recreate (which
    // recomputes every total — incl. the frozen GST split — cleanly).
    for (const s of cycle.sellerSettlements) {
      const liveMargin = s.commissionRecords
        .filter((r) => r.status === 'PENDING')
        .reduce((sum, r) => sum.plus(r.platformMargin), new Prisma.Decimal(0));
      const storedMargin = new Prisma.Decimal(s.totalPlatformMargin);
      if (!liveMargin.equals(storedMargin)) {
        return {
          success: false,
          message:
            `Settlement totals are stale for seller ${s.sellerName} ` +
            `(stored ₹${storedMargin.toFixed(2)}, live ₹${liveMargin.toFixed(2)} ` +
            'after holds/reversals since cycle creation). Cancel this cycle and ' +
            'recreate it so the totals — and the GST split — recompute cleanly.',
        };
      }
    }

    const safeNotes = notes
      ? notes.replace(/<[^>]*>/g, '').trim().slice(0, 500) || null
      : null;

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Version-CAS: the flip only commits if the cycle is still DRAFT/PREVIEWED.
      // Two concurrent approvals → the second sees count 0 → 409, so TCS/TDS
      // hooks (below) run exactly once.
      const claim = await tx.settlementCycle.updateMany({
        where: { id: cycleId, status: { in: ['DRAFT', 'PREVIEWED'] } },
        data: {
          status: 'APPROVED',
          approvedByAdminId: actorId ?? null,
          approvedAt: new Date(),
          approvalNotes: safeNotes,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Cycle status changed concurrently — reload and retry.',
        );
      }

      // Status-guarded cascade: only PENDING settlements flip to APPROVED (a
      // hypothetically already-PAID row is never downgraded).
      await tx.sellerSettlement.updateMany({
        where: { cycleId, status: 'PENDING' },
        data: { status: 'APPROVED' },
      });

      // Phase 247 (liability audit #18) — revive the dead SETTLED lifecycle.
      // DiscountLiabilityLedger SELLER rows were written APPLIED and never
      // advanced; nothing linked a row to the cycle that consumed it. At the
      // commit point that finalises a cycle's seller payouts, flip the
      // consumed SELLER rows APPLIED→SETTLED and stamp settlementCycleId, in
      // THIS transaction so it's atomic with the cycle approval.
      //
      // Scope: the sellers in this cycle + the cycle's settlement window on
      // the ledger row's createdAt + liabilityParty=SELLER + status=APPLIED.
      // (REVERSED/already-SETTLED rows are untouched — REVERSED carries the
      // negative return credit-back and must stay distinct from the gross.)
      // We only run when the window is known; periodStart/periodEnd are
      // nullable on the cycle.
      const ledgerSellerIds = cycle.sellerSettlements
        .map((s) => s.sellerId)
        .filter((id): id is string => !!id);
      if (
        ledgerSellerIds.length > 0 &&
        cycle.periodStart &&
        cycle.periodEnd
      ) {
        await tx.discountLiabilityLedger.updateMany({
          where: {
            sellerId: { in: ledgerSellerIds },
            liabilityParty: 'SELLER',
            status: 'APPLIED',
            createdAt: { gte: cycle.periodStart, lte: cycle.periodEnd },
          },
          data: {
            status: 'SETTLED',
            settlementCycleId: cycleId,
          },
        });
      }
      return true;
    });
    if (!claimed) {
      return { success: false, message: 'Settlement cycle approval failed' };
    }

    // Phase 144 — business-level audit of the approval (TCS/TDS hooks record
    // their own ledger actor; this is the cycle-approved event itself).
    this.audit
      .writeAuditLog({
        actorId: actorId ?? 'system',
        actorRole: 'ADMIN',
        action: 'settlement.cycle_approved',
        module: 'settlements',
        resource: 'settlement_cycle',
        resourceId: cycleId,
        oldValue: { status: cycle.status },
        newValue: {
          status: 'APPROVED',
          totalAmount: cycle.totalAmount?.toString?.() ?? null,
          sellerCount: cycle.sellerSettlements.length,
          notes: safeNotes,
        },
      })
      .catch((e) => this.logger.error(`Failed to audit cycle approval: ${e}`));

    // Phase 17 GST — apply TCS to every SellerSettlement in the cycle.
    // Runs after the APPROVED flip so the TCS hook sees the settlements
    // in their final approved shape. Errors per-settlement are logged
    // by the hook and don't roll back the cycle approval — finance
    // can re-run targeted compute via the admin endpoint.
    let tcsResult;
    try {
      tcsResult = await this.tcsHook.applyToCycleOnApprove({
        cycleId,
        actorId,
      });
    } catch (err) {
      this.logger.warn(
        `TCS apply-on-approve failed for cycle ${cycleId}: ${(err as Error).message}`,
      );
    }

    // Phase 27 — apply Section 194-O TDS in the same pass. The two
    // hooks operate on different denorm columns + different ledger
    // tables, so a TCS failure doesn't block TDS and vice versa.
    let tdsResult;
    try {
      tdsResult = await this.tdsHook.applyToCycleOnApprove({
        cycleId,
        actorId,
      });
    } catch (err) {
      this.logger.warn(
        `194-O TDS apply-on-approve failed for cycle ${cycleId}: ${(err as Error).message}`,
      );
    }

    // Phase 159aa — issue the per-settlement commission tax invoice
    // (CBIC §31 obligation on the marketplace's commission supply to
    // each seller). Same fault-tolerance as TCS/TDS: per-row failures
    // are logged and surfaced in the response; the cycle stays APPROVED
    // so finance can re-run targeted issuance via the admin endpoint
    // without unwinding payouts.
    let commissionInvoiceResult;
    try {
      commissionInvoiceResult =
        await this.commissionInvoice.applyToCycleOnApprove({
          cycleId,
          actorId,
        });
    } catch (err) {
      this.logger.warn(
        `Commission invoice apply-on-approve failed for cycle ${cycleId}: ${(err as Error).message}`,
      );
    }

    return {
      success: true,
      message: 'Settlement cycle approved',
      tcs: tcsResult,
      tds: tdsResult,
      commissionInvoice: commissionInvoiceResult,
    };
  }

  /* ── T3: Mark a seller settlement as paid ── */
  async markSettlementPaid(
    settlementId: string,
    utrReference: string,
    actorContext?: {
      adminId?: string;
      ipAddress?: string;
      userAgent?: string;
      paymentMethod?: string;
      paymentProofUrl?: string;
    },
  ) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      include: { cycle: true },
    });

    if (!settlement) {
      return { success: false, message: 'Seller settlement not found' };
    }

    if (settlement.status === 'PAID') {
      return { success: false, message: 'Settlement already marked as paid' };
    }

    if (settlement.cycle.status !== 'APPROVED') {
      return {
        success: false,
        message: 'Settlement cycle must be approved before marking paid',
      };
    }

    const trimmedUtr = utrReference.trim();

    try {
      await this.prisma.$transaction(async (tx) => {
        // Phase 145 — version-CAS: only an APPROVED (or previously-FAILED, i.e.
        // a retry) settlement can be paid. Two concurrent mark-paid calls →
        // the second sees count 0 → 409, so the TCS/TDS hooks run exactly once.
        const claim = await tx.sellerSettlement.updateMany({
          where: { id: settlementId, status: { in: ['APPROVED', 'FAILED'] } },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            utrReference: trimmedUtr,
            // Phase 145 — denormalise the actor + payment metadata onto the row
            // (list/CSV "paid by X" without an audit_logs join). Clear any prior
            // failure reason on a successful retry.
            paidByAdminId: actorContext?.adminId ?? null,
            paymentMethod: actorContext?.paymentMethod ?? null,
            paymentProofUrl: actorContext?.paymentProofUrl ?? null,
            paymentFailureReason: null,
          },
        });
        if (claim.count === 0) {
          throw new ConflictAppException(
            'Settlement is not in a payable state (must be APPROVED or FAILED) or it changed concurrently.',
          );
        }

        // Update all linked commission records to SETTLED. Phase 137 — guard on
        // status PENDING so a record that somehow became ON_HOLD/REFUNDED after
        // cycle attach is NOT marked SETTLED (defense-in-depth; the hold path
        // already refuses to hold a cycled record, so this should never differ).
        await tx.commissionRecord.updateMany({
          where: { settlementId, status: 'PENDING' },
          data: this.moneyDualWrite.applyPaise('commissionRecord', {
            status: 'SETTLED',
          }),
        });

        // Auto-flip the parent cycle to PAID only when NO settlement is left
        // unpaid — a FAILED settlement is `not: 'PAID'`, so it correctly blocks
        // the flip until it's retried. Phase 146 — count BOTH seller AND
        // franchise children (a cycle can hold both); counting seller-only
        // would prematurely flip a cycle whose franchise payouts are pending.
        const [sellerPending, franchisePending] = await Promise.all([
          tx.sellerSettlement.count({
            where: { cycleId: settlement.cycleId, status: { not: 'PAID' } },
          }),
          tx.franchiseSettlement.count({
            where: { cycleId: settlement.cycleId, status: { not: 'PAID' } },
          }),
        ]);

        if (sellerPending === 0 && franchisePending === 0) {
          await tx.settlementCycle.update({
            where: { id: settlement.cycleId },
            data: { status: 'PAID' },
          });
        }
      });
    } catch (err) {
      // Phase 145 — the UTR unique index rejects a duplicate bank reference.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return {
          success: false,
          message:
            `UTR "${trimmedUtr}" is already recorded on another settlement. ` +
            'Verify the bank reference — a duplicate usually means a copy-paste ' +
            'error or a real payment failure.',
        };
      }
      throw err;
    }

    // Phase 17 GST — flip the linked TCS row COMPUTED → COLLECTED so
    // the GSTR-8 export reflects "TCS money actually collected from
    // seller payout". Runs after the transaction commits since the
    // hook does its own writes; if it fails, the payout has already
    // happened and we just need finance to retry markCollected via the
    // admin endpoint.
    try {
      await this.tcsHook.markCollectedOnPay({ settlementId });
    } catch (err) {
      this.logger.warn(
        `TCS mark-collected failed for settlement ${settlementId}: ${(err as Error).message}`,
      );
    }

    // Phase 27 — same pattern for the 194-O TDS row. The TDS amount
    // has been deducted from the seller's payout; flip the ledger
    // COMPUTED → WITHHELD so admin sees it in the "challan-pending"
    // queue. Best-effort: re-runnable via the admin endpoint if it
    // fails here.
    try {
      await this.tdsHook.markWithheldOnPay({ settlementId });
    } catch (err) {
      this.logger.warn(
        `194-O TDS mark-withheld failed for settlement ${settlementId}: ${(err as Error).message}`,
      );
    }

    // Phase 145 — actual ₹ wired = gross settlement − TCS − TDS − commission-GST
    // (all paise). Recording it (alongside the gross) means an auditor reading
    // the log sees what actually left the bank, not just the pre-tax figure.
    const netAmountInPaise =
      BigInt(settlement.totalSettlementAmountInPaise ?? 0) -
      BigInt(settlement.tcsDeductedInPaise ?? 0) -
      BigInt(settlement.tdsDeductedInPaise ?? 0) -
      BigInt(settlement.totalCommissionGstInPaise ?? 0);

    // Audit the payout — settlement payouts are real money movements and
    // need to be traceable to a specific admin action with the UTR.
    this.audit
      .writeAuditLog({
        actorId: actorContext?.adminId,
        actorRole: 'ADMIN',
        action: 'MARK_SETTLEMENT_PAID',
        module: 'settlements',
        resource: 'seller_settlement',
        resourceId: settlementId,
        oldValue: { status: settlement.status },
        newValue: { status: 'PAID', utrReference: trimmedUtr },
        metadata: {
          sellerId: settlement.sellerId,
          cycleId: settlement.cycleId,
          grossAmount: Number(settlement.totalSettlementAmount ?? 0),
          netAmountInPaise: netAmountInPaise.toString(),
          paymentMethod: actorContext?.paymentMethod ?? null,
        },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });

    return { success: true, message: 'Settlement marked as paid' };
  }

  /* ── Phase 145: Mark a seller settlement payout as FAILED ── */
  /**
   * Records a botched payout (bank rejected / reversed the transfer) as a
   * resting FAILED state with a reason, so it can later be retried
   * (FAILED → PAID via markSettlementPaid) with a full audit chain — instead of
   * silently leaving the settlement APPROVED and re-trying blind.
   */
  async markSettlementFailed(
    settlementId: string,
    reason: string,
    actorContext?: { adminId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const safeReason = (reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      return {
        success: false,
        message: 'A failure reason (min 3 chars) is required.',
      };
    }

    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      include: { cycle: true },
    });
    if (!settlement) {
      return { success: false, message: 'Seller settlement not found' };
    }
    if (settlement.status === 'PAID') {
      return {
        success: false,
        message:
          'Cannot fail an already-paid settlement; use the reversal flow to claw back a confirmed payout.',
      };
    }

    // Version-CAS: only an APPROVED settlement (or one already FAILED, e.g. to
    // update the reason) can be marked failed.
    const claim = await this.prisma.sellerSettlement.updateMany({
      where: { id: settlementId, status: { in: ['APPROVED', 'FAILED'] } },
      data: { status: 'FAILED', paymentFailureReason: safeReason },
    });
    if (claim.count === 0) {
      return {
        success: false,
        message:
          'Settlement is not in a state that can be marked failed (must be APPROVED/FAILED).',
      };
    }

    this.audit
      .writeAuditLog({
        actorId: actorContext?.adminId,
        actorRole: 'ADMIN',
        action: 'MARK_SETTLEMENT_FAILED',
        module: 'settlements',
        resource: 'seller_settlement',
        resourceId: settlementId,
        oldValue: { status: settlement.status },
        newValue: { status: 'FAILED', reason: safeReason },
        metadata: { sellerId: settlement.sellerId, cycleId: settlement.cycleId },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });

    return { success: true, message: 'Settlement marked as failed' };
  }

  /* ── T4: Seller earnings summary ── */
  async getSellerEarningsSummary(sellerId: string) {
    // Total earned (all SETTLED records)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
    });

    // Pending settlement (all PENDING records)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    // Last payout
    const lastPayout = await this.prisma.sellerSettlement.findFirst({
      where: { sellerId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: {
        totalSettlementAmount: true,
        // Statutory + commission-GST deductions so the "Last Payout" KPI
        // reflects the NET that actually hit the seller's bank, not the
        // gross settlement amount.
        tcsDeductedInPaise: true,
        tdsDeductedInPaise: true,
        totalCommissionGstInPaise: true,
        paidAt: true,
        utrReference: true,
      },
    });

    // Phase B (P0.5) — seller-funded discount deductions. Sum of
    // ledger entries with liability_party=SELLER for this seller.
    // These are amounts the seller has agreed to absorb (reducing
    // their settlement); platform-funded discounts do NOT show here.
    //
    // Phase 247 (liability audit #17) — include REVERSED rows so the
    // negative credit-back from returns nets against the gross APPLIED/
    // SETTLED amount (REVERSED rows carry a negative amount_in_paise).
    // The _sum is over the SIGNED column, so APPLIED(+) + REVERSED(-)
    // yields the true net the seller still absorbs after returns.
    const discountDeductionAgg = await this.prisma.discountLiabilityLedger.aggregate({
      where: {
        sellerId,
        liabilityParty: 'SELLER',
        status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
      },
      _sum: { amountInPaise: true },
      _count: true,
    });

    return {
      totalEarned: Number(settledAgg._sum.totalSettlementAmount || 0),
      pendingSettlement: Number(pendingAgg._sum.totalSettlementAmount || 0),
      lastPayout: lastPayout
        ? {
            // NET actually wired = settlement − TCS − TDS − commission GST.
            // (Mirrors the per-row net the seller UI computes; the gross
            // settlement amount remains visible in the settlement history
            // row + its breakdown.)
            amount:
              (Math.round(Number(lastPayout.totalSettlementAmount) * 100) -
                Number(lastPayout.tcsDeductedInPaise ?? 0) -
                Number(lastPayout.tdsDeductedInPaise ?? 0) -
                Number(lastPayout.totalCommissionGstInPaise ?? 0)) /
              100,
            paidAt: lastPayout.paidAt,
            utrReference: lastPayout.utrReference,
          }
        : null,
      // Phase B (P0.5)
      discountDeductions: {
        // BigInt → string on the wire (Prisma convention).
        totalAmountInPaise: (
          discountDeductionAgg._sum.amountInPaise ?? 0n
        ).toString(),
        count: discountDeductionAgg._count,
      },
    };
  }

  /**
   * Phase B (P0.5) — paginated list of seller-funded discount
   * deductions for a specific seller. Backs the "Discount
   * Deductions" tab on the seller dashboard.
   */
  async getSellerDiscountDeductions(
    sellerId: string,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    // Phase 247 (liability audit #17) — include REVERSED rows so the
    // returned-item credit-backs (negative amount_in_paise) are visible in
    // the seller's deduction list and net against the gross APPLIED/SETTLED
    // rows. The displayed `amountInPaise` is signed (negative for REVERSED).
    const [rows, total] = await Promise.all([
      this.prisma.discountLiabilityLedger.findMany({
        where: {
          sellerId,
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.discountLiabilityLedger.count({
        where: {
          sellerId,
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
        },
      }),
    ]);
    // Phase 247 (#17) — net deduction across this seller's full ledger
    // (signed sum, not abs) so the page can show the true after-returns total
    // alongside the paginated rows.
    const netAgg = await this.prisma.discountLiabilityLedger.aggregate({
      where: {
        sellerId,
        liabilityParty: 'SELLER',
        status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
      },
      _sum: { amountInPaise: true },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        amountInPaise: r.amountInPaise.toString(),
      })),
      netDeductionInPaise: (netAgg._sum?.amountInPaise ?? 0n).toString(),
      total,
      page,
      limit,
    };
  }

  /* ── T4: Seller commission records (paginated) ── */
  async getSellerCommissionRecords(
    sellerId: string,
    page: number,
    limit: number,
    search?: string,
    status?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { sellerId };

    if (status && ['PENDING', 'ON_HOLD', 'SETTLED', 'REFUNDED'].includes(status)) {
      where.status = status;
    } else {
      // Mirror the admin list behaviour: refunded + held commissions are
      // hidden by default. Sellers can opt in by picking the explicit
      // filter. "Held" records will flip back to PENDING automatically
      // when admin rejects the return (seller earns) or stay frozen
      // while the return is in progress.
      where.status = { notIn: ['REFUNDED', 'ON_HOLD'] };
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { productTitle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T4: Seller settlement history ── */
  async getSellerSettlementHistory(sellerId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [settlements, total] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          cycle: {
            select: { periodStart: true, periodEnd: true, status: true },
          },
        },
      }),
      this.prisma.sellerSettlement.count({ where: { sellerId } }),
    ]);

    return {
      settlements,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T5: Admin margin summary ── */
  async getAdminMarginSummary() {
    const [totalPlatformAgg, totalSettlementAgg, totalMarginAgg] =
      await Promise.all([
        this.prisma.commissionRecord.aggregate({
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { platformMargin: true },
        }),
      ]);

    const pendingSettlements = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    const paidSettlements = await this.prisma.sellerSettlement.aggregate({
      where: { status: 'PAID' },
      _sum: { totalSettlementAmount: true },
    });

    return {
      totalPlatformRevenue: Number(totalPlatformAgg._sum.totalPlatformAmount || 0),
      totalSellerPayouts: Number(paidSettlements._sum.totalSettlementAmount || 0),
      totalPlatformMargin: Number(totalMarginAgg._sum.platformMargin || 0),
      pendingSettlementAmount: Number(pendingSettlements._sum.totalSettlementAmount || 0),
      totalSettlementsDue: Number(totalSettlementAgg._sum.totalSettlementAmount || 0),
    };
  }

  /* ── T5: Admin per-seller breakdown ── */
  async getAdminSellerBreakdown(page: number, limit: number) {
    const skip = (page - 1) * limit;

    // Get unique sellers with commission records
    const sellers = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId', 'sellerName'],
      _sum: {
        totalPlatformAmount: true,
        totalSettlementAmount: true,
        platformMargin: true,
      },
      _count: { id: true },
      orderBy: { _sum: { totalPlatformAmount: 'desc' } },
      skip,
      take: limit,
    });

    const total = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId'],
      _count: { id: true },
    });

    return {
      sellers: sellers.map((s) => ({
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        totalRecords: s._count.id,
        totalPlatformAmount: Number(s._sum.totalPlatformAmount || 0),
        totalSettlementAmount: Number(s._sum.totalSettlementAmount || 0),
        totalPlatformMargin: Number(s._sum.platformMargin || 0),
      })),
      pagination: {
        page,
        limit,
        total: total.length,
        totalPages: Math.ceil(total.length / limit),
      },
    };
  }

  /* ── T6: Reconciliation ── */
  async getReconciliation() {
    // Total platform revenue: sum of all commission records totalPlatformAmount
    const platformRevenueAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalPlatformAmount: true },
    });

    // Total seller settlements due: sum of all commission records totalSettlementAmount
    const sellerSettlementsAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalSettlementAmount: true },
    });

    // Total platform margin
    const marginAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { platformMargin: true },
    });

    // Pending settlements (not yet paid)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true, totalPlatformAmount: true },
      _count: { id: true },
    });

    // Settled (paid)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
      _count: { id: true },
    });

    // Total delivered order items (should match with commission records processed)
    const totalDeliveredItems = await this.prisma.orderItem.count({
      where: {
        subOrder: {
          fulfillmentStatus: 'DELIVERED',
          commissionProcessed: true,
        },
      },
    });

    const totalCommissionRecords = await this.prisma.commissionRecord.count();

    // Check for mismatches
    const mismatches: string[] = [];

    if (totalDeliveredItems !== totalCommissionRecords) {
      mismatches.push(
        `Delivered items (${totalDeliveredItems}) vs commission records (${totalCommissionRecords}) mismatch`,
      );
    }

    const totalPlatformRevenue = Number(platformRevenueAgg._sum.totalPlatformAmount || 0);
    const totalSellerSettlements = Number(sellerSettlementsAgg._sum.totalSettlementAmount || 0);
    const totalPlatformMargin = Number(marginAgg._sum.platformMargin || 0);

    // Verify margin = revenue - settlements
    const calculatedMargin = Math.round((totalPlatformRevenue - totalSellerSettlements) * 100) / 100;
    const reportedMargin = Math.round(totalPlatformMargin * 100) / 100;

    if (Math.abs(calculatedMargin - reportedMargin) > 0.01) {
      mismatches.push(
        `Margin mismatch: calculated ${calculatedMargin} vs reported ${reportedMargin}`,
      );
    }

    return {
      totalPlatformRevenue,
      totalSellerSettlements,
      totalPlatformMargin,
      pendingSettlements: {
        count: pendingAgg._count.id,
        amount: Number(pendingAgg._sum.totalSettlementAmount || 0),
        platformAmount: Number(pendingAgg._sum.totalPlatformAmount || 0),
      },
      settledPayments: {
        count: settledAgg._count.id,
        amount: Number(settledAgg._sum.totalSettlementAmount || 0),
      },
      totalDeliveredItems,
      totalCommissionRecords,
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }

  // ── Adjustments ─────────────────────────────────────────────────

  /**
   * Manual adjustment on a settlement. Allowed only while the parent
   * cycle is APPROVED (not PAID) — once paid, adjustments must be
   * done in the next cycle. Sign convention: positive adds to payout.
   */
  async recordAdjustment(args: {
    settlementId: string;
    amount: number;
    reason: string;
    notes?: string;
    adjustmentType?: string;
    referenceDocumentUrl?: string;
    idempotencyKey?: string;
    adminId?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (!Number.isFinite(args.amount) || args.amount === 0) {
      throw new BadRequestAppException('amount must be a non-zero number');
    }
    // Phase 147 — sanity bound: an adjustment can't exceed ₹10,00,000 either way
    // (guards a fat-finger that would dwarf the settlement).
    if (Math.abs(args.amount) > 1_000_000) {
      throw new BadRequestAppException('amount out of range (max ±1,000,000)');
    }
    const safeReason = (args.reason ?? '').replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      throw new BadRequestAppException('reason (min 3 chars) is required');
    }
    const safeNotes = args.notes
      ? args.notes.replace(/<[^>]*>/g, '').trim().slice(0, 2000) || null
      : null;
    const adjustmentType = args.adjustmentType ?? 'OTHER';
    const paiseIncrement = toPaise(args.amount.toFixed(2));

    // Phase 147 — idempotency: if this key already produced an adjustment,
    // return it instead of double-applying (network-retry safety).
    if (args.idempotencyKey) {
      const existing = await this.prisma.settlementAdjustment.findFirst({
        where: { idempotencyKey: args.idempotencyKey },
      });
      if (existing) return existing;
    }

    let outcome: { created: any; prevTotal: number; sellerId: string; cycleId: string };
    try {
      // Phase 147 — the row create + the parent settlement net + the cycle
      // aggregate all move together (was three unguarded writes).
      outcome = await this.prisma.$transaction(async (tx) => {
        const settlement = await tx.sellerSettlement.findUnique({
          where: { id: args.settlementId },
          include: { cycle: true },
        });
        if (!settlement) throw new NotFoundAppException('Settlement not found');
        if (settlement.status === 'PAID') {
          throw new BadRequestAppException(
            'Cannot adjust a PAID settlement; use a follow-up cycle',
          );
        }
        if (settlement.cycle.status === 'PAID') {
          throw new BadRequestAppException(
            'Cannot adjust a settlement whose cycle is already PAID',
          );
        }
        // Phase 153 — a settlement locked into an active payout batch already
        // had its amount snapshotted onto the Payout row + (likely) exported to
        // the bank file. Adjusting it now would leave the bank paying the stale
        // pre-adjustment amount while the settlement total moved — a guaranteed
        // reconciliation break. Cancel the batch (which releases the lock) or
        // adjust in the next cycle.
        if (settlement.payoutBatchId) {
          throw new BadRequestAppException(
            'Cannot adjust a settlement that is in an active payout batch ' +
              `(${settlement.payoutBatchId}). Cancel the batch to release it, or adjust in the next cycle.`,
          );
        }

        const created = await tx.settlementAdjustment.create({
          data: this.moneyDualWrite.applyPaise('settlementAdjustment', {
            settlementId: args.settlementId,
            amount: args.amount.toFixed(2),
            adjustmentType: adjustmentType as any,
            status: 'ACTIVE' as any,
            reason: safeReason,
            notes: safeNotes,
            referenceDocumentUrl: args.referenceDocumentUrl?.trim() || null,
            createdByAdminId: args.adminId ?? null,
            idempotencyKey: args.idempotencyKey ?? null,
          }),
        });

        // totalSettlementAmount = current NET payable (gross + active
        // adjustments); approvedSettlementAmount keeps the immutable gross.
        await tx.sellerSettlement.update({
          where: { id: args.settlementId },
          data: {
            totalSettlementAmount: { increment: args.amount },
            ...(paiseIncrement !== null
              ? { totalSettlementAmountInPaise: { increment: paiseIncrement } }
              : {}),
          },
        });
        // Phase 147 — keep the parent cycle aggregate in sync (was stale).
        await tx.settlementCycle.update({
          where: { id: settlement.cycleId },
          data: {
            totalAmount: { increment: args.amount },
            ...(paiseIncrement !== null
              ? { totalAmountInPaise: { increment: paiseIncrement } }
              : {}),
          },
        });

        return {
          created,
          prevTotal: Number(settlement.totalSettlementAmount),
          sellerId: settlement.sellerId,
          cycleId: settlement.cycleId,
        };
      });
    } catch (err) {
      // Concurrent same-key insert lost the race → return the winner's row.
      if (
        args.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.settlementAdjustment.findFirst({
          where: { idempotencyKey: args.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }

    this.audit
      .writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'settlement.adjust',
        module: 'settlements',
        resource: 'seller_settlement',
        resourceId: args.settlementId,
        oldValue: { totalSettlementAmount: outcome.prevTotal },
        newValue: {
          amount: args.amount,
          adjustmentType,
          reason: safeReason,
          newTotal: outcome.prevTotal + args.amount,
        },
        metadata: {
          sellerId: outcome.sellerId,
          cycleId: outcome.cycleId,
          adjustmentId: outcome.created.id,
        },
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      })
      .catch((e) => this.logger.error(`Adjustment audit failed: ${e}`));

    return outcome.created;
  }

  /* ── Phase 147: Void an adjustment (reverses its effect on the totals) ── */
  async voidAdjustment(
    adjustmentId: string,
    args: {
      adminId?: string;
      voidReason: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const safeReason = (args.voidReason ?? '').replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      throw new BadRequestAppException('A void reason (min 3 chars) is required.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const adj = await tx.settlementAdjustment.findUnique({
        where: { id: adjustmentId },
        include: { settlement: { include: { cycle: true } } },
      });
      if (!adj) throw new NotFoundAppException('Adjustment not found');
      if (adj.status === 'VOIDED') {
        return { alreadyVoided: true, adj };
      }
      if (adj.settlement.status === 'PAID' || adj.settlement.cycle.status === 'PAID') {
        throw new BadRequestAppException(
          'Cannot void an adjustment on a paid settlement/cycle; use the reversal flow.',
        );
      }
      // Phase 153 — symmetry with recordAdjustment (lines 1708–1719): a
      // settlement locked into an active payout batch has already had its net
      // snapshotted onto the Payout row + (likely) exported to the bank file.
      // Voiding an adjustment now moves the settlement net while the batch pays
      // the stale amount — the same reconciliation break recordAdjustment
      // refuses. Cancel the batch (which releases the lock), then void.
      if (adj.settlement.payoutBatchId) {
        throw new BadRequestAppException(
          'Cannot void an adjustment on a settlement that is in an active payout batch ' +
            `(${adj.settlement.payoutBatchId}). Cancel the batch to release it, or use the reversal flow.`,
        );
      }

      const claim = await tx.settlementAdjustment.updateMany({
        where: { id: adjustmentId, status: 'ACTIVE' },
        data: {
          status: 'VOIDED',
          voidedByAdminId: args.adminId ?? null,
          voidedAt: new Date(),
          voidReason: safeReason,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException('Adjustment changed state concurrently');
      }

      // Reverse the effect on the settlement net + the cycle aggregate.
      const amt = Number(adj.amount);
      const paiseDec = toPaise(amt.toFixed(2));
      await tx.sellerSettlement.update({
        where: { id: adj.settlementId },
        data: {
          totalSettlementAmount: { decrement: amt },
          ...(paiseDec !== null
            ? { totalSettlementAmountInPaise: { decrement: paiseDec } }
            : {}),
        },
      });
      await tx.settlementCycle.update({
        where: { id: adj.settlement.cycleId },
        data: {
          totalAmount: { decrement: amt },
          ...(paiseDec !== null
            ? { totalAmountInPaise: { decrement: paiseDec } }
            : {}),
        },
      });
      return { alreadyVoided: false, adj };
    });

    if (!result.alreadyVoided) {
      this.audit
        .writeAuditLog({
          actorId: args.adminId,
          actorRole: 'ADMIN',
          action: 'settlement.adjust_void',
          module: 'settlements',
          resource: 'settlement_adjustment',
          resourceId: adjustmentId,
          oldValue: { status: 'ACTIVE', amount: Number(result.adj.amount) },
          newValue: { status: 'VOIDED', reason: safeReason },
          metadata: {
            settlementId: result.adj.settlementId,
            cycleId: result.adj.settlement.cycleId,
          },
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
        })
        .catch((e) => this.logger.error(`Void audit failed: ${e}`));
    }

    return {
      success: true,
      message: result.alreadyVoided
        ? 'Adjustment was already voided'
        : 'Adjustment voided',
      adjustmentId,
    };
  }

  async listAdjustments(settlementId: string, page = 1, limit = 50) {
    const take = Math.min(200, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.settlementAdjustment.findMany({
        where: { settlementId },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.settlementAdjustment.count({ where: { settlementId } }),
    ]);
    return { items, total, page: Math.max(1, page), limit: take };
  }

  /**
   * Phase 3.5 (2026-05-16) — Tally / accounting-package CSV export.
   *
   * Generates a CSV in the format Tally Prime expects for the "Import
   * Vouchers" workflow. One row per SellerSettlement in the cycle.
   * Columns:
   *   - Voucher Date         (cycle.periodEnd in DD/MM/YYYY)
   *   - Voucher No           (auto: SM/<cycleId-short>/<index>)
   *   - Voucher Type         (always "Payment" — Tally's standard for
   *                          marketplace-to-seller settlements)
   *   - Particulars (DR)     (the seller's name — Tally maps this to
   *                          their pre-created ledger account)
   *   - Particulars (CR)     ("SportSmart Bank" — our payout bank ledger)
   *   - Amount               (Rupees with 2 decimal places)
   *   - Narration            (seller-readable description with cycle
   *                          + period + commission summary)
   *
   * The exported file is what finance hands to their book-keeper for
   * monthly close. Once Tally / QuickBooks / Zoho all accept the same
   * shape (with minor header tweaks), this becomes the single source
   * for any accounting-package export. Future task: refactor into a
   * pluggable formatter (`TallyAccountingExporter`,
   * `QuickBooksAccountingExporter`) once we have a second consumer.
   */
  async exportCycleToTallyCsv(
    cycleId: string,
    actor?: { adminId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          include: {
            seller: {
              select: {
                sellerShopName: true,
                sellerName: true,
                gstin: true,
                legalBusinessName: true,
                gstStateCode: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        // Phase 148 — franchise payouts in the same cycle were invisible.
        franchiseSettlements: {
          include: {
            franchise: {
              select: {
                businessName: true,
                gstNumber: true,
                panNumber: true,
                gstStateCode: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cycle) throw new NotFoundAppException(`SettlementCycle ${cycleId} not found`);

    const dateStr = formatDDMMYYYY(cycle.periodEnd ?? new Date());
    // Phase 148 — 12-char cycle prefix (was 8) to cut voucher-no collision risk.
    const cyclePrefix = cycle.id.slice(0, 12).toUpperCase();
    const periodStr =
      cycle.periodStart && cycle.periodEnd
        ? `${formatDDMMYYYY(cycle.periodStart)} to ${formatDDMMYYYY(cycle.periodEnd)}`
        : 'unknown period';
    const periodStart = cycle.periodStart ? formatDDMMYYYY(cycle.periodStart) : '';
    const periodEnd = cycle.periodEnd ? formatDDMMYYYY(cycle.periodEnd) : '';
    const rupees = (p: bigint | number | null | undefined) =>
      (Number(p ?? 0) / 100).toFixed(2);

    type Row = Record<string, string>;
    const rows: Row[] = [];

    cycle.sellerSettlements.forEach((s, idx) => {
      const party =
        s.seller?.sellerShopName?.trim() ||
        s.seller?.sellerName?.trim() ||
        `Seller ${s.sellerId.slice(0, 8)}`;
      const net = Number(s.totalSettlementAmount);
      const approved = Number(s.approvedSettlementAmount ?? s.totalSettlementAmount);
      rows.push({
        'Cycle ID': cycle.id,
        'Period Start': periodStart,
        'Period End': periodEnd,
        'Settlement Type': 'SELLER',
        'Voucher Date': dateStr,
        'Voucher No': `SM/${cyclePrefix}/S${(idx + 1).toString().padStart(4, '0')}`,
        'Voucher Type': 'Payment',
        'Party Name': party,
        // PAN is embedded in the GSTIN (chars 3-12) when present.
        GSTIN: s.seller?.gstin ?? '',
        PAN: s.seller?.gstin ? s.seller.gstin.slice(2, 12) : '',
        'Legal Name': s.seller?.legalBusinessName ?? '',
        'State Code': s.seller?.gstStateCode ?? '',
        'Approved Amount': approved.toFixed(2),
        'Adjustments Total': (net - approved).toFixed(2),
        'Net Payable': net.toFixed(2),
        'TCS Deducted': rupees(s.tcsDeductedInPaise),
        'TDS Deducted': rupees(s.tdsDeductedInPaise),
        'CGST On Commission': rupees(s.cgstOnCommissionInPaise),
        'SGST On Commission': rupees(s.sgstOnCommissionInPaise),
        'IGST On Commission': rupees(s.igstOnCommissionInPaise),
        'Total Commission GST': rupees(s.totalCommissionGstInPaise),
        'Payment Status': s.status,
        'Paid Date': s.paidAt ? formatDDMMYYYY(s.paidAt) : '',
        'UTR Reference': s.utrReference ?? '',
        'Particulars (DR)': party,
        'Particulars (CR)': 'SportSmart Bank',
        Narration:
          `Settlement ${cyclePrefix} for ${party} — ${periodStr}, ` +
          `items=${s.totalItems ?? 0}, platform margin Rs ${Number(s.totalPlatformMargin ?? 0).toFixed(2)}`,
      });
    });

    cycle.franchiseSettlements.forEach((f, idx) => {
      const party = f.franchise?.businessName?.trim() || `Franchise ${f.franchiseId.slice(0, 8)}`;
      const net = Number(f.netPayableToFranchise ?? 0);
      rows.push({
        'Cycle ID': cycle.id,
        'Period Start': periodStart,
        'Period End': periodEnd,
        'Settlement Type': 'FRANCHISE',
        'Voucher Date': dateStr,
        'Voucher No': `SM/${cyclePrefix}/F${(idx + 1).toString().padStart(4, '0')}`,
        'Voucher Type': 'Payment',
        'Party Name': party,
        GSTIN: f.franchise?.gstNumber ?? '',
        PAN: f.franchise?.panNumber ?? '',
        'Legal Name': party,
        'State Code': f.franchise?.gstStateCode ?? '',
        // Franchise settlements have no adjustment ledger; net == approved.
        'Approved Amount': net.toFixed(2),
        'Adjustments Total': '0.00',
        'Net Payable': net.toFixed(2),
        // Seller-commission TCS/TDS/GST don't apply to the franchise model.
        'TCS Deducted': '',
        'TDS Deducted': '',
        'CGST On Commission': '',
        'SGST On Commission': '',
        'IGST On Commission': '',
        'Total Commission GST': '',
        'Payment Status': f.status,
        'Paid Date': f.paidAt ? formatDDMMYYYY(f.paidAt) : '',
        'UTR Reference': f.paymentReference ?? '',
        'Particulars (DR)': party,
        'Particulars (CR)': 'SportSmart Bank',
        Narration: `Franchise settlement ${cyclePrefix} for ${party} — ${periodStr}`,
      });
    });

    const headers = [
      'Cycle ID', 'Period Start', 'Period End', 'Settlement Type',
      'Voucher Date', 'Voucher No', 'Voucher Type', 'Party Name',
      'GSTIN', 'PAN', 'Legal Name', 'State Code',
      'Approved Amount', 'Adjustments Total', 'Net Payable',
      'TCS Deducted', 'TDS Deducted',
      'CGST On Commission', 'SGST On Commission', 'IGST On Commission', 'Total Commission GST',
      'Payment Status', 'Paid Date', 'UTR Reference',
      'Particulars (DR)', 'Particulars (CR)', 'Narration',
    ];

    // Phase 148 — exporting a cycle's payment vouchers (seller financials) must
    // leave a forensic trail. Best-effort; never blocks the download.
    if (actor?.adminId) {
      this.audit
        .writeAuditLog({
          actorId: actor.adminId,
          actorRole: 'ADMIN',
          action: 'settlement.cycle_exported',
          module: 'settlements',
          resource: 'settlement_cycle',
          resourceId: cycleId,
          newValue: {
            rowCount: rows.length,
            sellerCount: cycle.sellerSettlements.length,
            franchiseCount: cycle.franchiseSettlements.length,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })
        .catch((e) => this.logger.error(`Cycle export audit failed: ${e}`));
    }

    // toCsv (shared util) handles RFC-4180 quoting AND formula-injection
    // neutralisation for every cell; BOM so Excel/Tally read Indic names.
    return toCsv(rows, headers, { bom: true });
  }

  /**
   * Phase 3.5 — opening / closing balance per seller for a cycle.
   *
   * Opening balance = sum of every PAID settlement amount for this
   * seller BEFORE the cycle start. Closing balance = opening + this
   * cycle's settlement. Used by finance for monthly close
   * reconciliation alongside the Tally CSV export.
   *
   * Read-only — no writes, no side effects.
   */
  async computeOpeningClosingBalance(
    cycleId: string,
  ): Promise<
    Array<{
      settlementType: 'SELLER' | 'FRANCHISE';
      sellerId: string;
      sellerName: string;
      paymentStatus: string;
      openingBalanceInPaise: string;
      cycleEarningsInPaise: string;
      cycleAdjustmentsInPaise: string;
      cycleAmountInPaise: string;
      cyclePaidInPaise: string;
      closingBalanceInPaise: string;
    }>
  > {
    // Phase 149 — TRUE outstanding-balance ledger (was "cumulative-paid +
    // cycle-amount", which is a running payment flow, not a balance):
    //   opening  = outstanding carried forward = SUM of prior settlements still
    //              owed (status NOT PAID/CANCELLED) whose cycle period precedes
    //              this one. (This equals the prior cycle's closing balance.)
    //   closing  = opening + cycleNet − cyclePaid  (= outstanding after).
    // Computed at read time from current state; deterministic for finalised
    // cycles because Phase 147 forbids adjusting a PAID settlement.
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          include: { seller: { select: { sellerShopName: true } } },
        },
        franchiseSettlements: {
          include: { franchise: { select: { businessName: true } } },
        },
      },
    });
    if (!cycle || !cycle.periodStart) {
      throw new NotFoundAppException(
        `SettlementCycle ${cycleId} not found or has no periodStart`,
      );
    }
    const periodStart = cycle.periodStart;

    // ── Prior outstanding (single query each — no N+1) ──
    const sellerIds = cycle.sellerSettlements.map((s) => s.sellerId);
    const priorSellerOutstanding = new Map<string, bigint>();
    if (sellerIds.length > 0) {
      const prior = await this.prisma.sellerSettlement.findMany({
        where: {
          sellerId: { in: sellerIds },
          // Owed-but-not-settled (CANCELLED is voided, not owed).
          status: { notIn: ['PAID', 'CANCELLED'] },
          // Belongs to an EARLIER cycle (by the cycle's period, not row createdAt).
          cycle: { periodStart: { lt: periodStart } },
        },
        select: { sellerId: true, totalSettlementAmountInPaise: true },
      });
      for (const r of prior) {
        priorSellerOutstanding.set(
          r.sellerId,
          (priorSellerOutstanding.get(r.sellerId) ?? 0n) +
            (r.totalSettlementAmountInPaise ?? 0n),
        );
      }
    }

    const franchiseIds = cycle.franchiseSettlements.map((f) => f.franchiseId);
    const priorFranchiseOutstanding = new Map<string, bigint>();
    if (franchiseIds.length > 0) {
      const prior = await this.prisma.franchiseSettlement.findMany({
        where: {
          franchiseId: { in: franchiseIds },
          status: { not: 'PAID' },
          cycle: { periodStart: { lt: periodStart } },
        },
        select: { franchiseId: true, netPayableToFranchise: true },
      });
      for (const r of prior) {
        const paise = BigInt(
          new Prisma.Decimal(r.netPayableToFranchise ?? 0).mul(100).toFixed(0),
        );
        priorFranchiseOutstanding.set(
          r.franchiseId,
          (priorFranchiseOutstanding.get(r.franchiseId) ?? 0n) + paise,
        );
      }
    }

    const out: Array<{
      settlementType: 'SELLER' | 'FRANCHISE';
      sellerId: string;
      sellerName: string;
      paymentStatus: string;
      openingBalanceInPaise: string;
      cycleEarningsInPaise: string;
      cycleAdjustmentsInPaise: string;
      cycleAmountInPaise: string;
      cyclePaidInPaise: string;
      closingBalanceInPaise: string;
    }> = [];

    for (const s of cycle.sellerSettlements) {
      const opening = priorSellerOutstanding.get(s.sellerId) ?? 0n;
      const net = s.totalSettlementAmountInPaise ?? 0n; // earnings + adjustments
      const earnings = s.approvedSettlementAmountInPaise ?? net;
      const adjustments = net - earnings;
      const paid = s.status === 'PAID' ? net : 0n;
      const closing = opening + net - paid;
      out.push({
        settlementType: 'SELLER',
        sellerId: s.sellerId,
        sellerName:
          s.seller?.sellerShopName?.trim() ?? `Seller ${s.sellerId.slice(0, 8)}`,
        paymentStatus: s.status,
        openingBalanceInPaise: opening.toString(),
        cycleEarningsInPaise: earnings.toString(),
        cycleAdjustmentsInPaise: adjustments.toString(),
        cycleAmountInPaise: net.toString(),
        cyclePaidInPaise: paid.toString(),
        closingBalanceInPaise: closing.toString(),
      });
    }

    for (const f of cycle.franchiseSettlements) {
      const opening = priorFranchiseOutstanding.get(f.franchiseId) ?? 0n;
      const net = BigInt(
        new Prisma.Decimal(f.netPayableToFranchise ?? 0).mul(100).toFixed(0),
      );
      const paid = f.status === 'PAID' ? net : 0n;
      const closing = opening + net - paid;
      out.push({
        settlementType: 'FRANCHISE',
        sellerId: f.franchiseId,
        sellerName:
          f.franchise?.businessName?.trim() ?? `Franchise ${f.franchiseId.slice(0, 8)}`,
        paymentStatus: f.status,
        openingBalanceInPaise: opening.toString(),
        cycleEarningsInPaise: net.toString(), // no separate franchise adjustment ledger
        cycleAdjustmentsInPaise: '0',
        cycleAmountInPaise: net.toString(),
        cyclePaidInPaise: paid.toString(),
        closingBalanceInPaise: closing.toString(),
      });
    }

    return out;
  }
}

function formatDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Phase 148 — the inline csvQuote (RFC-4180 only, formula-injection-vulnerable)
// was removed; exportCycleToTallyCsv now uses the shared toCsv() which
// neutralises =/+/-/@-leading cells.
