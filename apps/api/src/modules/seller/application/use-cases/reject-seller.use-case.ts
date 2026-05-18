import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface RejectSellerInput {
  sellerId: string;
  adminId: string;
  reason: string;
}

@Injectable()
export class RejectSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RejectSellerUseCase');
  }

  async execute(input: RejectSellerInput): Promise<{
    sellerId: string;
    verificationStatus: string;
  }> {
    const { sellerId, adminId, reason } = input;

    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      status: true,
      verificationStatus: true,
      isDeleted: true,
    });

    if (!seller || (seller as any).isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (seller.verificationStatus !== 'UNDER_REVIEW') {
      throw new BadRequestAppException(
        `Seller is not under review. Current verification status: ${seller.verificationStatus}. Rejection is only valid when status is UNDER_REVIEW.`,
      );
    }

    const now = new Date();
    const updated = await this.sellerRepo.updateSellerSelect(
      sellerId,
      {
        verificationStatus: 'REJECTED',
        // Re-using gstVerificationNotes to carry the rejection reason —
        // semantically "verification notes" regardless of outcome, and
        // avoids a schema change for a single column.
        gstVerificationNotes: reason,
        gstVerifiedAt: null,
        gstVerifiedBy: null,
      },
      { id: true, verificationStatus: true },
    );

    this.eventBus
      .publish({
        eventName: 'seller.rejected',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: now,
        payload: { sellerId, adminId, reason },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish seller.rejected event: ${err}`);
      });

    this.logger.log(`Seller rejected by admin ${adminId}: ${sellerId} — reason: ${reason}`);

    return {
      sellerId: updated.id,
      verificationStatus: updated.verificationStatus,
    };
  }
}
