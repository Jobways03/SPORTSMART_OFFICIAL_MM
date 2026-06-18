import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  LogisticsClaim,
  LogisticsClaimStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Allowed logistics-claim state transitions. The recovery lifecycle is a
 * strict DAG — PENDING → SUBMITTED → ACCEPTED → RECOVERED — with REJECTED
 * reachable from any in-flight state (courier denies the claim) and
 * CANCELLED only from PENDING (withdrawn before it's filed). Terminal
 * states (RECOVERED / REJECTED / CANCELLED) accept no further moves.
 */
const CLAIM_TRANSITIONS: Record<LogisticsClaimStatus, LogisticsClaimStatus[]> = {
  PENDING: ['SUBMITTED', 'REJECTED', 'CANCELLED'],
  SUBMITTED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['RECOVERED', 'REJECTED'],
  RECOVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

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
    const current = await this.prisma.logisticsClaim.findUnique({
      where: { id },
    });
    if (!current) {
      throw new BadRequestAppException(`Logistics claim ${id} not found`);
    }
    // Idempotent no-op: re-issuing the current status just returns the row.
    if (current.status === nextStatus) return current;
    const allowed = CLAIM_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestAppException(
        `Illegal logistics-claim transition ${current.status} → ${nextStatus}. ` +
          `From ${current.status} you can move to: ${allowed.join(', ') || '(none — terminal)'}.`,
      );
    }
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

  /**
   * Phase 127 — reverse the claim for a source (e.g. a dispute whose refund
   * finance rejected). Only a PENDING claim can be cancelled silently:
   *   - PENDING   → CANCELLED ('reversed')
   *   - CANCELLED → no-op ('already_reversed') — replay-safe
   *   - SUBMITTED/ACCEPTED/RECOVERED/REJECTED → 'needs_manual': a claim is
   *     already in flight with the courier; withdrawing it is an ops action.
   *   - no row    → 'none'
   */
  async reverseForSource(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
  }): Promise<'reversed' | 'already_reversed' | 'needs_manual' | 'none'> {
    const row = await this.prisma.logisticsClaim.findUnique({
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
        `LogisticsClaim ${row.id} is ${row.status}, not PENDING — claim already in flight; ` +
          `manual withdrawal needed for ${args.sourceType}:${args.sourceId}`,
      );
      return 'needs_manual';
    }
    await this.prisma.logisticsClaim.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' as LogisticsClaimStatus, notes: args.reason },
    });
    this.logger.log(
      `LogisticsClaim ${row.id} reversed (CANCELLED) for ${args.sourceType}:${args.sourceId}: ${args.reason}`,
    );
    return 'reversed';
  }
}
