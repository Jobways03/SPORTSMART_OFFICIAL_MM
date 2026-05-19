import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

@Injectable()
export class GetSellerProfileUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
  ) {}

  async execute(sellerId: string) {
    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      sellerName: true,
      sellerShopName: true,
      email: true,
      phoneNumber: true,
      sellerContactCountryCode: true,
      sellerContactNumber: true,
      storeAddress: true,
      locality: true,
      city: true,
      state: true,
      country: true,
      sellerZipCode: true,
      shortStoreDescription: true,
      detailedStoreDescription: true,
      sellerPolicy: true,
      sellerProfileImageUrl: true,
      sellerShopLogoUrl: true,
      status: true,
      isEmailVerified: true,
      profileCompletionPercentage: true,
      isProfileCompleted: true,
      lastProfileUpdatedAt: true,
      createdAt: true,
      // Phase 26 GST (2026-05-18) — surface tax identity to the seller
      // profile screen. Read-only on the seller side; admin owns
      // verification. Without this the seller could never see their
      // own GSTIN after onboarding.
      gstin: true,
      gstStateCode: true,
      gstRegistrationType: true,
      legalBusinessName: true,
      panNumber: true,
      panLast4: true,
      isGstVerified: true,
      gstVerifiedAt: true,
      panVerified: true,
      // Phase 26 GST — onboarding stepper on the seller portal reads
      // these to decide which step to show next (Submit KYC vs.
      // Awaiting approval). Without them the page falls through with
      // no card rendered. gstVerificationNotes carries the admin's
      // rejection reason so the form can prefill the "fix and resubmit"
      // banner.
      verificationStatus: true,
      gstVerificationNotes: true,
    });

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    return {
      sellerId: seller.id,
      email: seller.email,
      phoneNumber: seller.phoneNumber,
      sellerName: seller.sellerName,
      sellerShopName: seller.sellerShopName,
      sellerContactCountryCode: seller.sellerContactCountryCode,
      sellerContactNumber: seller.sellerContactNumber,
      storeAddress: seller.storeAddress,
      locality: seller.locality,
      city: seller.city,
      state: seller.state,
      country: seller.country,
      sellerZipCode: seller.sellerZipCode,
      shortStoreDescription: seller.shortStoreDescription,
      detailedStoreDescription: seller.detailedStoreDescription,
      sellerPolicy: seller.sellerPolicy,
      sellerProfileImageUrl: seller.sellerProfileImageUrl,
      sellerShopLogoUrl: seller.sellerShopLogoUrl,
      status: seller.status,
      isEmailVerified: seller.isEmailVerified,
      profileCompletionPercentage: seller.profileCompletionPercentage,
      isProfileCompleted: seller.isProfileCompleted,
      lastProfileUpdatedAt: seller.lastProfileUpdatedAt,
      createdAt: seller.createdAt,
      // Phase 26 GST — read-only tax identity block. PAN is masked
      // (panLast4) for display; the full panNumber stays in the
      // response so power-users can copy-paste for filing, but the
      // UI defaults to masked rendering.
      gstin: (seller as any).gstin ?? null,
      gstStateCode: (seller as any).gstStateCode ?? null,
      gstRegistrationType: (seller as any).gstRegistrationType ?? null,
      legalBusinessName: (seller as any).legalBusinessName ?? null,
      panNumber: (seller as any).panNumber ?? null,
      panLast4: (seller as any).panLast4 ?? null,
      isGstVerified: (seller as any).isGstVerified ?? false,
      gstVerifiedAt: (seller as any).gstVerifiedAt ?? null,
      panVerified: (seller as any).panVerified ?? false,
      verificationStatus: (seller as any).verificationStatus ?? 'NOT_VERIFIED',
      gstVerificationNotes: (seller as any).gstVerificationNotes ?? null,
    };
  }
}
