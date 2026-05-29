import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface LogoutSellerInput {
  sellerId: string;
  sessionId?: string;
  all?: boolean;
}

/**
 * Seller logout — server-side session revocation.
 *
 * Phase 21 (2026-05-20) — split into two modes:
 *
 *   • default: revoke the SINGLE session identified by `sessionId`
 *     (taken from the SellerAuthGuard's request decoration). This
 *     mirrors the customer logout fix and means a seller signed in on
 *     desktop + phone can log out of one without nuking the other.
 *
 *   • `all=true`: revoke every active session for the seller (the old
 *     behaviour). Used by the "Log out of all devices" action and by
 *     security-incident response paths.
 *
 * Idempotent in both modes: re-calling on an already-revoked row is
 * a no-op.
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

  async execute(input: LogoutSellerInput): Promise<{ revokedAll: boolean }> {
    const { sellerId, sessionId, all } = input;
    const revokeAll = all === true || !sessionId;

    if (revokeAll) {
      await this.sellerRepo.revokeAllSessions(sellerId);
    } else {
      await this.sellerRepo.revokeSession(sessionId!);
    }

    this.eventBus
      .publish({
        eventName: 'seller.logged_out',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: { sellerId, revokedAll: revokeAll, sessionId: sessionId ?? null },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish seller.logged_out event: ${err}`);
      });

    this.logger.log(
      `Seller logged out: ${sellerId} (${revokeAll ? 'all sessions' : `session ${sessionId}`})`,
    );

    return { revokedAll: revokeAll };
  }
}
