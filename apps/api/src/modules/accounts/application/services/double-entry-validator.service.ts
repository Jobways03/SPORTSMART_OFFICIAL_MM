import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 3.8 (2026-05-16) — Double-entry validation invariant.
 *
 * Every money movement on the platform must net to zero across the
 * day's commits — money that left one ledger should land in another
 * ledger by the same amount. This service runs a daily reconciliation
 * pass that asserts the books balance and emits `accounts.imbalance_detected`
 * for any period where they don't.
 *
 * The five ledgers we sum:
 *   1. Wallet (sum of WalletTransaction.amountInPaise for the period)
 *   2. Settlement payouts (sum of Payout.amountInPaise where status=COMPLETED)
 *   3. Refund instructions (sum of RefundInstruction.amountInPaise where status=SUCCESS)
 *   4. Commission accrued (sum of CommissionRecord.platformMarginInPaise)
 *   5. Tax collected (sum of TaxDocument.totalTaxAmountInPaise)
 *
 * The invariant we check:
 *   - Money in = money out + change in obligations (commission owed,
 *     refunds pending, tax payable)
 *
 * This is NOT a journal-entry system — it's a daily sanity check that
 * the aggregate flows reconcile. The day a real Chart of Accounts gets
 * built, this service becomes the migration's reference implementation
 * for "what the invariants should look like".
 *
 * Enabled by env `DOUBLE_ENTRY_VALIDATOR_ENABLED` (default true).
 * Read-only; no money side effects. Emits an event for ops alerting.
 */
@Injectable()
export class DoubleEntryValidatorService {
  private readonly logger = new Logger(DoubleEntryValidatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('DOUBLE_ENTRY_VALIDATOR_ENABLED', true);
  }

