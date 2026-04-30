import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * SRS §11.2 — automated commission confirmation cron.
 *
 * Once per minute, scan for PENDING commissions whose
 * returnWindowEndsAt has passed and flip them to CONFIRMED. After
 * this transition the commission is eligible for inclusion in a
 * payout request.
 *
 * HOLD commissions are NOT touched — SRS Global Rule "HOLD
 * overrides everything else, absolute priority". They stay paused
 * until the exchange resolves.
 *
 * Idempotent: a commission already CONFIRMED won't match the
 * `status: 'PENDING'` filter on the next run.
 */
@Injectable()
export class AffiliateReturnWindowService implements OnModuleInit {
  private readonly logger = new Logger(AffiliateReturnWindowService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // First sweep on next tick (so the API is fully up), then every
    // 60 seconds. Long enough that we don't hammer the DB; short
    // enough that the perceived delay between window-end and
    // CONFIRMED status is acceptable on a customer dashboard.
    setTimeout(() => this.sweep(), 5_000);
    setInterval(() => this.sweep(), 60_000);
  }

  async sweep(): Promise<{ confirmed: number }> {
    try {
      // updateMany with a status filter is the cleanest way to do
      // this in one DB roundtrip — avoids reading rows we'll just
      // immediately update. We then count via the affected rows
      // returned by Prisma.
      const result = await this.prisma.affiliateCommission.updateMany({
        where: {
          status: 'PENDING',
          returnWindowEndsAt: { not: null, lte: new Date() },
        },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
      if (result.count > 0) {
        this.logger.log(
          `Return-window cron: confirmed ${result.count} affiliate commission(s)`,
        );
      }
      return { confirmed: result.count };
    } catch (err) {
      this.logger.error(
        `Return-window cron failed: ${(err as Error)?.message ?? err}`,
      );
      return { confirmed: 0 };
    }
  }
}
