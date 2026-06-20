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
  gstinEmbedsPan,
  gstinStateMatches,
  TAX_ID_MESSAGES,
} from '../../../tax/domain/tax-id-rules';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { computeProfileCompletion } from '../../../../core/utils';

interface SubmitSellerOnboardingInput {
  sellerId: string;
  legalBusinessName: string;
  // Phase 19 (2026-05-20) — UNREGISTERED removed from the DTO. The
  // type stays as a union of the three legal values so a malformed
  // client can't sneak through.
  gstRegistrationType: 'REGULAR' | 'COMPOSITION' | 'CASUAL';
  entityType:
    | 'PUBLIC_LIMITED'
    | 'PRIVATE_LIMITED'
    | 'SOLE_PROPRIETORSHIP'
    | 'GENERAL_PARTNERSHIP'
    | 'LLP';
  gstin: string;
  gstStateCode: string;
  panNumber: string;
  registeredBusinessAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };
  storeAddress: string;
  city: string;
  state: string;
  country: string;
  sellerZipCode: string;
  locality?: string;
  sellerContactCountryCode?: string;
  sellerContactNumber?: string;
  shortStoreDescription?: string;
  detailedStoreDescription?: string;
  confirmedAccurate: boolean;
  /** Phase 19 (2026-05-20) — audit-trail context. Best-effort. */
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 19 (2026-05-20) — Seller onboarding submission.
 *
 * Hardening vs prior version:
 *   • GSTIN[0:2] === gstStateCode cross-check.
 *   • Duplicate GSTIN/PAN pre-check against other sellers.
 *   • Audit-log row (`SELLER_KYC_SUBMITTED`) capturing
 *     confirmedAccurate, IP, user-agent.
 *   • Stamps `kycConfirmedAccurateAt` on the seller row.
 *   • Clears stale `kycRejectionReason` (and the legacy
 *     `gstVerificationNotes`) on a fresh submit.
 *   • The dead `UNREGISTERED` defensive branch is dropped; the DTO
 *     no longer accepts the value.
 */
