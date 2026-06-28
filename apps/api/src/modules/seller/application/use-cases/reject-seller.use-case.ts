import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
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
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 19 (2026-05-20) — Admin "reject seller" use case.
 *
 * Key changes vs prior version (addressing audit gaps):
 *
 *   1. Stores the rejection reason in the dedicated
 *      `kycRejectionReason` column instead of overloading the
 *      semantically-different `gstVerificationNotes`.
 *
 *   2. Stamps `kycReviewedAt` + `kycReviewedBy` for queryable admin
 *      action history.
 *
 *   3. Writes an `SELLER_REJECTED` AuditLog row.
 *
 *   4. Symmetry with approve: both now require
 *      verificationStatus=UNDER_REVIEW AND status=PENDING_APPROVAL.
 *      The previous reject path was more lenient (any verification
 *      status under review). The audit flagged this asymmetry; a
 *      SUSPENDED-but-UNDER_REVIEW row is unreachable in practice
 *      but the state-machine should be consistent.
 */
@Injectable()
export class RejectSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RejectSellerUseCase');
  }

  async execute(input: RejectSellerInput): Promise<{
    sellerId: string;
    verificationStatus: string;
  }> {
    const { sellerId, adminId, reason } = input;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestAppException(
        'A rejection reason is required so the seller knows what to fix and resubmit.',
      );
    }

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

    // Phase 19 (2026-05-20) — symmetry with approve. Reject now also
    // requires status=PENDING_APPROVAL.
    if (seller.status !== 'PENDING_APPROVAL') {
      throw new BadRequestAppException(
        `Seller is not pending approval. Current status: ${seller.status}.`,
      );
    }

    const now = new Date();
    const updated = await this.sellerRepo.updateSellerSelect(
      sellerId,
      {
        verificationStatus: 'REJECTED',
        // Profile approval lock (2026-06) — rejection re-opens the profile so
        // the seller can fix the flagged issues and resubmit for approval.
        profileLocked: false,
        // Phase 19 (2026-05-20) — dedicated rejection-reason column.
        kycRejectionReason: reason,
        kycReviewedAt: now,
        kycReviewedBy: adminId,
        // Clear the legacy overloaded column so future reads don't
        // see stale data conflated with the new column.
        gstVerificationNotes: null,
        gstVerifiedAt: null,
        gstVerifiedBy: null,
        kycApprovalNotes: null,
      },
      { id: true, verificationStatus: true },
    );

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'SELLER_REJECTED',
        module: 'seller',
        resource: 'Seller',
        resourceId: sellerId,
        oldValue: { verificationStatus: 'UNDER_REVIEW' },
        newValue: { verificationStatus: 'REJECTED' },
        metadata: { reason },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Failed to write SELLER_REJECTED audit log: ${err}`);
      });

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
