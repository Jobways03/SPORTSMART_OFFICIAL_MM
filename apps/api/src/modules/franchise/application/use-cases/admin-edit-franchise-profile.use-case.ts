import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface EditFranchiseProfileInput {
  adminId: string;
  franchiseId: string;
  ownerName?: string;
  businessName?: string;
  phoneNumber?: string;
  gstNumber?: string;
  panNumber?: string;
  // Address fields — match the actual FranchisePartner Prisma model.
  // Do NOT re-introduce addressLine1/addressLine2/landmark/warehouseCity/
  // warehouseState/warehouseName/warehouseCapacity here; they don't exist
  // as columns and will be silently dropped or error on Prisma update.
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  locality?: string;
  warehouseAddress?: string;
  warehousePincode?: string;
}

@Injectable()
export class AdminEditFranchiseProfileUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminEditFranchiseProfileUseCase');
  }

  async execute(input: EditFranchiseProfileInput) {
    const { adminId, franchiseId, ...profileData } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    // Build update data — only include non-undefined fields
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(profileData)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { franchiseId, message: 'No changes' };
    }

    await this.franchiseRepo.updateFranchise(franchiseId, updateData);

    this.logger.log(`Admin ${adminId} edited franchise ${franchiseId} profile`);

    return { franchiseId, updated: Object.keys(updateData) };
  }
}
