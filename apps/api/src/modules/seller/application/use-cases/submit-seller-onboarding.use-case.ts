import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface SubmitSellerOnboardingInput {
  sellerId: string;
  legalBusinessName: string;
  gstRegistrationType: 'REGULAR' | 'COMPOSITION' | 'CASUAL' | 'UNREGISTERED';
  gstin?: string;
  gstStateCode?: string;
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
}

@Injectable()
export class SubmitSellerOnboardingUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
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
    });

    if (!seller || (seller as any).isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (!seller.isEmailVerified) {
      throw new ForbiddenAppException(
        'Verify your email address before submitting onboarding documents',
      );
    }

    if (seller.status !== 'PENDING_APPROVAL') {
      throw new ForbiddenAppException(
        `Onboarding submission is only allowed while the account is PENDING_APPROVAL. Current status: ${seller.status}.`,
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

    // PAN ↔ GSTIN cross-check: GSTIN embeds the PAN at positions 3-12
    // per CBIC spec. Catch data-entry errors before they reach admin
    // review.
    if (input.gstin && input.gstin.substring(2, 12) !== input.panNumber) {
      throw new BadRequestAppException(
        'GSTIN does not embed the provided PAN. Check both fields — GSTIN positions 3-12 must equal the PAN.',
      );
    }

    const panLast4 = input.panNumber.slice(-4);

    const updated = await this.sellerRepo.updateSellerSelect(
      sellerId,
      {
        legalBusinessName: input.legalBusinessName,
        gstRegistrationType: input.gstRegistrationType,
        gstin: input.gstin ?? null,
        gstStateCode: input.gstStateCode ?? null,
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
        isProfileCompleted: true,
        profileCompletionPercentage: 100,
        lastProfileUpdatedAt: new Date(),
      },
      { id: true, verificationStatus: true, isProfileCompleted: true },
    );

    this.eventBus
      .publish({
        eventName: 'seller.onboarding_submitted',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId,
          legalBusinessName: input.legalBusinessName,
          gstRegistrationType: input.gstRegistrationType,
          hasGstin: !!input.gstin,
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
