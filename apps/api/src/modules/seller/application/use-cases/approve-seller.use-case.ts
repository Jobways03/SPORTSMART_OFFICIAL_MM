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

interface ApproveSellerInput {
  sellerId: string;
  adminId: string;
  notes?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 19 (2026-05-20) — Admin "approve seller" use case.
 *
 * Key changes vs prior version (addressing audit gaps):
 *
 *   1. No longer auto-flips `isGstVerified=true` + `panVerified=true`
 *      on approve. The audit flagged this as misleading — approval
 *      is an onboarding-completed signal, not a GSTN-portal lookup.
 *      A separate admin action (verify-gstin) will set
 *      `isGstinManuallyVerified=true` after a real portal check.
 *
 *   2. Writes to the new `kycApprovalNotes` column instead of
 *      overloading `gstVerificationNotes`. Also stamps
 *      `kycReviewedAt` and `kycReviewedBy` so admin actions are
 *      queryable.
 *
 *   3. Writes an `SELLER_APPROVED` AuditLog row capturing the
 *      decision in the tamper-evident chain.
 */
@Injectable()
export class ApproveSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
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

    // Phase 26 GST — GSTIN + PAN both mandatory before activation.
    if (!(seller as any).gstin) {
      throw new BadRequestAppException(
        'Cannot approve a seller without a GSTIN. Ask the seller to submit GSTIN via onboarding before approval.',
      );
    }
    if (!(seller as any).panNumber) {
      throw new BadRequestAppException(
        'Cannot approve a seller without a PAN. PAN is required for TDS reporting (Section 194-O).',
      );
    }

    const now = new Date();
    const updated = await this.sellerRepo.updateSellerSelect(
      sellerId,
      {
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        // Phase 19 (2026-05-20) — kyc-review columns (split from
        // legacy gst_verification_notes overloading).
        kycApprovalNotes: notes ?? null,
        kycReviewedAt: now,
        kycReviewedBy: adminId,
        // Clear stale rejection state — a previously-rejected seller
        // who was re-submitted and approved should not still carry
        // an old rejection reason.
        kycRejectionReason: null,
        // DO NOT auto-flip isGstVerified / panVerified. Those flags
        // now mean "the GSTN portal lookup actually returned a
        // match" — a separate admin action sets them. Approval is
        // about onboarding-completed, not GSTN verification.
      },
      { id: true, status: true, verificationStatus: true },
    );

    // Audit row. Best-effort; logging failure must not roll back
    // the approval. The seller-row update is the source of truth.
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'SELLER_APPROVED',
        module: 'seller',
        resource: 'Seller',
        resourceId: sellerId,
        oldValue: {
          status: seller.status,
          verificationStatus: seller.verificationStatus,
        },
        newValue: {
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
        },
        metadata: { notes: notes ?? null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Failed to write SELLER_APPROVED audit log: ${err}`);
      });

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
