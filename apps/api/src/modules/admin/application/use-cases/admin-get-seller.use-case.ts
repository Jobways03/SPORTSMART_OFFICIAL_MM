import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class AdminGetSellerUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(sellerId: string) {
    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      sellerName: true,
      sellerShopName: true,
      email: true,
      phoneNumber: true,
      sellerContactCountryCode: true,
      sellerContactNumber: true,
      storeAddress: true,
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
      verificationStatus: true,
      isEmailVerified: true,
      profileCompletionPercentage: true,
      isProfileCompleted: true,
      isDeleted: true,
      deletedAt: true,
      lastProfileUpdatedAt: true,
      lastLoginAt: true,
      failedLoginAttempts: true,
      lockUntil: true,
      createdAt: true,
      updatedAt: true,
      // Phase 26 GST (2026-05-18) — tax identity. Surfaced to admin
      // detail page so the Super Admin can audit + verify GSTIN/PAN
      // without leaving the seller record. Returned to the client via
      // the same `seller` spread the controller already does.
      gstin: true,
      gstStateCode: true,
      gstRegistrationType: true,
      entityType: true,
      registeredBusinessAddressJson: true,
      legalBusinessName: true,
      panNumber: true,
      panLast4: true,
      isGstVerified: true,
      gstVerifiedAt: true,
      gstVerifiedBy: true,
      gstVerificationNotes: true,
      panVerified: true,
      // Logistics entitlement — the self-delivery toggle the admin flips.
      selfDeliveryEnabled: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    // Bank payout details (masked) — joined so the admin can see the
    // seller's settlement account without leaving the record.
    const bank = await this.prisma.sellerBankDetails
      .findUnique({
        where: { sellerId },
        select: {
          accountNumberLast4: true,
          bankName: true,
          accountHolderName: true,
          ifscCode: true,
        },
      })
      .catch(() => null);

    // Logistics pickup readiness. A sub-order can only be shipped once the
    // seller's pickup address is registered as a courier "warehouse" (see
    // shipping-public.facade resolvePickupWarehouse — it keys off a non-null
    // `warehouseName`, set by the admin "Add pickup location" flow). We surface
    // a derived `logisticsPickupRegistered` so the admin detail page can flag an
    // APPROVED seller that still can't fulfil orders. Truthful to the actual
    // ship gate: keyed on warehouseName, not just the status string.
    const partnerRegs = await this.prisma.sellerPartnerRegistration
      .findMany({
        where: { sellerId },
        select: { partner: true, status: true, warehouseName: true },
      })
      .catch(() => [] as { partner: string; status: string; warehouseName: string | null }[]);
    const registeredPartners = partnerRegs
      .filter((r) => !!r.warehouseName)
      .map((r) => r.partner);

    return {
      sellerId: seller.id,
      sellerName: seller.sellerName,
      sellerShopName: seller.sellerShopName,
      email: seller.email,
      phoneNumber: seller.phoneNumber,
      sellerContactCountryCode: seller.sellerContactCountryCode,
      sellerContactNumber: seller.sellerContactNumber,
      storeAddress: seller.storeAddress,
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
      verificationStatus: seller.verificationStatus,
      isEmailVerified: seller.isEmailVerified,
      profileCompletionPercentage: seller.profileCompletionPercentage,
      isProfileCompleted: seller.isProfileCompleted,
      lastProfileUpdatedAt: seller.lastProfileUpdatedAt,
      lastLoginAt: seller.lastLoginAt,
      failedLoginAttempts: seller.failedLoginAttempts,
      lockUntil: seller.lockUntil,
      createdAt: seller.createdAt,
      updatedAt: seller.updatedAt,
      // Phase 26 GST — tax identity for admin audit/verification UI.
      gstin: (seller as any).gstin ?? null,
      gstStateCode: (seller as any).gstStateCode ?? null,
      gstRegistrationType: (seller as any).gstRegistrationType ?? null,
      entityType: (seller as any).entityType ?? null,
      registeredBusinessAddressJson:
        (seller as any).registeredBusinessAddressJson ?? null,
      legalBusinessName: (seller as any).legalBusinessName ?? null,
      panNumber: (seller as any).panNumber ?? null,
      panLast4: (seller as any).panLast4 ?? null,
      isGstVerified: (seller as any).isGstVerified ?? false,
      gstVerifiedAt: (seller as any).gstVerifiedAt ?? null,
      gstVerifiedBy: (seller as any).gstVerifiedBy ?? null,
      gstVerificationNotes: (seller as any).gstVerificationNotes ?? null,
      panVerified: (seller as any).panVerified ?? false,
      // Bank payout details (masked) for the admin Bank section.
      hasBankDetails: !!bank,
      bankName: bank?.bankName ?? null,
      bankAccountHolderName: bank?.accountHolderName ?? null,
      bankAccountLast4: bank?.accountNumberLast4 ?? null,
      bankIfscCode: bank?.ifscCode ?? null,
      // Logistics pickup readiness (the main gate for product delivery).
      selfDeliveryEnabled: (seller as any).selfDeliveryEnabled ?? false,
      logisticsPickupRegistered: registeredPartners.length > 0,
      logisticsRegisteredPartners: registeredPartners,
      logisticsPartnerAttempts: partnerRegs.length,
    };
  }
}
