import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface AdminUpdateFranchiseVerificationInput {
  adminId: string;
  franchiseId: string;
  verificationStatus: string;
  reason?: string;
}

@Injectable()
export class AdminUpdateFranchiseVerificationUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseVerificationUseCase');
  }

  async execute(input: AdminUpdateFranchiseVerificationInput) {
    const { franchiseId, verificationStatus, reason } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const previousStatus = franchise.verificationStatus;

    const updated = await this.franchiseRepo.updateFranchise(franchiseId, {
      verificationStatus,
    });

    this.eventBus
      .publish({
        eventName: 'franchise.verification_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: {
          franchiseId,
          previousVerificationStatus: previousStatus,
          newVerificationStatus: verificationStatus,
          reason: reason || null,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish franchise verification update event: ${err}`);
      });

    this.logger.log(
      `Franchise verification updated: ${franchiseId} from ${previousStatus} to ${verificationStatus}`,
    );

    return {
      franchiseId: updated.id,
      verificationStatus: updated.verificationStatus,
    };
  }
}
