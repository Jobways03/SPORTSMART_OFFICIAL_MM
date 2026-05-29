import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CartService } from '../services/cart.service';

/**
 * Phase 61 (2026-05-22) — cart abandonment sweep (audit Gap #12).
 *
 * Pre-Phase-61 cart rows persisted indefinitely. With no
 * `expiresAt` column and no cleanup job, a customer who registered
 * once and abandoned a 3-item cart kept that cart row alive forever
 * — bloating the `carts` + `cart_items` tables and making
 * abandonment-recovery flows impossible.
 *
 * This cron runs daily at 03:00 UTC, leader-elected so a horizontally-
 * scaled API only sweeps once per cluster. It deletes Cart rows
 * whose `updatedAt` is older than the configured cutoff (default 90
 * days). The FK on `cart_items` is `ON DELETE CASCADE`, so child
 * rows go with the parent in the same DB statement.
 *
 * The cutoff is environment-configurable so staging / dev can run
 * with a tighter window for testing without code changes.
 */
@Injectable()
export class CartAbandonmentSweepCron {
  private readonly logger = new Logger(CartAbandonmentSweepCron.name);

  constructor(
    private readonly cartService: CartService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('CART_ABANDONMENT_SWEEP_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('cart-abandonment-sweep', 60 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Cart abandonment sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Testable inner loop. Reads the cutoff from env each call so a
   * dial-down doesn't require a process restart.
   */
  async runOnce(): Promise<{ cutoffDays: number; deleted: number }> {
    const cutoffDays = this.env.getNumber('CART_ABANDONMENT_CUTOFF_DAYS', 90);
    const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000);

    const deleted = await this.cartService.sweepAbandonedCarts(cutoff);
    if (deleted > 0) {
      this.logger.log(
        `Cart abandonment sweep — deleted ${deleted} cart(s) older than ${cutoffDays} days (cutoff=${cutoff.toISOString()})`,
      );
      this.eventBus
        .publish({
          eventName: 'cart.abandonment.swept',
          aggregate: 'Cart',
          aggregateId: 'batch',
          occurredAt: new Date(),
          payload: { deleted, cutoffDays, cutoff: cutoff.toISOString() },
        })
        .catch(() => {});
    }
    return { cutoffDays, deleted };
  }
}
