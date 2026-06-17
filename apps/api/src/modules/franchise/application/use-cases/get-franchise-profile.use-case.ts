import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

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
      profileCompletionPercentage: franchise.profileCompletionPercentage,
      isProfileCompleted: franchise.isProfileCompleted,
      createdAt: franchise.createdAt,
      logisticsLocked,
      hasBankDetails,
    };
  }
}
