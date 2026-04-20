import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { computeFranchiseProfileCompletion } from '../../../../core/utils';
import { FranchiseMediaType } from './upload-franchise-media.use-case';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class DeleteFranchiseMediaUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DeleteFranchiseMediaUseCase');
  }

  async execute(franchiseId: string, mediaType: FranchiseMediaType) {
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise) {
      throw new NotFoundAppException('Franchise profile not found');
    }

    const isProfileImage = mediaType === 'profile-image';
    const urlField = isProfileImage ? 'profileImageUrl' : 'logoUrl';
    const publicIdField = isProfileImage
      ? 'profileImagePublicId'
      : 'logoPublicId';

    const currentPublicId = (franchise as Record<string, unknown>)[
      publicIdField
    ] as string | null;

    // If no image exists, return success (idempotent)
    if (!currentPublicId) {
      return {
        [urlField]: null,
        profileCompletionPercentage: franchise.profileCompletionPercentage,
      };
    }

    // Clear from database first
    const updateData: Record<string, unknown> = {
      [urlField]: null,
      [publicIdField]: null,
    };

    const merged = { ...franchise, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeFranchiseProfileCompletion(merged as any);
    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;

    await this.franchiseRepo.updateFranchise(franchiseId, updateData);

    // Delete from Cloudinary (best-effort)
    this.cloudinary.delete(currentPublicId).catch((err) => {
      this.logger.warn(
        `Failed to delete Cloudinary asset ${currentPublicId}: ${err?.message}`,
      );
    });

    this.logger.log(`Franchise ${mediaType} deleted: ${franchiseId}`);

    return {
      [urlField]: null,
      profileCompletionPercentage,
    };
  }
}
