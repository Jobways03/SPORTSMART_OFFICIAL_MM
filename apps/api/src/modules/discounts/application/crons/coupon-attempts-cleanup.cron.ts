import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 4.8 (2026-05-16) — `coupon_attempts` cleanup.
 *
 * Background: every coupon validation (success or failure) writes a
 * row to `coupon_attempts`. DiscountFraudService scans this table on
 * each new attempt to enforce the windowed rate-limit (default: max
 * 10 INVALID attempts in 15 minutes per customer). The table grows
 * unbounded otherwise — six months in, the count-in-window query
 * scans millions of rows that are no longer load-bearing.
 *
 * This cron purges rows older than the cleanup horizon (default
 * 30 days), well beyond the longest rate-limit window. The rows it
 * keeps still satisfy every active fraud-detection query.
 *
 * Schedule: daily at 03:15 — well after the IST-midnight tax-related
 * jobs but before the 04:00 double-entry validator. Leader-elected
 * so multi-replica deployments don't double-write.
 */
@Injectable()
export class CouponAttemptsCleanupCron {
  private readonly logger = new Logger(CouponAttemptsCleanupCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('COUPON_ATTEMPTS_CLEANUP_ENABLED', true);
  }

  @Cron('15 3 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('coupon-attempts-cleanup', 30 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Coupon attempts cleanup failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async runOnce(): Promise<{ deleted: number }> {
    const days = this.env.getNumber('COUPON_ATTEMPTS_RETENTION_DAYS', 30);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // deleteMany is the cleanest path here. Old rows have no foreign
    // keys pointing at them; the only downstream consumer is the
    // windowed-fraud-check query which would never look past the
    // cutoff anyway.
    const result = await this.prisma.couponAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(
      `Coupon attempts cleanup: deleted ${result.count} row(s) older than ${days} days (cutoff=${cutoff.toISOString()})`,
    );
    return { deleted: result.count };
  }
}
