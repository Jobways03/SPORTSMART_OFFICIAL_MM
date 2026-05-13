import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../cron-observability/cron-instrumentation.service';

/**
 * Periodic cleanup for the idempotency_keys table.
 *
 *   - COMPLETED rows past expires_at: delete (TTL).
 *   - PENDING rows older than 60 seconds: delete (orphans from
 *     crashed handlers — the interceptor's normal release path
 *     handles graceful errors but a process kill can't run finally).
 *
 * Fast and lock-friendly: deletes in batches of 1000, runs every
 * `IDEMPOTENCY_SWEEP_INTERVAL_MINUTES` minutes (default 15). Skips
 * entirely when IDEMPOTENCY_ENABLED is false (no rows to clean up).
 */
@Injectable()
export class IdempotencySweeperCron {
  private static readonly PENDING_GRACE_MS = 60_000;
  private static readonly BATCH_SIZE = 1000;
  private readonly logger = new Logger(IdempotencySweeperCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    // Phase 1 (PR 1.2) — only one replica per cluster runs the sweep
    // per tick. Without this, N replicas all execute the same
    // deleteMany — harmless but wasteful, and made the sweep counter
    // log misleading.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.2) — cron-run observability. Records each sweep
    // in `cron_runs` with the `{ expired, orphans }` shape so ops
    // can chart deletion rates over time.
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    if (!this.env.getBoolean('IDEMPOTENCY_ENABLED', false)) return;

    // 10-minute tick × 2 = 20-minute lock TTL.
    await this.leader.run('idempotency-sweeper', 20 * 60, async () => {
      try {
        await this.instr.wrap('idempotency-sweeper', async () => {
          const now = new Date();
          const orphanCutoff = new Date(
            now.getTime() - IdempotencySweeperCron.PENDING_GRACE_MS,
          );

          // Expired completed rows.
          const expired = await this.prisma.idempotencyKey.deleteMany({
            where: {
              state: 'COMPLETED',
              expiresAt: { lt: now },
            },
          });

          // Orphan pending rows (handler crashed, finally never ran).
          const orphans = await this.prisma.idempotencyKey.deleteMany({
            where: {
              state: 'PENDING',
              createdAt: { lt: orphanCutoff },
            },
          });

          if (expired.count > 0 || orphans.count > 0) {
            this.logger.log(
              `swept idempotency keys: ${expired.count} expired, ${orphans.count} orphans`,
            );
          }
          return { expired: expired.count, orphans: orphans.count };
        });
      } catch (err) {
        this.logger.error(
          `idempotency sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }
}
