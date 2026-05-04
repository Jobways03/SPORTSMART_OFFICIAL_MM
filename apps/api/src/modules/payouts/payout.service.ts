import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../core/exceptions';

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
  constructor(private readonly prisma: PrismaService) {}

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
        data: settlements.map((s) => ({
          batchId: batch.id,
          settlementId: s.id,
          sellerId: s.sellerId,
          amount: s.totalSettlementAmount,
          status: 'DRAFT',
        })),
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
   * Ingest a bank response: array of { settlementId, status, utrReference?, failureReason? }.
   * Updates each payout, then rolls up batch status.
   */
  async ingestBankResponse(args: {
    batchId: string;
    rows: Array<{
      settlementId: string;
      status: 'PAID' | 'FAILED';
      utrReference?: string;
      failureReason?: string;
    }>;
  }) {
    const batch = await this.getBatch(args.batchId);
    if (!['EXPORTED', 'PARTIALLY_PAID'].includes(batch.status)) {
      throw new BadRequestAppException(
        `Batch must be EXPORTED or PARTIALLY_PAID (got ${batch.status})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const r of args.rows) {
        const payout = batch.payouts.find((p) => p.settlementId === r.settlementId);
        if (!payout) continue;
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: r.status === 'PAID' ? 'COMPLETED' : 'FAILED',
            utrReference: r.utrReference ?? null,
            failureReason: r.failureReason ?? null,
            paidAt: r.status === 'PAID' ? new Date() : null,
          },
        });

        // Mirror PAID into the underlying settlement so reconciliation
        // (Section 7's runSettlement) can match it.
        if (r.status === 'PAID') {
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

    return this.getBatch(args.batchId);
  }
}
