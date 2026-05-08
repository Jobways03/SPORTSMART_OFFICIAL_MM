import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  LogisticsClaim,
  LogisticsClaimStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Logistics claim ledger. Created when a customer-favoured dispute is
 * attributed to courier fault: Sportsmart pays the customer first
 * (RefundInstruction → wallet) and a claim is filed against the
 * courier to recover. Lifecycle: PENDING → SUBMITTED → ACCEPTED →
 * RECOVERED. If REJECTED, finance reclassifies as a PlatformExpense.
 *
 * Idempotent on (sourceType, sourceId).
 */
@Injectable()
export class LogisticsClaimService {
  private readonly logger = new Logger(LogisticsClaimService.name);

  constructor(private readonly prisma: PrismaService) {}

  async file(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    courierName?: string | null;
    awbNumber?: string | null;
    amountInPaise: number;
    reason: string;
    evidenceFileId?: string | null;
    notes?: string | null;
  }): Promise<LogisticsClaim> {
    if (args.amountInPaise <= 0) {
      throw new Error(
        `LogisticsClaim amount must be positive paise (got ${args.amountInPaise})`,
      );
    }
    try {
      const row = await this.prisma.logisticsClaim.create({
        data: {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          courierName: args.courierName ?? null,
          awbNumber: args.awbNumber ?? null,
          amountInPaise: BigInt(args.amountInPaise),
          reason: args.reason,
          evidenceFileId: args.evidenceFileId ?? null,
          notes: args.notes ?? null,
        },
      });
      this.logger.log(
        `LogisticsClaim ${row.id} filed: source=${args.sourceType}:${args.sourceId} courier=${args.courierName ?? 'unknown'} ₹${(args.amountInPaise / 100).toFixed(2)}`,
      );
      return row;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.logisticsClaim.findUnique({
          where: {
            sourceType_sourceId: {
              sourceType: args.sourceType,
              sourceId: args.sourceId,
            },
          },
        });
        if (existing) {
          this.logger.log(
            `LogisticsClaim already exists for ${args.sourceType}:${args.sourceId} (idempotent reuse)`,
          );
          return existing;
        }
      }
      throw err;
    }
  }

  async transition(
    id: string,
    nextStatus: LogisticsClaimStatus,
    extra?: { recoveredAt?: Date; notes?: string },
  ): Promise<LogisticsClaim> {
    return this.prisma.logisticsClaim.update({
      where: { id },
      data: {
        status: nextStatus,
        submittedAt: nextStatus === 'SUBMITTED' ? new Date() : undefined,
        recoveredAt:
          nextStatus === 'RECOVERED'
            ? extra?.recoveredAt ?? new Date()
            : undefined,
        notes: extra?.notes ?? undefined,
      },
    });
  }
}
