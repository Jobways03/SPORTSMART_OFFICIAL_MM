import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { computeFranchiseProfileCompletion } from '../../../../core/utils';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Magic bytes for image validation
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
};

export type FranchiseMediaType = 'profile-image' | 'logo';

@Injectable()
export class UploadFranchiseMediaUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('UploadFranchiseMediaUseCase');
  }

  async execute(
    franchiseId: string,
    file: Express.Multer.File,
    mediaType: FranchiseMediaType,
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

    // Validate magic bytes
    if (!this.validateMagicBytes(file.buffer, file.mimetype)) {
      throw new AppException('Invalid or corrupted image file', 'BAD_REQUEST');
    }

    // Load franchise
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise) {
      throw new NotFoundAppException('Franchise profile not found');
    }

    const uploadAllowedStatuses = ['ACTIVE', 'APPROVED', 'PENDING'];
    if (!uploadAllowedStatuses.includes(franchise.status)) {
      throw new ForbiddenAppException(
        'Media uploads are not available for suspended or deactivated accounts',
      );
    }

    // Determine fields based on media type
    const isProfileImage = mediaType === 'profile-image';
    const urlField = isProfileImage ? 'profileImageUrl' : 'logoUrl';
    const publicIdField = isProfileImage
      ? 'profileImagePublicId'
      : 'logoPublicId';
    const folder = isProfileImage
      ? `sportsmart/franchises/${franchiseId}/profile`
      : `sportsmart/franchises/${franchiseId}/logo`;

    const oldPublicId = (franchise as Record<string, unknown>)[publicIdField] as
      | string
      | null;

    // Upload to Cloudinary
    const transformation = isProfileImage
      ? [{ width: 800, height: 800, crop: 'limit' }]
      : [{ width: 400, height: 400, crop: 'limit' }];

    let uploadResult;
    try {
      uploadResult = await this.cloudinary.upload(file.buffer, {
        folder,
        transformation,
      });
    } catch (error: any) {
      this.logger.error(`Cloudinary upload failed for franchise ${franchiseId}: ${error?.message}`);
      throw new AppException(
        'Image upload failed. Please try again.',
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    // Update database
    const updateData: Record<string, unknown> = {
      [urlField]: uploadResult.secureUrl,
      [publicIdField]: uploadResult.publicId,
    };

    // Recompute profile completion
    const merged = { ...franchise, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeFranchiseProfileCompletion(merged as any);
    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;

    try {
      await this.franchiseRepo.updateFranchise(franchiseId, updateData);
    } catch (error: any) {
      // DB failed — try to clean up uploaded asset
      this.logger.error(
        `DB update failed after Cloudinary upload for franchise ${franchiseId}: ${error?.message}`,
      );
      this.cloudinary.delete(uploadResult.publicId).catch(() => {});
      throw new AppException(
        'Failed to save image. Please try again.',
        'INTERNAL_ERROR',
      );
    }

    // Clean up old Cloudinary asset (best-effort)
    if (oldPublicId) {
      this.cloudinary.delete(oldPublicId).catch((err) => {
        this.logger.warn(
          `Failed to delete old Cloudinary asset ${oldPublicId}: ${err?.message}`,
        );
      });
    }

    this.logger.log(
      `Franchise ${mediaType} uploaded: ${franchiseId}`,
    );

    return {
      [urlField]: uploadResult.secureUrl,
      profileCompletionPercentage,
    };
  }

  private validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    const patterns = MAGIC_BYTES[mimeType];
    if (!patterns) return false;

    return patterns.some((pattern) => {
      if (buffer.length < pattern.length) return false;
      return pattern.every((byte, i) => buffer[i] === byte);
    });
  }
}
