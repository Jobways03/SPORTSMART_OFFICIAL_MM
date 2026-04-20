import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class AdminGetFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
  ) {}

  async execute(franchiseId: string) {
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

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
    };
  }
}
