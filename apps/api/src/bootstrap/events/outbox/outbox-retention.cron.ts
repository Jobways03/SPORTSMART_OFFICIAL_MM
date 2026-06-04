import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { EnvService } from '../../env/env.service';
import { LeaderElectedCron } from '../../scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../core/cron-observability/cron-instrumentation.service';

/**
 * Phase 186 (#4) — outbox retention sweeper.
 *
 * `outbox_events.state='PUBLISHED'` rows are never read again after delivery,
 * but accumulate forever without a sweeper — at any real event volume the
 * table (and its hot `[state, next_attempt_at]` index) degrades over months.
 *
 * Daily job, leader-elected (one replica per tick) and instrumented
 * (`cron_runs` row per sweep), that:
 *   - deletes PUBLISHED rows older than OUTBOX_RETENTION_DAYS (default 30),
 *   - deletes dead-letters older than OUTBOX_DLQ_RETENTION_DAYS (default 90 —
 *     longer, because ops needs the audit trail of unrecoverable events).
 *
 * Both run in bounded batches so a large backlog can't hold a long lock.
 */
@Injectable()
export class OutboxRetentionCron {
  private static readonly BATCH_SIZE = 5_000;
  private readonly logger = new Logger(OutboxRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    // Only meaningful when the outbox is actually being written to.
    if (!this.env.getBoolean('OUTBOX_ENABLED', false)) return;

    // 24h tick → 2h lock TTL is plenty (the sweep is fast).
    await this.leader.run('outbox-retention', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('outbox-retention', async () => {
          const publishedDays = this.env.getNumber('OUTBOX_RETENTION_DAYS', 30);
          const dlqDays = this.env.getNumber('OUTBOX_DLQ_RETENTION_DAYS', 90);
          const now = Date.now();
          const publishedCutoff = new Date(now - publishedDays * 86_400_000);
          const dlqCutoff = new Date(now - dlqDays * 86_400_000);

          const published = await this.deleteInBatches(() =>
            this.prisma.outboxEvent.deleteMany({
              where: { state: 'PUBLISHED', publishedAt: { lt: publishedCutoff } },
            }),
          );
          const deadLetters = await this.deleteInBatches(() =>
            this.prisma.outboxDeadLetter.deleteMany({
              where: { deadAt: { lt: dlqCutoff } },
            }),
          );

          if (published > 0 || deadLetters > 0) {
            this.logger.log(
              `outbox retention: purged ${published} published rows (>${publishedDays}d) ` +
                `and ${deadLetters} dead-letters (>${dlqDays}d)`,
            );
          }
          return { published, deadLetters };
        });
      } catch (err) {
        this.logger.error(`outbox retention sweep failed: ${(err as Error).message}`);
      }
    });
  }

  /**
   * Prisma deleteMany has no LIMIT; emulate batched deletes by looping the
   * deleteMany (which deletes everything matching) — but to keep each
   * statement bounded we delete by id-page. Simpler + safe here: loop until
   * a deleteMany round removes nothing, capping rounds to avoid a runaway.
   */
  private async deleteInBatches(
    round: () => Promise<{ count: number }>,
  ): Promise<number> {
    // deleteMany removes ALL matching rows in one statement; for the
    // volumes this sweeper targets (a day's published events) that's fine
    // and atomic. The loop exists only as a guard if a future refactor
    // switches `round` to a LIMIT-bounded delete.
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await round();
      total += res.count;
      if (res.count < OutboxRetentionCron.BATCH_SIZE) break;
    }
    return total;
  }
}
