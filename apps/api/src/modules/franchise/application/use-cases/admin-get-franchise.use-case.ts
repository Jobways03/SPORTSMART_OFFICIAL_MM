import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class AdminGetFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(franchiseId: string) {
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    // Bank payout details (masked) — joined so the admin can see the
    // franchise's settlement account without leaving the record.
    const bank = await this.prisma.franchiseBankDetails
      .findUnique({
        where: { franchisePartnerId: franchiseId },
        select: {
          accountNumberLast4: true,
          bankName: true,
          accountHolderName: true,
          ifscCode: true,
        },
      })
      .catch(() => null);

    // Logistics pickup readiness — mirrors the seller flow. A franchise sub-order
    // ships only once its store is registered as a courier "warehouse" (shipping-
    // public.facade resolvePickupWarehouse keys off a non-null `warehouseName`,
    // set by the admin "Add pickup location" flow). Surface a derived flag so the
    // admin franchise detail page can flag an APPROVED franchise that still can't
    // fulfil online orders.
    const partnerRegs = await this.prisma.franchisePartnerRegistration
      .findMany({
        where: { franchiseId },
        select: { partner: true, status: true, warehouseName: true },
      })
      .catch(() => [] as { partner: string; status: string; warehouseName: string | null }[]);
    const registeredPartners = partnerRegs
      .filter((r) => !!r.warehouseName)
      .map((r) => r.partner);

    return {
      id: franchise.id,
      franchiseId: franchise.id,
      franchiseCode: franchise.franchiseCode,
      ownerName: franchise.ownerName,
      businessName: franchise.businessName,
      email: franchise.email,
      phoneNumber: franchise.phoneNumber,
      status: franchise.status,
      verificationStatus: franchise.verificationStatus,
      state: franchise.state,
      city: franchise.city,
      address: franchise.address,
      pincode: franchise.pincode,
      locality: franchise.locality,
      country: franchise.country,
      gstNumber: franchise.gstNumber,
      panNumber: franchise.panNumber,
      // Per-field tax-ID attestation flags (admin "Verify PAN/GSTIN"). Record-
      // keeping only — the §194-O TDS rate is driven by verificationStatus, not
      // these flags. Surfaced so the admin UI can show verified status + the
      // per-field verify buttons.
      panVerified: franchise.panVerified,
      gstVerified: franchise.gstVerified,
      onlineFulfillmentRate: franchise.onlineFulfillmentRate,
      procurementFeeRate: franchise.procurementFeeRate,
      contractStartDate: franchise.contractStartDate,
      contractEndDate: franchise.contractEndDate,
      warehouseAddress: franchise.warehouseAddress,
      warehousePincode: franchise.warehousePincode,
      profileImageUrl: franchise.profileImageUrl,
      logoUrl: franchise.logoUrl,
      assignedZone: franchise.assignedZone,
      profileCompletionPercentage: franchise.profileCompletionPercentage,
      isProfileCompleted: franchise.isProfileCompleted,
      isEmailVerified: franchise.isEmailVerified,
      lastLoginAt: franchise.lastLoginAt,
      createdAt: franchise.createdAt,
      updatedAt: franchise.updatedAt,
      // Bank payout details (masked) for the admin Bank section.
      hasBankDetails: !!bank,
      bankName: bank?.bankName ?? null,
      bankAccountHolderName: bank?.accountHolderName ?? null,
      bankAccountLast4: bank?.accountNumberLast4 ?? null,
      bankIfscCode: bank?.ifscCode ?? null,
      // Logistics pickup readiness (the main gate for online order delivery).
      selfDeliveryEnabled: (franchise as any).selfDeliveryEnabled ?? false,
      logisticsPickupRegistered: registeredPartners.length > 0,
      logisticsRegisteredPartners: registeredPartners,
      logisticsPartnerAttempts: partnerRegs.length,
    };
  }
}
