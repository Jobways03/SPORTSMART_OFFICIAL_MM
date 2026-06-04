import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../core/cron-observability/cron-instrumentation.service';

/**
 * Phase 202 (#17) — wishlist orphan-cleanup cron.
 *
 * Wishlist rows have ON DELETE CASCADE FKs to products / variants, so a
 * HARD-deleted product/variant already takes its wishlist rows with it —
 * there are no FK-orphan rows to chase. What CAN accumulate is rows that
 * point at a product the catalog SOFT-deleted (isDeleted=true) a long
 * time ago and is never coming back. Those rows render as "no longer
 * available" in the list (the #3/#12 gate), so they're harmless to the
 * customer, but they bloat the table indefinitely.
 *
 * This job prunes wishlist rows whose product has been soft-deleted for
 * longer than a retention window (default 180 days). It is intentionally
 * CONSERVATIVE:
 *   - only soft-deleted products (a suspended / un-moderated product can
 *     be re-published, so we never prune those — the customer's intent is
 *     still valid);
 *   - only after a long grace period, keyed off the product's deletedAt;
 *   - env-gated OFF by default so it cannot surprise-delete in any
 *     environment until ops deliberately enables it.
 *
 * Follows the modern cron pattern (@Cron + LeaderElectedCron +
 * CronInstrumentation), like cod-collection-pending.cron.ts. Env is read
 * from process.env directly (not EnvService) because these keys are
 * optional and not part of the typed Env schema.
 */
@Injectable()
export class WishlistOrphanCleanupCron {
  private readonly logger = new Logger(WishlistOrphanCleanupCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  private enabled(): boolean {
    // OFF by default — opt-in only. Any value other than 'true' (incl.
    // unset) keeps the job inert.
    return process.env.WISHLIST_ORPHAN_CLEANUP_ENABLED === 'true';
  }

  private retentionDays(): number {
    const raw = Number(process.env.WISHLIST_ORPHAN_RETENTION_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : 180;
  }

  private batchSize(): number {
    const raw = Number(process.env.WISHLIST_ORPHAN_CLEANUP_BATCH);
    return Number.isFinite(raw) && raw > 0 ? raw : 1000;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('wishlist-orphan-cleanup', 30 * 60, async () => {
      try {
        await this.instr.wrap('wishlist.orphan_cleanup', () => this.tick());
      } catch {
        // recorded as FAILED in cron_runs by the instrumentation wrapper
      }
    });
  }

  /**
   * Testable inner loop. Deletes wishlist rows whose product was
   * soft-deleted before the cutoff, in one bounded statement. Returns the
   * cutoff + deleted count for assertions / logging.
   */
  async tick(): Promise<{ retentionDays: number; deleted: number }> {
    const retentionDays = this.retentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const batch = this.batchSize();

    // Find a bounded batch of prunable rows (product soft-deleted before
    // the cutoff), then delete by id. Two-step (select-ids → deleteMany)
    // keeps each tick bounded so a large backlog drains over several runs
    // instead of one unbounded delete.
    const prunable = await this.prisma.wishlistItem.findMany({
      where: {
        product: {
          isDeleted: true,
          deletedAt: { not: null, lt: cutoff },
        },
      },
      select: { id: true },
      take: batch,
    });

    if (prunable.length === 0) {
      return { retentionDays, deleted: 0 };
    }

    const result = await this.prisma.wishlistItem.deleteMany({
      where: { id: { in: prunable.map((r) => r.id) } },
    });

    if (result.count > 0) {
      this.logger.log(
        `wishlist-orphan-cleanup: pruned ${result.count} row(s) whose product ` +
          `was soft-deleted before ${cutoff.toISOString()} (retention=${retentionDays}d)`,
      );
    }
    return { retentionDays, deleted: result.count };
  }
}
