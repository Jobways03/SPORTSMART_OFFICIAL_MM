import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { ErasureService } from './erasure.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../cron-observability/cron-instrumentation.service';

/**
 * Phase 7 (PR 7.4) — Periodic erasure processor.
 *
 * Hourly cadence picks up DataErasureRequest rows whose `notBefore`
 * has elapsed and `status = PENDING`. Each is processed through
 * ErasureService.processOne. Failures are logged and the request
 * returns to PENDING so the next tick retries.
 *
 * Hard cap on per-tick batch (50) so a backlog doesn't tank Postgres.
 * Backlogs catch up over multiple ticks; the regulator window for
 * GDPR is 30 days, well above our cron's max throughput.
 */
@Injectable()
export class ErasureProcessorCron {
  private readonly logger = new Logger(ErasureProcessorCron.name);
  private static readonly BATCH_LIMIT = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly erasure: ErasureService,
    // Phase 1 (PR 1.2) — single replica per cluster runs the batch.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.3) — cron-run observability. Captures
    // `{ pending, succeeded, failed }` per tick.
    private readonly instr: CronInstrumentationService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('ERASURE_PROCESSOR_ENABLED', false);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    await this.leader.run('erasure-processor', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('erasure-processor', async () => {
          let pending: Array<{ id: string }> = [];
          try {
            pending = await this.prisma.dataErasureRequest.findMany({
              where: {
                status: 'PENDING',
                notBefore: { lte: new Date() },
              },
              select: { id: true },
              take: ErasureProcessorCron.BATCH_LIMIT,
              orderBy: { createdAt: 'asc' },
            });
          } catch (err) {
            this.logger.error(
              `Failed to load pending erasure requests: ${(err as Error).message}`,
            );
            return { pending: 0, succeeded: 0, failed: 0 };
          }

          if (pending.length === 0) {
            return { pending: 0, succeeded: 0, failed: 0 };
          }

          let succeeded = 0;
          let failed = 0;
          for (const r of pending) {
            try {
              await this.erasure.processOne(r.id);
              succeeded++;
            } catch (err) {
              failed++;
              this.logger.warn(
                `Erasure ${r.id} threw outside processOne: ${(err as Error).message}`,
              );
            }
          }
          this.logger.log(
            `erasure processor: ${succeeded}/${pending.length} processed, ${failed} threw`,
          );
          return { pending: pending.length, succeeded, failed };
        });
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }
}