  // Daily at 04:00 — after settlements (~3am) finish their close.
  @Cron('0 4 * * *')
  async runDailyCheck(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('double-entry-validator', 60 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Daily double-entry check failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Sum the five ledgers for the previous calendar day in IST and
   * report imbalances. Tolerance: ±1 paise total (rounding drift).
   *
   * Exposed publicly so an admin can re-run a specific day on demand
   * from the accounts dashboard.
   */
  async runOnce(dateOverride?: Date): Promise<DoubleEntryCheckResult> {
    // Default to "yesterday in IST" so the window is closed by the
    // time the cron fires at 04:00 IST. IST = UTC+5:30; we treat the
    // window as [00:00 IST, 24:00 IST] = [-5h30m UTC, +18h30m UTC] of
    // the IST date.
    const target = dateOverride ?? istYesterday();
    const { startUtc, endUtc, istDateLabel } = istDayBoundsToUtc(target);

    const [
      walletNet,
      payoutNet,
      refundNet,
      commissionNet,
      taxNet,
    ] = await Promise.all([
      this.sumWalletNet(startUtc, endUtc),
      this.sumPayoutNet(startUtc, endUtc),
      this.sumRefundNet(startUtc, endUtc),
      this.sumCommissionNet(startUtc, endUtc),
      this.sumTaxNet(startUtc, endUtc),
    ]);

    // Inflows (positive on our books) — wallet credits + commission
    // recognised + tax collected.
    // Outflows (negative on our books) — payouts disbursed + refunds
    // executed.
    //
    // For a clean day, `commission + tax = payouts + refunds + (net
    // wallet movement)` within ±1 paise. We compute the imbalance
    // directly so the event payload carries the actionable numbers.
    const imbalanceInPaise =
      commissionNet + taxNet - payoutNet - refundNet - walletNet;

    const tolerated = 1n;
    const breached =
      imbalanceInPaise > tolerated || imbalanceInPaise < -tolerated;

    const result: DoubleEntryCheckResult = {
      istDate: istDateLabel,
      windowStartUtc: startUtc.toISOString(),
      windowEndUtc: endUtc.toISOString(),
      walletNetInPaise: walletNet.toString(),
      payoutNetInPaise: payoutNet.toString(),
      refundNetInPaise: refundNet.toString(),
      commissionNetInPaise: commissionNet.toString(),
      taxNetInPaise: taxNet.toString(),
      imbalanceInPaise: imbalanceInPaise.toString(),
      breached,
    };

    if (breached) {
      this.logger.warn(
        `Double-entry check FAILED for ${istDateLabel}: imbalance=${imbalanceInPaise.toString()}p`,
      );
      try {
        await this.eventBus.publish({
          eventName: 'accounts.imbalance_detected',
          aggregate: 'DoubleEntryCheck',
          aggregateId: istDateLabel,
          occurredAt: new Date(),
          payload: result,
        });
      } catch (err) {
        this.logger.error(
          `Failed to publish accounts.imbalance_detected: ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.log(
        `Double-entry check PASSED for ${istDateLabel}: imbalance=${imbalanceInPaise.toString()}p (within tolerance)`,
      );
    }

    return result;
  }

  private async sumWalletNet(start: Date, end: Date): Promise<bigint> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: start, lt: end },
      },
      select: { amountInPaise: true },
    });
    return rows.reduce((sum, r) => sum + bigintFromMaybe(r.amountInPaise), 0n);
  }

  private async sumPayoutNet(start: Date, end: Date): Promise<bigint> {
    const rows = await this.prisma.payout.findMany({
      where: {
        status: 'COMPLETED',
        paidAt: { gte: start, lt: end },
      },
      select: { amountInPaise: true },
    });
    return rows.reduce((sum, r) => sum + bigintFromMaybe(r.amountInPaise), 0n);
  }

  private async sumRefundNet(start: Date, end: Date): Promise<bigint> {
    const rows = await this.prisma.refundInstruction.findMany({
      where: {
        status: 'SUCCESS',
        updatedAt: { gte: start, lt: end },
      },
      select: { amountInPaise: true },
    });
    return rows.reduce((sum, r) => sum + bigintFromMaybe(r.amountInPaise), 0n);
  }

  private async sumCommissionNet(start: Date, end: Date): Promise<bigint> {
    const rows = await this.prisma.commissionRecord.findMany({
      where: {
        status: { in: ['SETTLED', 'PENDING'] },
        createdAt: { gte: start, lt: end },
      },
      select: { platformMarginInPaise: true },
    });
    return rows.reduce(
      (sum, r) => sum + bigintFromMaybe(r.platformMarginInPaise),
      0n,
    );
  }

  private async sumTaxNet(start: Date, end: Date): Promise<bigint> {
    const rows = await this.prisma.taxDocument.findMany({
      where: {
        status: { in: ['GENERATED', 'PDF_GENERATED', 'PDF_PENDING'] },
        generatedAt: { gte: start, lt: end },
      },
      select: { totalTaxAmountInPaise: true },
    });
    return rows.reduce(
      (sum, r) => sum + bigintFromMaybe(r.totalTaxAmountInPaise),
      0n,
    );
  }
}

export interface DoubleEntryCheckResult {
  istDate: string;
  windowStartUtc: string;
  windowEndUtc: string;
  walletNetInPaise: string;
  payoutNetInPaise: string;
  refundNetInPaise: string;
  commissionNetInPaise: string;
  taxNetInPaise: string;
  imbalanceInPaise: string;
  breached: boolean;
}

function bigintFromMaybe(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') {
    const m = v.match(/^-?\d+/);
    return m ? BigInt(m[0]) : 0n;
  }
  // Decimal-like — use its toString for fidelity.
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    const s = (v as { toString: () => string }).toString();
    const m = s.match(/^-?\d+/);
    return m ? BigInt(m[0]) : 0n;
  }
  return 0n;
}

function istYesterday(): Date {
  const now = new Date();
  // IST = UTC+5:30. To get "today in IST", shift UTC by +5:30 then
  // floor to the day.
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const istYday = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - 1),
  );
  return istYday;
}

function istDayBoundsToUtc(istDate: Date): {
  startUtc: Date;
  endUtc: Date;
  istDateLabel: string;
} {
  // istDate is interpreted as "00:00 IST on the given Y/M/D".
  // 00:00 IST = 18:30 UTC of the PREVIOUS day.
  const y = istDate.getUTCFullYear();
  const m = istDate.getUTCMonth();
  const d = istDate.getUTCDate();
  const istMidnightUtcMs = Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000;
  const startUtc = new Date(istMidnightUtcMs);
  const endUtc = new Date(istMidnightUtcMs + 24 * 60 * 60 * 1000);
  const istDateLabel = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { startUtc, endUtc, istDateLabel };
}
