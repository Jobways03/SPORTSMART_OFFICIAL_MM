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
    return this.commissionService.processCommissions();
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
}
