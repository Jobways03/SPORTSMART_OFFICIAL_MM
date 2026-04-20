import { Injectable, Inject } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class GetFranchiseProfileUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
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
      panNumber: true,
      status: true,
      verificationStatus: true,
      onlineFulfillmentRate: true,
      procurementFeeRate: true,
      contractStartDate: true,
      contractEndDate: true,
      warehouseAddress: true,
      warehousePincode: true,
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
      panNumber: franchise.panNumber,
      status: franchise.status,
      verificationStatus: franchise.verificationStatus,
      onlineFulfillmentRate: franchise.onlineFulfillmentRate,
      procurementFeeRate: franchise.procurementFeeRate,
      contractStartDate: franchise.contractStartDate,
      contractEndDate: franchise.contractEndDate,
      warehouseAddress: franchise.warehouseAddress,
      warehousePincode: franchise.warehousePincode,
      profileImageUrl: franchise.profileImageUrl,
      logoUrl: franchise.logoUrl,
      assignedZone: franchise.assignedZone,
      isEmailVerified: franchise.isEmailVerified,
      profileCompletionPercentage: franchise.profileCompletionPercentage,
      isProfileCompleted: franchise.isProfileCompleted,
      createdAt: franchise.createdAt,
    };
  }
}
