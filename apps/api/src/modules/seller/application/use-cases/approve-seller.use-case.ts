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

interface ApproveSellerInput {
  sellerId: string;
  adminId: string;
  notes?: string;
}

@Injectable()
export class ApproveSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ApproveSellerUseCase');
  }

  async execute(input: ApproveSellerInput): Promise<{
    sellerId: string;
    status: string;
    verificationStatus: string;
  }> {
    const { sellerId, adminId, notes } = input;

    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      status: true,
      verificationStatus: true,
      isDeleted: true,
      gstin: true,
      panNumber: true,
    });

    if (!seller || (seller as any).isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (seller.verificationStatus !== 'UNDER_REVIEW') {
      throw new BadRequestAppException(
        `Seller is not under review. Current verification status: ${seller.verificationStatus}. Approval is only valid when status is UNDER_REVIEW.`,
      );
    }

    if (seller.status !== 'PENDING_APPROVAL') {
      throw new BadRequestAppException(
        `Seller is not pending approval. Current status: ${seller.status}.`,
      );
    }

    const now = new Date();
    const updated = await this.sellerRepo.updateSellerSelect(
      sellerId,
      {
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        isGstVerified: !!(seller as any).gstin,
        gstVerifiedAt: (seller as any).gstin ? now : null,
        gstVerifiedBy: (seller as any).gstin ? adminId : null,
        gstVerificationNotes: notes ?? null,
        panVerified: !!(seller as any).panNumber,
      },
      { id: true, status: true, verificationStatus: true },
    );

    this.eventBus
      .publish({
        eventName: 'seller.approved',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: now,
        payload: { sellerId, adminId, notes: notes ?? null },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish seller.approved event: ${err}`);
      });

    this.logger.log(`Seller approved by admin ${adminId}: ${sellerId}`);

    return {
      sellerId: updated.id,
      status: updated.status,
      verificationStatus: updated.verificationStatus,
    };
  }
}
