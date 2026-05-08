import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LedgerSourceType,
  PlatformExpense,
  PlatformExpenseType,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

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
}