@Injectable()
export class SubmitSellerOnboardingUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SubmitSellerOnboardingUseCase');
  }

  async execute(input: SubmitSellerOnboardingInput): Promise<{
    sellerId: string;
    verificationStatus: string;
    isProfileCompleted: boolean;
  }> {
    const { sellerId } = input;

    if (!input.confirmedAccurate) {
      throw new BadRequestAppException(
        'You must confirm the submitted information is accurate before proceeding',
      );
    }

    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      status: true,
      isEmailVerified: true,
      verificationStatus: true,
      isDeleted: true,
      // Phase 21 (2026-05-20) — read kycReviewedAt so we can enforce
      // a post-reject cooldown (M9). The column is stamped by the
      // admin reject use-case.
      kycReviewedAt: true,
      // For an honest completion % (not a hardcoded 100): KYC fills the
      // address/contact/descriptions, while logo/image/policy come from the
      // existing row and still count toward the total.
      sellerPolicy: true,
      sellerProfileImageUrl: true,
      sellerShopLogoUrl: true,
    });

    if (!seller || (seller as any).isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (!seller.isEmailVerified) {
      throw new ForbiddenAppException(
        'Verify your email address before submitting onboarding documents',
      );
    }

    // KYC submission is allowed whenever the account is operable and KYC
    // isn't already done. This used to require PENDING_APPROVAL, but a seller
    // activated by an admin status-override BEFORE submitting KYC (status
    // ACTIVE, verificationStatus NOT_VERIFIED) was then permanently unable to
    // provide it — ACTIVE has no transition back to PENDING_APPROVAL. Allow
    // PENDING_APPROVAL / ACTIVE / INACTIVE; block only hard-disabled accounts.
    // The verificationStatus checks below still prevent double-submits and
    // re-submits after the account is already verified.
    if (seller.status === 'DEACTIVATED' || seller.status === 'SUSPENDED') {
      throw new ForbiddenAppException(
        `Onboarding submission is not allowed while the account is ${seller.status}.`,
      );
    }

    if (seller.verificationStatus === 'UNDER_REVIEW') {
      throw new BadRequestAppException(
        'Your onboarding is already under review. Please wait for the admin decision.',
      );
    }

    if (seller.verificationStatus === 'VERIFIED') {
      throw new BadRequestAppException(
        'Your seller account is already verified',
      );
    }

    // Phase 21 (2026-05-20) — Post-reject resubmit cooldown. After an
    // admin rejection, sellers must wait at least RESUBMIT_COOLDOWN
    // before resubmitting so they (a) actually read the rejection
    // reason and (b) cannot DoS the admin review queue by spamming
    // resubmits. 5 minutes is short enough that a legitimate fix
    // doesn't feel punished, long enough that an automated retry
    // loop is throttled.
    const RESUBMIT_COOLDOWN_MS = 5 * 60 * 1000;
    if (
      seller.verificationStatus === 'REJECTED' &&
      (seller as any).kycReviewedAt
    ) {
      const reviewedAt = new Date((seller as any).kycReviewedAt).getTime();
      const elapsedMs = Date.now() - reviewedAt;
      if (elapsedMs < RESUBMIT_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil(
          (RESUBMIT_COOLDOWN_MS - elapsedMs) / 1000,
        );
        throw new BadRequestAppException(
          `Please wait ${retryAfterSeconds} second(s) before resubmitting. Review the rejection reason first.`,
          'KYC_RESUBMIT_COOLDOWN',
        );
      }
    }

    // PAN ↔ GSTIN cross-check: GSTIN embeds the PAN at positions 3-12
    // per CBIC spec.
    if (!gstinEmbedsPan(input.gstin, input.panNumber)) {
      throw new BadRequestAppException(TAX_ID_MESSAGES.PAN_GSTIN_MISMATCH);
    }

    // Phase 19 (2026-05-20) — GSTIN state-code cross-check. The first
    // two digits of the GSTIN MUST match the declared gstStateCode.
    if (!gstinStateMatches(input.gstin, input.gstStateCode)) {
      throw new BadRequestAppException(TAX_ID_MESSAGES.GSTIN_STATE_MISMATCH);
    }

    // Phase 19 (2026-05-20) — duplicate-legal-identity pre-check.
    // The Prisma @unique catches at the DB layer too (P2002), but
    // pre-checking lets us return a clean 409 with the right field
    // attribution.
    const gstinOwner = await this.sellerRepo.findByGstin(input.gstin);
    if (gstinOwner && gstinOwner.id !== sellerId) {
      throw new ConflictAppException(
        'This GSTIN is already registered to another seller account. Contact support if you believe this is an error.',
      );
    }
    const panOwner = await this.sellerRepo.findByPanNumber(input.panNumber);
    if (panOwner && panOwner.id !== sellerId) {
      throw new ConflictAppException(
        'This PAN is already registered to another seller account. Contact support if you believe this is an error.',
      );
    }

    const panLast4 = input.panNumber.slice(-4);
    const now = new Date();

    // Honest completion: merge the KYC fields onto the existing row (which
    // carries the logo/image/policy) so the % reflects what's actually filled,
    // instead of jumping to 100 the moment KYC is submitted.
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion({
        ...(seller as any),
        storeAddress: input.storeAddress,
        city: input.city,
        state: input.state,
        country: input.country,
        sellerZipCode: input.sellerZipCode,
        sellerContactCountryCode: input.sellerContactCountryCode ?? null,
        sellerContactNumber: input.sellerContactNumber ?? null,
        shortStoreDescription: input.shortStoreDescription ?? null,
        detailedStoreDescription: input.detailedStoreDescription ?? null,
      } as any);

    let updated: { id: string; verificationStatus: string; isProfileCompleted: boolean };
    try {
      updated = await this.sellerRepo.updateSellerSelect(
        sellerId,
        {
          legalBusinessName: input.legalBusinessName,
          entityType: input.entityType,
          gstRegistrationType: input.gstRegistrationType,
          gstin: input.gstin,
          gstStateCode: input.gstStateCode,
          panNumber: input.panNumber,
          panLast4,
          registeredBusinessAddressJson: input.registeredBusinessAddress,
          storeAddress: input.storeAddress,
          city: input.city,
          state: input.state,
          country: input.country,
          sellerZipCode: input.sellerZipCode,
          locality: input.locality ?? null,
          sellerContactCountryCode: input.sellerContactCountryCode ?? null,
          sellerContactNumber: input.sellerContactNumber ?? null,
          shortStoreDescription: input.shortStoreDescription ?? null,
          detailedStoreDescription: input.detailedStoreDescription ?? null,
          verificationStatus: 'UNDER_REVIEW',
          // Clear stale rejection state on resubmit.
          kycRejectionReason: null,
          gstVerificationNotes: null,
          isProfileCompleted,
          profileCompletionPercentage,
          lastProfileUpdatedAt: now,
          kycConfirmedAccurateAt: now,
        },
        { id: true, verificationStatus: true, isProfileCompleted: true },
      );
    } catch (err: any) {
      // Race window: another submit with the same GSTIN/PAN landed
      // between our pre-check and our update. The DB @unique
      // catches it; translate to the same 409 shape.
      if (err?.code === 'P2002') {
        const target = err?.meta?.target;
        if (target?.includes?.('gstin')) {
          throw new ConflictAppException(
            'This GSTIN is already registered to another seller account.',
          );
        }
        if (target?.includes?.('pan_number')) {
          throw new ConflictAppException(
            'This PAN is already registered to another seller account.',
          );
        }
      }
      throw err;
    }

    // Best-effort audit log. The seller row already carries
    // kycConfirmedAccurateAt as the load-bearing consent record;
    // this row captures the broader review context.
    this.audit
      .writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action: 'SELLER_KYC_SUBMITTED',
        module: 'seller',
        resource: 'Seller',
        resourceId: sellerId,
        newValue: {
          verificationStatus: 'UNDER_REVIEW',
          gstRegistrationType: input.gstRegistrationType,
          hasGstin: true,
          legalBusinessName: input.legalBusinessName,
          panLast4,
        },
        metadata: { confirmedAccurate: true },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Failed to write audit log for KYC submit: ${err}`);
      });

    this.eventBus
      .publish({
        eventName: 'seller.onboarding_submitted',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: now,
        payload: {
          sellerId,
          legalBusinessName: input.legalBusinessName,
          gstRegistrationType: input.gstRegistrationType,
          panLast4,
          previousVerificationStatus: seller.verificationStatus,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish onboarding submission event: ${err}`);
      });

    this.logger.log(`Seller onboarding submitted: ${sellerId}`);

    return {
      sellerId: updated.id,
      verificationStatus: updated.verificationStatus,
      isProfileCompleted: updated.isProfileCompleted,
    };
  }
}
