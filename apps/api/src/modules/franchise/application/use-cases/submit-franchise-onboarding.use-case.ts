import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface SubmitFranchiseOnboardingInput {
  franchiseId: string;
  legalBusinessName: string;
  gstRegistrationType: 'REGULAR' | 'COMPOSITION' | 'CASUAL';
  gstNumber: string;
  gstStateCode: string;
  panNumber: string;
  businessAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };
  warehouseAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };
  confirmedAccurate: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 20 (2026-05-20) — Franchise KYC submission.
 *
 * Mirrors SubmitSellerOnboardingUseCase:
 *   • Email-verified + status=PENDING + verification ∈ {NOT_VERIFIED,
 *     REJECTED} preconditions.
 *   • GSTIN[0:2] === gstStateCode cross-check.
 *   • GSTIN[2:12] === panNumber cross-check.
 *   • Duplicate GSTIN/PAN pre-check against other franchises.
 *   • Stamps verificationStatus=UNDER_REVIEW + kycSubmittedAt +
 *     kycConfirmedAccurateAt.
 *   • Persists a snapshot of the submitted payload in
 *     kycSubmittedPayloadJson so admin reviewers see exactly what
 *     was submitted regardless of subsequent profile edits.
 *   • Writes a FRANCHISE_KYC_SUBMITTED AuditLog row.
 */
@Injectable()
export class SubmitFranchiseOnboardingUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SubmitFranchiseOnboardingUseCase');
  }

  async execute(input: SubmitFranchiseOnboardingInput): Promise<{
    franchiseId: string;
    verificationStatus: string;
  }> {
    const { franchiseId } = input;

    if (!input.confirmedAccurate) {
      throw new BadRequestAppException(
        'You must confirm the submitted information is accurate before proceeding',
      );
    }

    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      status: true,
      isEmailVerified: true,
      verificationStatus: true,
      isDeleted: true,
    });

    if (!franchise || (franchise as any).isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    if (!franchise.isEmailVerified) {
      throw new ForbiddenAppException(
        'Verify your email address before submitting onboarding documents',
      );
    }

    if (franchise.status !== 'PENDING') {
      throw new ForbiddenAppException(
        `Onboarding submission is only allowed while the account is PENDING. Current status: ${franchise.status}.`,
      );
    }

    if (franchise.verificationStatus === 'UNDER_REVIEW') {
      throw new BadRequestAppException(
        'Your onboarding is already under review. Please wait for the admin decision.',
      );
    }
    if (franchise.verificationStatus === 'VERIFIED') {
      throw new BadRequestAppException(
        'Your franchise is already verified',
      );
    }

    // PAN ↔ GSTIN cross-check (positions 3-12 of GSTIN are the PAN).
    if (input.gstNumber.substring(2, 12) !== input.panNumber) {
      throw new BadRequestAppException(
        'GSTIN does not embed the provided PAN. Check both fields — GSTIN positions 3-12 must equal the PAN.',
      );
    }

    // GSTIN state-code cross-check.
    if (input.gstNumber.substring(0, 2) !== input.gstStateCode) {
      throw new BadRequestAppException(
        'GSTIN state code mismatch. The first two digits of GSTIN must equal the declared GST state code.',
      );
    }

    // Duplicate-legal-identity pre-check.
    const gstinOwner = await this.franchiseRepo.findByGstNumber(input.gstNumber);
    if (gstinOwner && gstinOwner.id !== franchiseId) {
      throw new ConflictAppException(
        'This GSTIN is already registered to another franchise. Contact support if you believe this is an error.',
      );
    }
    const panOwner = await this.franchiseRepo.findByPanNumber(input.panNumber);
    if (panOwner && panOwner.id !== franchiseId) {
      throw new ConflictAppException(
        'This PAN is already registered to another franchise. Contact support if you believe this is an error.',
      );
    }

    const panLast4 = input.panNumber.slice(-4);
    const now = new Date();

    let updated: { id: string; verificationStatus: string };
    try {
      updated = await this.franchiseRepo.updateFranchiseSelect(
        franchiseId,
        {
          legalBusinessName: input.legalBusinessName,
          gstNumber: input.gstNumber,
          gstStateCode: input.gstStateCode,
          panNumber: input.panNumber,
          panLast4,
          address: input.businessAddress.line1,
          city: input.businessAddress.city,
          state: input.businessAddress.state,
          pincode: input.businessAddress.pincode,
          country: input.businessAddress.country ?? 'India',
          warehouseAddress:
            input.warehouseAddress?.line1 ?? input.businessAddress.line1,
          warehousePincode:
            input.warehouseAddress?.pincode ?? input.businessAddress.pincode,
          verificationStatus: 'UNDER_REVIEW',
          verificationRejectionReason: null,
          kycSubmittedAt: now,
          kycSubmittedPayloadJson: {
            legalBusinessName: input.legalBusinessName,
            gstRegistrationType: input.gstRegistrationType,
            gstNumber: input.gstNumber,
            gstStateCode: input.gstStateCode,
            panLast4,
            businessAddress: input.businessAddress,
            warehouseAddress: input.warehouseAddress ?? null,
            submittedAt: now.toISOString(),
          },
          kycConfirmedAccurateAt: now,
        },
        { id: true, verificationStatus: true },
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const target = err?.meta?.target;
        if (target?.includes?.('gst_number')) {
          throw new ConflictAppException(
            'This GSTIN is already registered to another franchise.',
          );
        }
        if (target?.includes?.('pan_number')) {
          throw new ConflictAppException(
            'This PAN is already registered to another franchise.',
          );
        }
      }
      throw err;
    }

    this.audit
      .writeAuditLog({
        actorId: franchiseId,
        actorRole: 'FRANCHISE',
        action: 'FRANCHISE_KYC_SUBMITTED',
        module: 'franchise',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        newValue: {
          verificationStatus: 'UNDER_REVIEW',
          gstRegistrationType: input.gstRegistrationType,
          legalBusinessName: input.legalBusinessName,
          panLast4,
        },
        metadata: { confirmedAccurate: true },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.error(`Audit log write failed for KYC submit: ${err}`),
      );

    this.eventBus
      .publish({
        eventName: 'franchise.onboarding_submitted',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: now,
        payload: {
          franchiseId,
          legalBusinessName: input.legalBusinessName,
          gstRegistrationType: input.gstRegistrationType,
          panLast4,
        },
      })
      .catch((err) =>
        this.logger.error(`Event publish failed for KYC submit: ${err}`),
      );

    this.logger.log(`Franchise onboarding submitted: ${franchiseId}`);

    return {
      franchiseId: updated.id,
      verificationStatus: updated.verificationStatus,
    };
  }
}
