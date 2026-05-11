// Phase B (P0.3) — Active cleanup of expired RESERVED redemptions.
//
// Runs every minute. Lazy expiry (the reserve/redeem code rejects
// expired rows on access) is the primary correctness mechanism;
// this cron keeps the active-reservation count accurate so the
// admin UI's "remaining usage" panel stays close to real-time.
//
// Failure mode: if this cron is silent the system still works —
// expired rows just stay RESERVED until the next reserve attempt
// notices and the customer hits a "coupon reservation expired"
// message. So the cron is gated behind a feature flag and never
// throws — failures are logged and emit a metric / event.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { DiscountReservationService } from '../services/discount-reservation.service';

@Injectable()
export class ReleaseExpiredRedemptionsCron {
  private readonly logger = new Logger(ReleaseExpiredRedemptionsCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly reservation: DiscountReservationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.reservation.releaseExpired();
    } catch (err) {
      // Never rethrow — keep the cron alive. Log + let the next
      // tick try again.
      this.logger.error('Failed to release expired redemptions', err as Error);
    }
  }

  private enabled(): boolean {
    return this.env.getBoolean('DISCOUNT_RESERVATION_CRON_ENABLED', true);
  }
}
