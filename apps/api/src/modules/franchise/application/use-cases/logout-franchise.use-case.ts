import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

/**
 * Franchise logout — server-side session revocation. Mirrors the
 * seller/customer/admin pattern: revoke every active session for the
 * franchise so a stolen refresh token can't be replayed after logout.
 */
@Injectable()
export class LogoutFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LogoutFranchiseUseCase');
  }

  async execute(franchiseId: string): Promise<void> {
    await this.franchiseRepo.revokeAllSessions(franchiseId);

    this.eventBus
      .publish({
        eventName: 'franchise.logged_out',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: { franchiseId },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish franchise.logged_out event: ${err}`);
      });

    this.logger.log(`Franchise logged out: ${franchiseId}`);
  }
}
