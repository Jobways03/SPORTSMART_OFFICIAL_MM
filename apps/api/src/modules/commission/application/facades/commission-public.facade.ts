import { Injectable } from '@nestjs/common';
import { CommissionProcessorService } from '../services/commission-processor.service';

/**
 * Public facade for the Commission module.
 * This is the ONLY export other modules should depend on.
 */
@Injectable()
export class CommissionPublicFacade {
  constructor(private readonly commissionService: CommissionProcessorService) {}

  /** Trigger commission processing on demand (e.g. from a cron or event). */
  async processCommissions(): Promise<void> {
    // Cluster-B — the service now returns per-tick counts (consumed by the
    // cron's instrumentation); this on-demand façade keeps its void contract,
    // so await + discard rather than return the summary.
    await this.commissionService.processCommissions();
  }

  /**
   * Lock commission for one sub-order right now, skipping the cron's
   * deliveredAt-window gate. Used by the returns module when a return
   * settles in a terminal-rejected state — the seller is entitled to
   * commission immediately, no need to wait out the rest of the window.
   *
   * Idempotent and safe to call from anywhere; no-ops cleanly when the
   * sub-order isn't eligible (already processed, has a non-terminal
   * return, or isn't a seller sub-order).
   */
  async lockCommissionForSubOrderImmediately(
    subOrderId: string,
    reason: string,
  ): Promise<void> {
    return this.commissionService.lockCommissionForSubOrderImmediately(
      subOrderId,
      reason,
    );
  }

  /** Retrieve commission records for a specific order (by filter). */
  async getCommissionForOrder(orderId: string) {
    return this.commissionService.getCommissionRecords(
      { search: orderId },
      1,
      50,
    );
  }

  /**
   * Phase 69 (2026-05-22) — Phase 67 audit Gap #7. Resolve the
   * commission rate that should be snapshotted onto a sub-order at
   * place-order time. The Seller model doesn't currently carry a
   * per-seller commission percentage (only the franchise side does
   * via FranchisePublicFacade.getCommissionRate), so this returns
   * the platform-wide CommissionSetting.commissionValue. When a
   * per-seller commission column lands later, this is the single
   * place to update — checkout doesn't change.
   *
   * Returns null only if the global settings row is missing (boot
   * race) — the checkout caller treats null as "leave the snapshot
   * unset; settlement will fall back to live settings at that
   * time" which matches the legacy pre-Phase-69 behaviour.
   */
  async getCommissionRateForSeller(_sellerId: string): Promise<number | null> {
    const settings = await this.commissionService.getCommissionSettings();
    if (!settings) return null;
    const rate = Number(settings.commissionValue);
    if (!Number.isFinite(rate) || rate < 0) return null;
    return rate;
  }
}
