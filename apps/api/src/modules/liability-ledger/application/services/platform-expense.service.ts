import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  PlatformExpense,
  PlatformExpenseType,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Platform-expense ledger. Used when the platform absorbs the cost:
 *   - GOODWILL — non-recourse credit issued to the customer
 *   - PLATFORM_FAULT — Sportsmart bug / pricing error / system failure
 *   - EXCEPTION — one-off ops adjustments
 *   - ROUNDING_ADJUSTMENT — settlement-cycle paise rounding
 *
 * No recovery is attempted. Surfaced in finance reporting as cost.
 *
 * Idempotent on (sourceType, sourceId).
 */
@Injectable()
export class PlatformExpenseService {
  private readonly logger = new Logger(PlatformExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    expenseType: PlatformExpenseType;
    amountInPaise: number;
    reason: string;
  }): Promise<PlatformExpense> {
    if (args.amountInPaise <= 0) {
      throw new Error(
        `PlatformExpense amount must be positive paise (got ${args.amountInPaise})`,
      );
    }
    try {
      const row = await this.prisma.platformExpense.create({
        data: {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          expenseType: args.expenseType,
          amountInPaise: BigInt(args.amountInPaise),
          reason: args.reason,
        },
      });
      this.logger.log(
        `PlatformExpense ${row.id} booked: source=${args.sourceType}:${args.sourceId} type=${args.expenseType} ₹${(args.amountInPaise / 100).toFixed(2)}`,
      );
      return row;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.platformExpense.findUnique({
          where: {
            sourceType_sourceId: {
              sourceType: args.sourceType,
              sourceId: args.sourceId,
            },
          },
        });
        if (existing) {
          this.logger.log(
            `PlatformExpense already exists for ${args.sourceType}:${args.sourceId} (idempotent reuse)`,
          );
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Phase 127 — reverse the expense for a source (e.g. a goodwill credit
   * whose refund finance rejected). A platform expense has no in-flight
   * lifecycle, so it's always reversible — a soft mark (reversedAt) keeps
   * the row for audit while excluding it from cost totals. Idempotent:
   *   - not reversed → reversedAt stamped ('reversed')
   *   - reversed     → no-op ('already_reversed') — replay-safe
   *   - no row       → 'none'
   */
  async reverseForSource(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
  }): Promise<'reversed' | 'already_reversed' | 'none'> {
    const row = await this.prisma.platformExpense.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
        },
      },
    });
    if (!row) return 'none';
    if (row.reversedAt) return 'already_reversed';
    await this.prisma.platformExpense.update({
      where: { id: row.id },
      data: { reversedAt: new Date(), reversalReason: args.reason },
    });
    this.logger.log(
      `PlatformExpense ${row.id} reversed for ${args.sourceType}:${args.sourceId}: ${args.reason}`,
    );
    return 'reversed';
  }

  /**
   * Admin-driven reversal by row id — un-books a mis-attributed absorbed
   * cost so it no longer stands in finance reporting (e.g. the cost actually
   * belonged to the seller/courier). Soft mark only; finance re-attributes
   * via a manual seller debit / re-filed claim. Idempotent-safe: a second
   * reverse is rejected rather than silently re-stamped.
   */
  async reverseById(id: string, reason: string): Promise<PlatformExpense> {
    const row = await this.prisma.platformExpense.findUnique({ where: { id } });
    if (!row) {
      throw new BadRequestAppException(`Platform expense ${id} not found`);
    }
    if (row.reversedAt) {
      throw new BadRequestAppException(
        'Platform expense is already reversed',
      );
    }
    const updated = await this.prisma.platformExpense.update({
      where: { id },
      data: { reversedAt: new Date(), reversalReason: reason },
    });
    this.logger.log(`PlatformExpense ${id} reversed by admin: ${reason}`);
    return updated;
  }
}
