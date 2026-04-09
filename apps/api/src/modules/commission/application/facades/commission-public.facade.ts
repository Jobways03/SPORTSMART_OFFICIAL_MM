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

  /** Retrieve commission records for a specific order (by filter). */
  async getCommissionForOrder(orderId: string) {
    return this.commissionService.getCommissionRecords(
      { search: orderId },
      1,
      50,
    );
  }
}
