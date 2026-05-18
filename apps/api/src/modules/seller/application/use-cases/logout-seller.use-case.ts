import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

/**
 * Seller logout — server-side session revocation.
 *
 * Revokes every active session for the seller (matches the admin
 * logout pattern). The frontend separately clears its local
 * sessionStorage / cookie; if a stolen refresh token is replayed
 * after the user clicks logout, this revoke ensures it's rejected.
 *
 * Idempotent: calling logout twice in quick succession just revokes
 * the (already-revoked) sessions a second time — no-op effect.
 */
@Injectable()
export class LogoutSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LogoutSellerUseCase');
  }

  async execute(sellerId: string): Promise<void> {
    await this.sellerRepo.revokeAllSessions(sellerId);

    this.eventBus
      .publish({
        eventName: 'seller.logged_out',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: { sellerId },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish seller.logged_out event: ${err}`);
      });

    this.logger.log(`Seller logged out: ${sellerId}`);
  }
}
