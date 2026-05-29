import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  SellerDebit,
  SellerDebitStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Seller-debit ledger. A row here records money the platform must
 * recover from the seller's next settlement. Created when a dispute or
 * return outcome assigns liability to the seller.
 *
 * The settlement run reads `status=PENDING` rows and offsets payouts;
 * applied rows flip to `APPLIED` with `settlementId` filled. Disputed
 * debits (seller contests) move to `CANCELLED` via an admin action and
 * a follow-up `PlatformExpense` typically absorbs the cost.
 *
 * Idempotency: `(sourceType, sourceId)` UNIQUE — a saga retry that
 * tries to write the same debit twice hits the constraint and we
 * silently return the existing row.
 */
@Injectable()
export class SellerDebitService {
  private readonly logger = new Logger(SellerDebitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(args: {
    sellerId: string;
    sourceType: LedgerSourceType;
    sourceId: string;
    orderId?: string | null;
    subOrderId?: string | null;
    amountInPaise: number;
    reason: string;
  }): Promise<SellerDebit> {
    if (args.amountInPaise <= 0) {
      throw new Error(
        `SellerDebit amount must be positive paise (got ${args.amountInPaise})`,
      );
    }
    try {
      const row = await this.prisma.sellerDebit.create({
        data: {
          sellerId: args.sellerId,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          orderId: args.orderId ?? null,
          subOrderId: args.subOrderId ?? null,
          amountInPaise: BigInt(args.amountInPaise),
          reason: args.reason,
        },
      });
      this.logger.log(
        `SellerDebit ${row.id} recorded: seller=${args.sellerId} source=${args.sourceType}:${args.sourceId} ₹${(args.amountInPaise / 100).toFixed(2)}`,
      );
      return row;
    } catch (err) {
      // Idempotency: same (sourceType, sourceId) pair — a saga replay.
      // Return the existing row so callers don't error.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.sellerDebit.findUnique({
          where: {
            sourceType_sourceId: {
              sourceType: args.sourceType,
              sourceId: args.sourceId,
            },
          },
        });
        if (existing) {
          this.logger.log(
            `SellerDebit already exists for ${args.sourceType}:${args.sourceId} (idempotent reuse)`,
          );
          return existing;
        }
      }
      throw err;
    }
  }

  /** Settlement run hook — flip PENDING → APPLIED with the cycle id. */
  async markApplied(id: string, settlementId: string): Promise<SellerDebit> {
    return this.prisma.sellerDebit.update({
      where: { id },
      data: {
        status: 'APPLIED' as SellerDebitStatus,
        settlementId,
        settlementAdjustedAt: new Date(),
      },
    });
  }

  /**
   * Ops cancel: seller successfully contested the debit.
   *
   * Phase 150 — status-guarded (was an unconditional flip):
   *   - PENDING   → CANCELLED (CAS on status, so a racing settlement-apply
   *     can't be clobbered).
   *   - CANCELLED → idempotent no-op (returns the row).
   *   - APPLIED   → 400. The settlement run already netted this debit off the
   *     seller's payout; cancelling the row would silently under-recover. The
   *     correct reversal is to VOID the linked SettlementAdjustment.
   */
  async cancel(id: string, reason: string): Promise<SellerDebit> {
    const row = await this.prisma.sellerDebit.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundAppException(`SellerDebit ${id} not found`);
    }
    if (row.status === 'CANCELLED') return row; // idempotent
    if (row.status !== 'PENDING') {
      throw new BadRequestAppException(
        `SellerDebit ${id} is ${row.status}; only PENDING debits can be ` +
          `cancelled. It was already netted into settlement ` +
          `${row.settlementId ?? '(unknown)'} — void that settlement ` +
          `adjustment to reverse it.`,
      );
    }
    const result = await this.prisma.sellerDebit.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED' as SellerDebitStatus },
    });
    if (result.count === 0) {
      throw new ConflictAppException(
        `SellerDebit ${id} changed state concurrently — retry.`,
      );
    }
    this.logger.log(`SellerDebit ${id} cancelled: ${reason}`);
    return this.prisma.sellerDebit.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Phase 127 — reverse the debit for a source (e.g. a dispute whose refund
   * finance rejected). Idempotent + safe:
   *   - PENDING   → CANCELLED ('reversed')
   *   - CANCELLED → no-op ('already_reversed') — replay-safe
   *   - APPLIED   → left alone ('needs_manual'): the settlement run already
   *     offset the seller's payout, so undoing it is a settlement reversal,
   *     not a status flip — the caller escalates to ops.
   *   - no row    → 'none'
   */
  async reverseForSource(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
  }): Promise<'reversed' | 'already_reversed' | 'needs_manual' | 'none'> {
    const row = await this.prisma.sellerDebit.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
        },
      },
    });
    if (!row) return 'none';
    if (row.status === 'CANCELLED') return 'already_reversed';
    if (row.status !== 'PENDING') {
      this.logger.warn(
        `SellerDebit ${row.id} is ${row.status}, not PENDING — settlement already applied; ` +
          `manual reversal needed for ${args.sourceType}:${args.sourceId}`,
      );
      return 'needs_manual';
    }
    await this.prisma.sellerDebit.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' as SellerDebitStatus },
    });
    this.logger.log(
      `SellerDebit ${row.id} reversed (CANCELLED) for ${args.sourceType}:${args.sourceId}: ${args.reason}`,
    );
    return 'reversed';
  }
}
