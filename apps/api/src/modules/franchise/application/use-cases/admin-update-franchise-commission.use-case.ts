import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface AdminUpdateFranchiseCommissionInput {
  adminId: string;
  franchiseId: string;
  onlineFulfillmentRate?: number;
  procurementFeeRate?: number;
}

@Injectable()
export class AdminUpdateFranchiseCommissionUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseCommissionUseCase');
  }

  async execute(input: AdminUpdateFranchiseCommissionInput) {
    const { franchiseId, onlineFulfillmentRate, procurementFeeRate } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const updateData: Record<string, unknown> = {};

    if (onlineFulfillmentRate !== undefined) {
      updateData.onlineFulfillmentRate = onlineFulfillmentRate;
    }
    if (procurementFeeRate !== undefined) {
      updateData.procurementFeeRate = procurementFeeRate;
    }
    if (Object.keys(updateData).length === 0) {
      throw new AppException('No commission fields provided for update', 'BAD_REQUEST');
    }

    const updated = await this.franchiseRepo.updateFranchise(franchiseId, updateData);

    this.eventBus
      .publish({
        eventName: 'franchise.commission_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: {
          franchiseId,
          updatedFields: Object.keys(updateData),
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish franchise commission update event: ${err}`);
      });

    this.logger.log(`Franchise commission updated: ${franchiseId}`);

    return {
      franchiseId: updated.id,
      onlineFulfillmentRate: updated.onlineFulfillmentRate,
      procurementFeeRate: updated.procurementFeeRate,
    };
  }
}
