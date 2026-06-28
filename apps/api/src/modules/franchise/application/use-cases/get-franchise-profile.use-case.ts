import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { computeFranchiseProfileCompletion } from '../../../../core/utils/franchise-profile-completion.util';

@Injectable()
export class GetFranchiseProfileUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(franchiseId: string) {
    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      franchiseCode: true,
      ownerName: true,
      businessName: true,
      email: true,
      phoneNumber: true,
      state: true,
      city: true,
      address: true,
      pincode: true,
      locality: true,
      country: true,
      gstNumber: true,
      entityType: true,
      panNumber: true,
      status: true,
      verificationStatus: true,
      // Profile approval lock (2026-06) + rejection reason — drive the
      // franchise portal's read-only state + pending/rejected/approved banners.
      profileLocked: true,
      verificationRejectionReason: true,
      onlineFulfillmentRate: true,
      procurementFeeRate: true,
      contractStartDate: true,
      contractEndDate: true,
      warehouseAddress: true,
      warehousePincode: true,
      warehouseCity: true,
      warehouseState: true,
      warehouseLocality: true,
      warehouseCountry: true,
      profileImageUrl: true,
      logoUrl: true,
      assignedZone: true,
      isEmailVerified: true,
      profileCompletionPercentage: true,
      isProfileCompleted: true,
      createdAt: true,
    });

    if (!franchise) {
      throw new NotFoundAppException('Franchise profile not found');
    }

    // Self-heal the completion %: it is a DERIVED field that was historically
    // only recomputed on profile-update / media changes — so a franchise that
    // filled everything at onboarding (or was created before the field was
    // wired) stays stuck at the 0% default despite a complete profile. Recompute
    // from the live fields here and lazily persist when it has drifted, so this
    // page AND the admin/dashboard views that read the stored column show the
    // true value.
    const { profileCompletionPercentage, isProfileCompleted } =
      computeFranchiseProfileCompletion(franchise as never);
    if (
      profileCompletionPercentage !== franchise.profileCompletionPercentage ||
      isProfileCompleted !== franchise.isProfileCompleted
    ) {
      await this.prisma.franchisePartner
        .update({
          where: { id: franchiseId },
          data: { profileCompletionPercentage, isProfileCompleted },
        })
        .catch(() => undefined); // best-effort self-heal; never fail the read
    }

    // Frozen once registered with a logistics partner — the franchise
    // portal disables the pickup/warehouse fields and shows a banner.
    const logisticsLocked = await this.prisma.franchisePartnerRegistration
      .findFirst({
        where: { franchiseId, status: 'REGISTERED' },
        select: { id: true },
      })
      .then((r: { id: string } | null) => !!r)
      .catch(() => false);

    // Whether payout bank details have been added — drives the dashboard
    // "Add bank details" banner so it disappears once they're on file.
    const hasBankDetails = await this.prisma.franchiseBankDetails
      .findUnique({
        where: { franchisePartnerId: franchiseId },
        select: { id: true },
      })
      .then((r: { id: string } | null) => !!r)
      .catch(() => false);

    return {
      franchiseId: franchise.id,
      franchiseCode: franchise.franchiseCode,
      ownerName: franchise.ownerName,
      businessName: franchise.businessName,
      email: franchise.email,
      phoneNumber: franchise.phoneNumber,
      state: franchise.state,
      city: franchise.city,
      address: franchise.address,
      pincode: franchise.pincode,
      locality: franchise.locality,
      country: franchise.country,
      gstNumber: franchise.gstNumber,
      entityType: (franchise as { entityType?: string | null }).entityType ?? null,
      panNumber: franchise.panNumber,
      status: franchise.status,
      verificationStatus: franchise.verificationStatus,
      // True once an admin marks the franchise VERIFIED — the portal renders
      // the profile read-only with a "contact admin" banner. Enforced
      // server-side in the profile/media use-cases regardless.
      profileLocked: (franchise as { profileLocked?: boolean | null }).profileLocked ?? false,
      verificationRejectionReason:
        (franchise as { verificationRejectionReason?: string | null })
          .verificationRejectionReason ?? null,
      onlineFulfillmentRate: franchise.onlineFulfillmentRate,
      procurementFeeRate: franchise.procurementFeeRate,
      contractStartDate: franchise.contractStartDate,
      contractEndDate: franchise.contractEndDate,
      warehouseAddress: franchise.warehouseAddress,
      warehousePincode: franchise.warehousePincode,
      warehouseCity: franchise.warehouseCity,
      warehouseState: franchise.warehouseState,
      warehouseLocality: franchise.warehouseLocality,
      warehouseCountry: franchise.warehouseCountry,
      profileImageUrl: franchise.profileImageUrl,
      logoUrl: franchise.logoUrl,
      assignedZone: franchise.assignedZone,
      isEmailVerified: franchise.isEmailVerified,
      profileCompletionPercentage,
      isProfileCompleted,
      createdAt: franchise.createdAt,
      logisticsLocked,
      hasBankDetails,
    };
  }
}
