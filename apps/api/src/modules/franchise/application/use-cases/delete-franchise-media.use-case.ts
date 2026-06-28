import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';
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
    private readonly media: MediaStorageAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DeleteFranchiseMediaUseCase');
  }

  async execute(franchiseId: string, mediaType: FranchiseMediaType) {
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise) {
      throw new NotFoundAppException('Franchise profile not found');
    }

    // Profile approval lock — media is part of the profile page; locked once
    // the admin marks the franchise VERIFIED. Admin-only edits thereafter.
    if ((franchise as { profileLocked?: boolean | null }).profileLocked === true) {
      throw new ForbiddenAppException(
        'Your profile is approved and locked. Contact your admin to change your profile media.',
        'PROFILE_LOCKED_CONTACT_ADMIN',
      );
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

    // Delete from media (best-effort)
    this.media.delete(currentPublicId).catch((err) => {
      this.logger.warn(
        `Failed to delete media asset ${currentPublicId}: ${err?.message}`,
      );
    });

    this.logger.log(`Franchise ${mediaType} deleted: ${franchiseId}`);

    return {
      [urlField]: null,
      profileCompletionPercentage,
    };
  }
}
