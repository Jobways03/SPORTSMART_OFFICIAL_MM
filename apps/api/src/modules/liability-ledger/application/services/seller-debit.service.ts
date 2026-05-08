import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  SellerDebit,
  SellerDebitStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

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

  /** Ops cancel: seller successfully contested the debit. */
  async cancel(id: string, _reason: string): Promise<SellerDebit> {
    return this.prisma.sellerDebit.update({
      where: { id },
      data: { status: 'CANCELLED' as SellerDebitStatus },
    });
  }
}
