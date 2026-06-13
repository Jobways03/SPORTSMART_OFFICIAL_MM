import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

/**
 * Phase 19 (2026-05-20) — Seller profile read.
 *
 * Changes from the prior version:
 *
 *   1. Full `panNumber` is NO LONGER returned. The audit flagged that
 *      anyone holding the seller's access token could read the full
 *      PAN from the API response — a XSS / log-leak risk for what is
 *      effectively a tax-ID. Only `panLast4` is returned; if the
 *      seller needs to copy-paste the full PAN, a separate
 *      step-up-protected endpoint is the right path (not built in
 *      this PR — left as a known follow-up).
 *
 *   2. `gstVerificationNotes` is no longer returned — it was the
 *      semantically-overloaded legacy column. The new
 *      `kycRejectionReason` and `kycApprovalNotes` are returned
 *      instead.
 *
 *   3. First-listing wizard flags (`hasBankDetails`,
 *      `hasFirstProduct`, `hasDeliveryMethod`) are returned so the
 *      wizard can show real "done / to-do" state instead of always
 *      showing all three as incomplete.
 */
@Injectable()
export class GetSellerProfileUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly prisma: PrismaService,
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
      gstin: true,
      gstStateCode: true,
      gstRegistrationType: true,
      entityType: true,
      registeredBusinessAddressJson: true,
      legalBusinessName: true,
      panLast4: true,
      isGstVerified: true,
      gstVerifiedAt: true,
      panVerified: true,
      verificationStatus: true,
      // Phase 19 (2026-05-20) — replace the overloaded
      // gstVerificationNotes with the dedicated kyc columns. We keep
      // the legacy column out of the response to avoid frontend code
      // reading both during the soak window.
      kycApprovalNotes: true,
      kycRejectionReason: true,
      kycReviewedAt: true,
      isGstinManuallyVerified: true,
    });

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    // First-listing wizard support: parallel cheap counts so the
    // wizard's three CTAs (bank details, first product, delivery
    // method) reflect real state. Each query is bounded to a
    // single-row predicate so the cost is essentially free.
    const [bankRow, hasFirstProduct, hasDeliveryMethod, logisticsLocked] =
      await Promise.all([
        this.prisma.sellerBankDetails
          .findUnique({
            where: { sellerId },
            select: { accountNumberLast4: true, bankName: true },
          })
          .catch(() => null),
        this.prisma.product
          .findFirst({ where: { sellerId }, select: { id: true } })
          .then((r: { id: string } | null) => !!r)
          .catch(() => false),
        // Delivery method "configured" means self-delivery is enabled.
        // Same source of truth as the seller shipping admin page.
        Promise.resolve((seller as any).selfDeliveryEnabled ?? false),
        // Pickup/identity fields are frozen once the seller is registered
        // with a logistics partner (the data feeds the courier warehouse).
        this.prisma.sellerPartnerRegistration
          .findFirst({ where: { sellerId, status: 'REGISTERED' }, select: { id: true } })
          .then((r: { id: string } | null) => !!r)
          .catch(() => false),
      ]);
    const hasBankDetails = !!bankRow;

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
      registeredBusinessAddressJson:
        (seller as any).registeredBusinessAddressJson ?? null,
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
      gstin: (seller as any).gstin ?? null,
      gstStateCode: (seller as any).gstStateCode ?? null,
      gstRegistrationType: (seller as any).gstRegistrationType ?? null,
      entityType: (seller as any).entityType ?? null,
      legalBusinessName: (seller as any).legalBusinessName ?? null,
      // Phase 19 (2026-05-20) — full PAN deliberately omitted from
      // the response. Only the last 4 digits are returned for masked
      // display in the seller portal.
      panLast4: (seller as any).panLast4 ?? null,
      isGstVerified: (seller as any).isGstVerified ?? false,
      isGstinManuallyVerified:
        (seller as any).isGstinManuallyVerified ?? false,
      gstVerifiedAt: (seller as any).gstVerifiedAt ?? null,
      panVerified: (seller as any).panVerified ?? false,
      verificationStatus: (seller as any).verificationStatus ?? 'NOT_VERIFIED',
      kycApprovalNotes: (seller as any).kycApprovalNotes ?? null,
      kycRejectionReason: (seller as any).kycRejectionReason ?? null,
      kycReviewedAt: (seller as any).kycReviewedAt ?? null,
      // First-listing wizard CTAs gate on these.
      hasBankDetails,
      bankAccountLast4: bankRow?.accountNumberLast4 ?? null,
      bankName: bankRow?.bankName ?? null,
      hasFirstProduct,
      hasDeliveryMethod,
      // True once registered with a logistics partner — the portal
      // disables the pickup/identity fields and shows a "contact your
      // admin" banner. Enforced server-side in UpdateSellerProfileUseCase
      // regardless of this flag.
      logisticsLocked,
    };
  }
}
