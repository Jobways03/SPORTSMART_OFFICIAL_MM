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
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

@Injectable()
export class ReleaseExpiredRedemptionsCron {
  private readonly logger = new Logger(ReleaseExpiredRedemptionsCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly reservation: DiscountReservationService,
    // Phase 1 (PR 1.2) — every-minute cron firing the same
    // releaseExpired() N times per tick wastes DB writes.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.3) — cron-run observability. releaseExpired is
    // void-returning today; the wrap captures `{ ran: true }` plus
    // the per-tick duration as the structured metric.
    private readonly instr: CronInstrumentationService,
    // Cluster E (#222) — one best-effort summary audit row per tick so
    // bulk releases leave a queryable forensic trail (who/when/how many).
    private readonly audit: AuditPublicFacade,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    // 2-minute lock (2× tick interval).
    await this.leader.run('release-expired-redemptions', 2 * 60, async () => {
      try {
        const released = await this.instr.wrap(
          'release-expired-redemptions',
          async () => {
            const count = await this.reservation.releaseExpired(
              new Date(),
              this.batchSize(),
            );
            return { ran: true, released: count };
          },
        );
        // Best-effort summary audit row, OUTSIDE the per-row work and
        // never able to abort the sweep. Only write when we actually
        // freed slots so idle ticks don't spam the audit log.
        const count = released?.released ?? 0;
        if (count > 0) {
          await this.audit
            .writeAuditLog({
              actorType: 'SYSTEM',
              action: 'discount.redemption.expired_swept',
              module: 'discounts',
              resource: 'discount_redemption',
              metadata: { releasedCount: count },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        // Never rethrow — keep the cron alive. instr.wrap already
        // recorded the failure; log here for stdout visibility.
        this.logger.error('Failed to release expired redemptions', err as Error);
      }
    });
  }

  private batchSize(): number {
    return this.env.getNumber('DISCOUNT_RELEASE_EXPIRED_BATCH_SIZE', 500);
  }

  private enabled(): boolean {
    return this.env.getBoolean('DISCOUNT_RESERVATION_CRON_ENABLED', true);
  }
}
