import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';
import { FileService } from '../../../files/application/services/file.service';
import { computeProfileCompletion } from '../../../../core/utils';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { isSellerProfileLocked } from '../../domain/policies/seller-access.policy';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export type MediaType = 'profile-image' | 'shop-logo';

@Injectable()
export class UploadSellerMediaUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly media: MediaStorageAdapter,
    private readonly fileService: FileService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('UploadSellerMediaUseCase');
  }

  async execute(
    sellerId: string,
    file: Express.Multer.File,
    mediaType: MediaType,
  ) {
    // Validate file presence
    if (!file || !file.buffer) {
      throw new AppException('No image file provided', 'BAD_REQUEST');
    }

    if (file.size === 0) {
      throw new AppException('Uploaded file is empty', 'BAD_REQUEST');
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new AppException(
        'Only JPG, PNG, and WEBP images are allowed',
        'BAD_REQUEST',
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');
    }

    // The browser's declared mimetype follows the file *extension*, which is
    // frequently wrong — a JPEG saved as .png, a WEBP saved as .jpg, a
    // screenshot re-encoded but never renamed. Detect the REAL type from the
    // magic bytes and accept it as long as it's one of our allowed formats.
    // This lets correctly-encoded-but-mislabelled images through while still
    // rejecting genuine non-images; the detected type is the source of truth.
    const detectedMimeType = this.detectImageType(file.buffer);
    if (!detectedMimeType) {
      throw new AppException('Invalid or corrupted image file', 'BAD_REQUEST');
    }

    // Load seller
    const seller = await this.sellerRepo.findById(sellerId);

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    // Profile approval lock — logo/profile image are part of the profile page,
    // so they freeze too once an admin approves the seller. Admin-only edits
    // thereafter; rejection re-opens it.
    if (isSellerProfileLocked(seller)) {
      throw new ForbiddenAppException(
        'Your profile is approved and locked. Contact your admin to change your profile media.',
        'PROFILE_LOCKED_CONTACT_ADMIN',
      );
    }

    const uploadAllowedStatuses = ['ACTIVE', 'PENDING_APPROVAL', 'INACTIVE'];
    if (!uploadAllowedStatuses.includes(seller.status)) {
      throw new ForbiddenAppException(
        'Media uploads are not available for suspended or deactivated accounts',
      );
    }

    // Determine fields based on media type
    const isProfileImage = mediaType === 'profile-image';
    const urlField = isProfileImage
      ? 'sellerProfileImageUrl'
      : 'sellerShopLogoUrl';
    const publicIdField = isProfileImage
      ? 'sellerProfileImagePublicId'
      : 'sellerShopLogoPublicId';
    const folder = isProfileImage
      ? `sportsmart/sellers/${sellerId}/profile`
      : `sportsmart/sellers/${sellerId}/shop-logo`;

    const oldPublicId = (seller as Record<string, unknown>)[publicIdField] as
      | string
      | null;

    // Upload to media
    const transformation = isProfileImage
      ? [{ width: 800, height: 800, crop: 'limit' }]
      : [{ width: 400, height: 400, crop: 'limit' }];

    let uploadResult;
    try {
      uploadResult = await this.media.upload(file.buffer, {
        folder,
        transformation,
      });
    } catch (error: any) {
      this.logger.error(`media upload failed for seller ${sellerId}: ${error?.message}`);
      throw new AppException(
        'Image upload failed. Please try again.',
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    // Additive, best-effort: register a central FileMetadata row so
    // integrity/audit/orphan-sweep can see this media asset. Never
    // affects the upload/validation/DB flow above.
    void this.fileService
      .registerExternalAsset({
        publicId: uploadResult.publicId,
        url: uploadResult.secureUrl,
        mimeType: detectedMimeType,
        sizeBytes: file.size,
        purpose: 'AVATAR',
        uploadedBy: sellerId,
        uploadedByType: 'SELLER',
        fileName: file.originalname,
        buffer: file.buffer,
      })
      .catch(() => undefined);

    // Update database
    const updateData: Record<string, unknown> = {
      [urlField]: uploadResult.secureUrl,
      [publicIdField]: uploadResult.publicId,
      lastProfileUpdatedAt: new Date(),
    };

    // Recompute profile completion
    const merged = { ...seller, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion(merged as any);
    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;

    try {
      await this.sellerRepo.updateSeller(sellerId, updateData);
    } catch (error: any) {
      // DB failed — try to clean up uploaded asset
      this.logger.error(
        `DB update failed after media upload for seller ${sellerId}: ${error?.message}`,
      );
      this.media.delete(uploadResult.publicId).catch(() => {});
      throw new AppException(
        'Failed to save image. Please try again.',
        'INTERNAL_ERROR',
      );
    }

    // Clean up old media asset (best-effort)
    if (oldPublicId) {
      this.media.delete(oldPublicId).catch((err) => {
        this.logger.warn(
          `Failed to delete old media asset ${oldPublicId}: ${err?.message}`,
        );
      });
    }

    this.logger.log(
      `Seller ${mediaType} uploaded: ${sellerId}`,
    );

    return {
      [urlField]: uploadResult.secureUrl,
      profileCompletionPercentage,
    };
  }

  /**
   * Detect the actual image type from the buffer's magic bytes, independent of
   * the (extension-derived, often-wrong) declared mimetype. Returns the matching
   * allowed mime type, or null if the bytes aren't a recognised allowed image.
   */
  private detectImageType(buffer: Buffer): string | null {
    // JPEG — FF D8 FF
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }
    // PNG — 89 50 4E 47
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    // WEBP — "RIFF" .... "WEBP" (RIFF at 0-3, WEBP at 8-11)
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }
}
