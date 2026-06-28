import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';
import { computeProfileCompletion } from '../../../../core/utils';
import { MediaType } from './upload-seller-media.use-case';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { isSellerProfileLocked } from '../../domain/policies/seller-access.policy';

@Injectable()
export class DeleteSellerMediaUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly media: MediaStorageAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DeleteSellerMediaUseCase');
  }

  async execute(sellerId: string, mediaType: MediaType) {
    const seller = await this.sellerRepo.findById(sellerId);

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    // Profile approval lock — media is part of the profile page; locked once
    // the admin approves the seller. Admin-only edits thereafter.
    if (isSellerProfileLocked(seller)) {
      throw new ForbiddenAppException(
        'Your profile is approved and locked. Contact your admin to change your profile media.',
        'PROFILE_LOCKED_CONTACT_ADMIN',
      );
    }

    const isProfileImage = mediaType === 'profile-image';
    const urlField = isProfileImage
      ? 'sellerProfileImageUrl'
      : 'sellerShopLogoUrl';
    const publicIdField = isProfileImage
      ? 'sellerProfileImagePublicId'
      : 'sellerShopLogoPublicId';

    const currentPublicId = (seller as Record<string, unknown>)[
      publicIdField
    ] as string | null;

    // If no image exists, return success (idempotent)
    if (!currentPublicId) {
      return {
        [urlField]: null,
        profileCompletionPercentage: seller.profileCompletionPercentage,
      };
    }

    // Clear from database first
    const updateData: Record<string, unknown> = {
      [urlField]: null,
      [publicIdField]: null,
      lastProfileUpdatedAt: new Date(),
    };

    const merged = { ...seller, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion(merged as any);
    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;

    await this.sellerRepo.updateSeller(sellerId, updateData);

    // Delete from media (best-effort)
    this.media.delete(currentPublicId).catch((err) => {
      this.logger.warn(
        `Failed to delete media asset ${currentPublicId}: ${err?.message}`,
      );
    });

    this.logger.log(`Seller ${mediaType} deleted: ${sellerId}`);

    return {
      [urlField]: null,
      profileCompletionPercentage,
    };
  }
}
