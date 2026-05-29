import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LowStockAlertService } from '../services/low-stock-alert.service';
import { INVENTORY_EVENTS } from '../../domain/events/inventory.events';

/**
 * Phase 54 (2026-05-21) — event-driven low-stock detection (audit
 * Gap #12). Pre-Phase-54 alerts only existed on the cron tick
 * (every 30 min, now 15). A fast-moving SKU that sold its way down
 * to 1 unit would wait up to a full cron tick before the alert
 * landed in admin. This handler runs on every stock-change event
 * and immediately recomputes the alert state for the affected
 * mapping; cron remains as the backstop for any event the handler
 * missed.
 *
 * Idempotent: triggerForMapping handles all create/refresh/resolve
 * branches, including dismiss-snooze suppression.
 */
@Injectable()
export class LowStockAlertEventHandler {
  private readonly logger = new Logger(LowStockAlertEventHandler.name);

  constructor(private readonly alerts: LowStockAlertService) {}

  @OnEvent(INVENTORY_EVENTS.STOCK_DEDUCTED)
  async onStockDeducted(payload: { mappingId?: string }): Promise<void> {
    return this.maybeTrigger(payload);
  }

  @OnEvent(INVENTORY_EVENTS.STOCK_RESERVED)
  async onStockReserved(payload: { mappingId?: string }): Promise<void> {
    return this.maybeTrigger(payload);
  }

  @OnEvent(INVENTORY_EVENTS.STOCK_RELEASED)
  async onStockReleased(payload: { mappingId?: string }): Promise<void> {
    return this.maybeTrigger(payload);
  }

  @OnEvent(INVENTORY_EVENTS.STOCK_ADJUSTED)
  async onStockAdjusted(payload: { mappingId?: string }): Promise<void> {
    return this.maybeTrigger(payload);
  }

  /**
   * Phase 55 polish (2026-05-22) — franchise-side trigger. Procurement
   * receipt + future franchise adjust paths emit
   * `inventory.franchise_stock.changed` carrying
   * (franchiseId, productId, variantId). We call
   * triggerForFranchiseStock so the franchise's low-stock alert
   * recomputes immediately. Pre-Phase-55-polish the event was
   * emitted but had no subscriber.
   */
  @OnEvent('inventory.franchise_stock.changed')
  async onFranchiseStockChanged(payload: {
    franchiseId?: string;
    productId?: string;
    variantId?: string | null;
  }): Promise<void> {
    if (!payload?.franchiseId || !payload?.productId) return;
    try {
      await this.alerts.triggerForFranchiseStock(
        payload.franchiseId,
        payload.productId,
        payload.variantId ?? null,
      );
    } catch (err) {
      this.logger.warn(
        `triggerForFranchiseStock failed for ${payload.franchiseId}/${payload.productId}: ${(err as Error).message}`,
      );
    }
  }

  private async maybeTrigger(payload: { mappingId?: string }): Promise<void> {
    if (!payload?.mappingId) return;
    try {
      await this.alerts.triggerForMapping(payload.mappingId);
    } catch (err) {
      // Best-effort: an alert handler failure must NOT propagate to
      // the original stock-change transaction (the source of truth
      // is the mapping, not the alert).
      this.logger.warn(
        `triggerForMapping failed for ${payload.mappingId}: ${(err as Error).message}`,
      );
    }
  }
}
