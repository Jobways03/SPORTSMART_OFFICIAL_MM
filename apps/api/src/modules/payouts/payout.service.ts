import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../core/exceptions';
import { MoneyDualWriteHelper } from '../../core/money/money-dual-write.helper';

/**
 * Payout batches wrap APPROVED settlements into a bank-export job.
 * Workflow:
 *   1. createBatch(cycleId)       — pulls APPROVED SellerSettlements into Payout rows
 *   2. exportFile(batchId)        — generates NEFT CSV; flips DRAFT → EXPORTED
 *   3. ingestBankResponse(batchId, fileId) — admin uploads bank confirmation;
 *                                    matches by settlementId, marks paid + UTR
 *   4. retry(payoutId)            — restart a failed payout in a new batch
 */
@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 7 (PR 7.7) — paise-sibling dual-write for the
    // payout.createMany call (amount → amountInPaise per row).
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  async listBatches() {
    return this.prisma.payoutBatch.findMany({
      include: { _count: { select: { payouts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getBatch(id: string) {
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id },
      include: { payouts: true },
    });
    if (!batch) throw new NotFoundAppException('Batch not found');
    return batch;
  }

  /**
   * Create a payout batch from APPROVED-but-not-yet-paid settlements
   * within the cycle. Skips settlements already in a non-failed batch.
   *
   * Phase 3.7 (2026-05-16) — pre-batch gates:
   *   1. **KYC gate** — skip any settlement whose seller is not in
   *      `verificationStatus=VERIFIED`. A seller with unverified KYC
   *      cannot legally receive payouts (RBI / PMLA requirements);
   *      sending the money out and then trying to reverse it is much
   *      more expensive than holding it on our side until KYC clears.
   *   2. **Dispute block** — skip any settlement whose seller has an
   *      open or in-review dispute. The dispute decision may require
   *      a refund out of the settlement amount; paying out first and
   *      then chasing the seller for the refund is a known bad pattern.
   *   3. **Soft-deleted seller** — skip any deleted seller row.
   *
   * Skipped settlements stay in `status=APPROVED` and reappear in the
   * next batch attempt automatically. The caller receives a `skipped`
   * array with the reason per row so the admin queue surfaces why
   * specific sellers were not paid out this cycle.
   */
  async createBatch(args: { cycleId: string; adminId?: string }) {
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId: args.cycleId, status: 'APPROVED' },
    });
    if (settlements.length === 0) {
      throw new BadRequestAppException(
        'No APPROVED settlements ready for payout in this cycle',
      );
    }

    // Load every seller + dispute state in two batched queries so we
    // don't fire N+1 lookups inside the transaction body.
    const sellerIds = Array.from(new Set(settlements.map((s) => s.sellerId)));
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: sellerIds } },
      select: {
        id: true,
        verificationStatus: true,
        isDeleted: true,
        status: true,
      },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    // Disputes that block payout — OPEN / UNDER_REVIEW means the
    // platform may owe money out of this seller's settlement. Dispute
    // relates to seller via SubOrder (raw subOrderId column, no
    // Prisma relation defined). Two-step query: load disputes by
    // status, then resolve subOrder → sellerId. Closed disputes
    // (RESOLVED_BUYER / RESOLVED_SELLER / RESOLVED_SPLIT) are safe.
    const openDisputes = await this.prisma.dispute.findMany({
      where: {
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
      select: { id: true, subOrderId: true },
    });
    const openDisputeSubOrderIds = openDisputes
      .map((d) => d.subOrderId)
      .filter((x): x is string => !!x);
    const disputedSubOrders =
      openDisputeSubOrderIds.length > 0
        ? await this.prisma.subOrder.findMany({
            where: {
              id: { in: openDisputeSubOrderIds },
              sellerId: { in: sellerIds },
            },
            select: { sellerId: true },
          })
        : [];
    const sellersWithOpenDispute = new Set(
      disputedSubOrders.map((s) => s.sellerId).filter((x): x is string => !!x),
    );

    const eligible: typeof settlements = [];
    const skipped: Array<{ settlementId: string; sellerId: string; reason: string }> = [];

    for (const s of settlements) {
      const seller = sellerById.get(s.sellerId);
      const reasons: string[] = [];
      if (!seller || seller.isDeleted) {
        reasons.push('SELLER_DELETED');
      } else {
        if (seller.verificationStatus !== 'VERIFIED') {
          reasons.push(`KYC_NOT_VERIFIED:${seller.verificationStatus}`);
        }
        if (seller.status !== 'ACTIVE') {
          reasons.push(`SELLER_NOT_ACTIVE:${seller.status}`);
        }
      }
      if (sellersWithOpenDispute.has(s.sellerId)) {
        reasons.push('OPEN_DISPUTE');
      }
      if (reasons.length === 0) {
        eligible.push(s);
      } else {
        skipped.push({
          settlementId: s.id,
          sellerId: s.sellerId,
          reason: reasons.join(','),
        });
      }
    }

    if (eligible.length === 0) {
      throw new BadRequestAppException(
        `All ${settlements.length} APPROVED settlements were blocked: ${skipped
          .slice(0, 5)
          .map((r) => `${r.sellerId}=${r.reason}`)
          .join('; ')}${skipped.length > 5 ? '…' : ''}. Resolve KYC / disputes and retry.`,
      );
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payoutBatch.create({
        data: {
          status: 'DRAFT',
          createdByAdminId: args.adminId ?? null,
        },
      });
      await tx.payout.createMany({
        data: this.moneyDualWrite.applyPaiseMany('payout', eligible.map((s) => ({
          batchId: created.id,
          settlementId: s.id,
          sellerId: s.sellerId,
          amount: s.totalSettlementAmount,
          status: 'DRAFT' as const,
        }))),
      });
      return tx.payoutBatch.findUniqueOrThrow({
        where: { id: created.id },
        include: { payouts: true },
      });
    });

    return { batch, skipped };
  }

  /**
   * Phase 3.7 (2026-05-16) — payout method routing by amount.
   *
   * Indian bank payout rails by amount:
   *   - UPI:  ≤ ₹1 lakh (instant; 24×7; lowest fee). RBI cap is ₹1 lakh
   *           per transaction for marketplace payouts.
   *   - IMPS: ₹1 lakh - ₹2 lakh (instant; 24×7; modest fee).
   *   - NEFT: > ₹2 lakh OR any amount during bank-hours batching
   *           (settles next batch window — typically same-day).
   *
   * The bank's portal accepts a single CSV with a `method` column;
   * the bank picks the actual rail based on this hint. Sellers can
   * override the method via their KYC profile in a later phase
   * (e.g. an enterprise seller may insist on RTGS for all payouts).
   */
  routePayoutMethod(amountInPaise: bigint): 'UPI' | 'IMPS' | 'NEFT' {
    const ONE_LAKH = 100_000_00n; // 1,00,000.00 in paise
    const TWO_LAKH = 200_000_00n;
    if (amountInPaise <= ONE_LAKH) return 'UPI';
    if (amountInPaise <= TWO_LAKH) return 'IMPS';
    return 'NEFT';
  }

  /**
   * Generate the CSV the operations team uploads to the bank's payout
   * portal. Each row carries:
   *   - settlement_id (our reference for the bank-response import)
   *   - seller_id     (internal traceability)
   *   - amount        (Rupees, 2 decimal places)
   *   - method        (UPI / IMPS / NEFT — routed by amount, see
   *                    routePayoutMethod)
   *
   * In a production setup the CSV is uploaded to a private S3 bucket
   * that the bank's batch-job pulls; for now we return the body for
   * the admin to download.
   */
  async generateExport(batchId: string): Promise<string> {
    const batch = await this.getBatch(batchId);
    if (batch.status !== 'DRAFT') {
      throw new BadRequestAppException(`Batch must be DRAFT to export (got ${batch.status})`);
    }
    const csv =
      'settlement_id,seller_id,amount,method\n' +
      batch.payouts
        .map((p) => {
          const method = this.routePayoutMethod(p.amountInPaise);
          return `${p.settlementId},${p.sellerId},${Number(p.amount).toFixed(2)},${method}`;
        })
        .join('\n');

    await this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: 'EXPORTED',
        exportedAt: new Date(),
      },
    });
    await this.prisma.payout.updateMany({
      where: { batchId },
      data: { status: 'EXPORTED' },
    });
    return csv;
  }

  /**
   * Ingest a bank response: array of { settlementId, status, paidAmountInPaise,
   * utrReference?, failureReason? }. Updates each payout, then rolls up
   * batch status.
   *
   * Phase 0 (PR 0.3) — silent-money-loss guard. Each PAID row now MUST
   * include `paidAmountInPaise`, the amount the bank actually disbursed.
   * It is compared against `settlement.totalSettlementAmountInPaise`
   * with a ±1-paise rounding tolerance. On mismatch the row is recorded
   * as `Payout.status='FAILED'` with a `BANK_AMOUNT_MISMATCH` reason,
   * the underlying settlement stays APPROVED, and finance ops is
   * expected to investigate before retrying. Soft-fail per-row keeps
   * the rest of the batch moving instead of bouncing 200 good rows
   * for one bad one.
   */
  async ingestBankResponse(args: {
    batchId: string;
    rows: Array<{
      settlementId: string;
      status: 'PAID' | 'FAILED';
      paidAmountInPaise?: number | bigint;
      utrReference?: string;
      failureReason?: string;
    }>;
  }): Promise<{ batch: Awaited<ReturnType<PayoutService['getBatch']>>; mismatches: Array<{ settlementId: string; expectedInPaise: string; actualInPaise: string }> }> {
    const batch = await this.getBatch(args.batchId);
    if (!['EXPORTED', 'PARTIALLY_PAID'].includes(batch.status)) {
      throw new BadRequestAppException(
        `Batch must be EXPORTED or PARTIALLY_PAID (got ${batch.status})`,
      );
    }

    // Load expected paise totals for every settlement in the batch in
    // one query so we don't issue N+1 lookups inside the tx.
    const settlementIds = batch.payouts.map((p) => p.settlementId);
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { id: { in: settlementIds } },
      select: { id: true, totalSettlementAmountInPaise: true },
    });
    const expectedByIdInPaise = new Map<string, bigint>(
      settlements.map((s) => [s.id, s.totalSettlementAmountInPaise]),
    );

    const mismatches: Array<{
      settlementId: string;
      expectedInPaise: string;
      actualInPaise: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const r of args.rows) {
        const payout = batch.payouts.find((p) => p.settlementId === r.settlementId);
        if (!payout) continue;

        // ── Phase 0 (PR 0.3) amount-check ────────────────────────────
        // For PAID rows, require an explicit `paidAmountInPaise` and
        // assert it matches the settlement's expected total (±1 paise
        // tolerance for rounding edge cases on the bank side). Reject
        // by demoting the row to FAILED rather than throwing the whole
        // batch — operators see exactly which rows need fixing.
        let effectiveStatus: 'PAID' | 'FAILED' = r.status;
        let effectiveReason = r.failureReason ?? null;
        if (r.status === 'PAID') {
          if (r.paidAmountInPaise === undefined || r.paidAmountInPaise === null) {
            effectiveStatus = 'FAILED';
            effectiveReason = 'BANK_AMOUNT_MISSING:paidAmountInPaise required for PAID rows';
          } else {
            const expected = expectedByIdInPaise.get(r.settlementId);
            if (expected === undefined) {
              // Defensive — the payout pointed to a settlement we
              // could not load. Surface as a FAILED row rather than
              // silently flipping anything.
              effectiveStatus = 'FAILED';
              effectiveReason = `SETTLEMENT_NOT_FOUND:${r.settlementId}`;
            } else {
              const actual = BigInt(r.paidAmountInPaise);
              const drift = actual > expected ? actual - expected : expected - actual;
              if (drift > 1n) {
                effectiveStatus = 'FAILED';
                effectiveReason = `BANK_AMOUNT_MISMATCH:expected=${expected.toString()} actual=${actual.toString()}`;
                mismatches.push({
                  settlementId: r.settlementId,
                  expectedInPaise: expected.toString(),
                  actualInPaise: actual.toString(),
                });
              }
            }
          }
        }

        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: effectiveStatus === 'PAID' ? 'COMPLETED' : 'FAILED',
            utrReference: r.utrReference ?? null,
            failureReason: effectiveReason,
            paidAt: effectiveStatus === 'PAID' ? new Date() : null,
          },
        });

        // Mirror PAID into the underlying settlement so reconciliation
        // (Section 7's runSettlement) can match it.
        // CRITICAL: only mirror when the amount check passed; a
        // mismatched row leaves the settlement APPROVED so finance ops
        // can re-upload after correction without unwinding state.
        if (effectiveStatus === 'PAID') {
          await tx.sellerSettlement.update({
            where: { id: r.settlementId },
            data: {
              status: 'PAID',
              paidAt: new Date(),
              utrReference: r.utrReference ?? null,
            },
          });
        }
      }

      // Roll up: all paid = COMPLETED; mixed = PARTIALLY_PAID; all
      // failed = FAILED.
      const fresh = await tx.payout.findMany({ where: { batchId: args.batchId } });
      const allPaid = fresh.every((p) => p.status === 'COMPLETED');
      const allFailed = fresh.every((p) => p.status === 'FAILED');
      const status = allPaid ? 'COMPLETED' : allFailed ? 'FAILED' : 'PARTIALLY_PAID';
      await tx.payoutBatch.update({
        where: { id: args.batchId },
        data: { status },
      });
    });

    const refreshed = await this.getBatch(args.batchId);
    return { batch: refreshed, mismatches };
  }
}
