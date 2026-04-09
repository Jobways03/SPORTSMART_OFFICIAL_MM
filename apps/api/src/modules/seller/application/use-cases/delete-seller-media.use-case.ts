import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { computeProfileCompletion } from '../../../../core/utils';
import { MediaType } from './upload-seller-media.use-case';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

@Injectable()
export class DeleteSellerMediaUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DeleteSellerMediaUseCase');
  }

  async execute(sellerId: string, mediaType: MediaType) {
    const seller = await this.sellerRepo.findById(sellerId);

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
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

    // Delete from Cloudinary (best-effort)
    this.cloudinary.delete(currentPublicId).catch((err) => {
      this.logger.warn(
        `Failed to delete Cloudinary asset ${currentPublicId}: ${err?.message}`,
      );
    });

    this.logger.log(`Seller ${mediaType} deleted: ${sellerId}`);

    return {
      [urlField]: null,
      profileCompletionPercentage,
    };
  }
}
