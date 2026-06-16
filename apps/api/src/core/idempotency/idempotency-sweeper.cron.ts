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
 * Runs every minute so a crashed-handler PENDING orphan becomes
 * reclaimable within ~60-120s of its 60s grace window (the interceptor
 * 409s retries against a live PENDING row until then). A 10-minute cadence
 * left orphaned keys un-retryable for up to 10 minutes. Leader-elected so
 * only one replica sweeps per tick; skipped entirely when
 * IDEMPOTENCY_ENABLED is false.
 */
@Injectable()
export class IdempotencySweeperCron {
  private static readonly PENDING_GRACE_MS = 60_000;
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

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    if (!this.env.getBoolean('IDEMPOTENCY_ENABLED', false)) return;

    // 50s lock TTL — under the 1-minute cadence, so a sweep whose holder
    // dies mid-run releases the lock before the next tick (a fast batched
    // deleteMany completes well within this).
    await this.leader.run('idempotency-sweeper', 50, async () => {
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
