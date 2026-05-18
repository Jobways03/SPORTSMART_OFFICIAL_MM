import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

/**
 * Phase 3 (PR 3.5) — Wallet ledger reconciliation cron.
 *
 * For every wallet, asserts:
 *
 *   sum(WalletTransaction.amountInPaise WHERE status='COMPLETED') === Wallet.balanceInPaise
 *
 * The two are written transactionally by `applyMutation` so they
 * SHOULD always agree. Drift means:
 *   - somebody bypassed the service (raw SQL? rogue migration? bug?),
 *   - a manual finance operation forgot to write a ledger row, or
 *   - real corruption (rare; flag as SEV-1).
 *
 * On drift, fires `wallet.ledger.drift_detected` so the notifications
 * handler (Phase 8) can page finance. Until Phase 8 the event lands
 * in the legacy in-process bus + log line.
 *
 * Runs daily at 03:00 in the API's local TZ (Indian Standard Time
 * for Sportsmart) to catch overnight drift after settlements close.
 * Off by default — flip `WALLET_LEDGER_RECON_ENABLED=true` after
 * staging soak.
 */
@Injectable()
export class WalletLedgerReconCron
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WalletLedgerReconCron.name);
  private static readonly LOCK_KEY = 'lock:wallet-ledger-recon';
  private static readonly LOCK_TTL_SECONDS = 600; // 10 minutes
  // Process wallets in batches so a multi-million-row population
  // doesn't lock the API for hours.
  private static readonly BATCH_SIZE = 500;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly events: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.log('Wallet-ledger recon disabled');
      return;
    }
    const intervalMinutes = this.env.getNumber(
      'WALLET_LEDGER_RECON_INTERVAL_MINUTES',
      24 * 60,
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `wallet-ledger recon tick crashed: ${(err as Error).message}`,
        ),
      );
    }, intervalMinutes * 60_000);
    this.logger.log(
      `Wallet-ledger recon cron started (every ${intervalMinutes} minutes)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Single reconciliation pass. Public so an admin "run now" endpoint
   * + a CI synthetic test can both invoke directly.
   */
  async tick(): Promise<{ reconciled: number; drifted: number }> {
    if (!this.enabled())
      return { reconciled: 0, drifted: 0 };

    const got = await this.redis.acquireLock(
      WalletLedgerReconCron.LOCK_KEY,
      WalletLedgerReconCron.LOCK_TTL_SECONDS,
    );
    if (!got) {
      this.logger.log('wallet-ledger recon: lock unavailable, skipping');
      return { reconciled: 0, drifted: 0 };
    }

    let totalReconciled = 0;
    let totalDrifted = 0;
    let cursor: string | null = null;
    try {
      // Cursor-paginated scan — order by id so the cursor is stable.
      // Reconcile each batch, skip walk to next batch.
      // Phase 2 (PR 2.2) — wallet money columns are BIGINT, so Prisma
      // surfaces them as `bigint`. The recon cron is a direct Prisma
      // caller (no repo boundary), so the arithmetic and the drift
      // event payload work in bigint locally. `.toString()` on the
      // event payload because JSON doesn't serialise bigint.
      type WalletRow = { id: string; userId: string; balanceInPaise: bigint };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const wallets: WalletRow[] = await this.prisma.wallet.findMany({
          where: cursor ? { id: { gt: cursor } } : undefined,
          orderBy: { id: 'asc' },
          take: WalletLedgerReconCron.BATCH_SIZE,
          select: { id: true, userId: true, balanceInPaise: true },
        });
        if (wallets.length === 0) break;

        for (const w of wallets) {
          const sumRow = await this.prisma.walletTransaction.aggregate({
            where: { walletId: w.id, status: 'COMPLETED' },
            _sum: { amountInPaise: true },
          });
          const ledgerSum: bigint = sumRow._sum.amountInPaise ?? 0n;
          totalReconciled += 1;
          if (ledgerSum !== w.balanceInPaise) {
            totalDrifted += 1;
            const driftPaise = w.balanceInPaise - ledgerSum;
            this.logger.error(
              `wallet ledger drift: wallet=${w.id} user=${w.userId} balance=${w.balanceInPaise} ledger_sum=${ledgerSum} drift=${driftPaise}`,
            );
            // Best-effort event publish. Phase 8 notification handler
            // hooks this and pages finance ops.
            this.events
              .publish({
                eventName: 'wallet.ledger.drift_detected',
                aggregate: 'Wallet',
                aggregateId: w.id,
                occurredAt: new Date(),
                payload: {
                  walletId: w.id,
                  userId: w.userId,
                  // Phase 2 (PR 2.2) — narrow bigint → number for the
                  // event payload (JSON can't carry bigint natively).
                  // Drift values stay well inside JS's safe-integer
                  // range; the column widening is about storage, not
                  // about per-event payload magnitude.
                  balanceInPaise: Number(w.balanceInPaise),
                  ledgerSumInPaise: Number(ledgerSum),
                  driftInPaise: Number(driftPaise),
                },
              })
              .catch(() => undefined);
          }
        }

        cursor = wallets[wallets.length - 1]!.id;
        if (wallets.length < WalletLedgerReconCron.BATCH_SIZE) break;
      }
    } finally {
      await this.redis.releaseLock(WalletLedgerReconCron.LOCK_KEY);
    }

    this.logger.log(
      `wallet-ledger recon complete: reconciled=${totalReconciled} drifted=${totalDrifted}`,
    );
    return { reconciled: totalReconciled, drifted: totalDrifted };
  }

  private enabled(): boolean {
    return this.env.getBoolean('WALLET_LEDGER_RECON_ENABLED', false);
  }
}
