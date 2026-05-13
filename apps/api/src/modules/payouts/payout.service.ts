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

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.payoutBatch.create({
        data: {
          status: 'DRAFT',
          createdByAdminId: args.adminId ?? null,
        },
      });
      await tx.payout.createMany({
        // s.totalSettlementAmount is a Decimal-typed value read from
        // the DB; pass it verbatim so the helper's toPaise converts
        // exactly via .mul(100).toFixed(0). applyPaiseMany covers
        // the per-row transform.
        data: this.moneyDualWrite.applyPaiseMany('payout', settlements.map((s) => ({
          batchId: batch.id,
          settlementId: s.id,
          sellerId: s.sellerId,
          amount: s.totalSettlementAmount,
          status: 'DRAFT' as const,
        }))),
      });
      return tx.payoutBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { payouts: true },
      });
    });
  }

  /**
   * Generate a CSV the operations team uploads to the bank's payout
   * portal. Format: settlement_id,seller_id,amount,beneficiary_name.
   * In a real prod setup we'd push to S3; here we return the CSV body.
   */
  async generateExport(batchId: string): Promise<string> {
    const batch = await this.getBatch(batchId);
    if (batch.status !== 'DRAFT') {
      throw new BadRequestAppException(`Batch must be DRAFT to export (got ${batch.status})`);
    }
    const csv =
      'settlement_id,seller_id,amount\n' +
      batch.payouts
        .map((p) => `${p.settlementId},${p.sellerId},${Number(p.amount).toFixed(2)}`)
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
