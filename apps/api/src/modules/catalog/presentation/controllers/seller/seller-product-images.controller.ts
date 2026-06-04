import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { MediaStorageAdapter } from '../../../../../integrations/media/media-storage.adapter';
import { FileService } from '../../../../files/application/services/file.service';
import { ReorderImagesDto } from '../../dtos/reorder-images.dto';
import { PRODUCT_IMAGE_REPOSITORY, IProductImageRepository } from '../../../domain/repositories/product-image.repository.interface';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MULTER_OPTIONS,
  MAX_IMAGE_BYTES,
  sanitizeAltText,
} from '../_helpers/image-upload';

@ApiTags('Seller Products')
@Controller('seller/products/:productId/images')
@UseGuards(SellerAuthGuard)
export class SellerProductImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly media: MediaStorageAdapter,
    private readonly fileService: FileService,
  ) {
    this.logger.setContext('SellerProductImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async uploadImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altTextRaw?: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    }
    if (file.size > MAX_IMAGE_BYTES) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');

    let uploadResult;
    try {
      uploadResult = await this.media.upload(file.buffer, {
        folder: `products/${productId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(
        `media upload failed for product ${productId}: ${error?.message}`,
      );
      throw new AppException('Image upload failed. Please try again.', 'EXTERNAL_SERVICE_ERROR');
    }

    // Additively register the media asset in the central
    // FileMetadata table so the integrity-verifier, audit, and orphan
    // sweep can see it. Best-effort — must never break the upload.
    void this.fileService
      .registerExternalAsset({
        publicId: uploadResult.publicId,
        url: uploadResult.secureUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        purpose: 'PRODUCT_IMAGE',
        uploadedBy: sellerId,
        uploadedByType: 'SELLER',
        fileName: file.originalname,
        buffer: file.buffer,
      })
      .catch(() => undefined);

    // Phase 42 (2026-05-21) — Gap #7 fix. media asset is in
    // cloud; from here on, any throw orphans it. The catch block
    // does a best-effort delete and rethrows the original error.
    // Also handles the Phase 29 partial-unique retry for primary
    // (concurrent first-image race) the same way the admin path does.
    const existingImages = await this.imageRepo.countByProduct(productId);
    let isPrimary = existingImages === 0;
    const altText = sanitizeAltText(altTextRaw);

    let image;
    try {
      image = await this.imageRepo.createProductImage({
        productId,
        url: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
        isPrimary,
        sortOrder: existingImages,
        altText,
      });
    } catch (err: any) {
      if (err?.code === 'P2002' && isPrimary) {
        isPrimary = false;
        try {
          image = await this.imageRepo.createProductImage({
            productId,
            url: uploadResult.secureUrl,
            publicId: uploadResult.publicId,
            isPrimary,
            sortOrder: existingImages,
            altText,
          });
        } catch (retryErr: any) {
          await this.cleanupmedia(uploadResult.publicId);
          throw retryErr;
        }
      } else {
        await this.cleanupmedia(uploadResult.publicId);
        throw err;
      }
    }

    await this.reApprovalService.triggerIfNeeded(productId, sellerId);
    this.logger.log(`Image uploaded for product ${productId}: ${image.id}`);
    return { success: true, message: 'Image uploaded successfully', data: image };
  }

  /**
   * Phase 42 (2026-05-21) — best-effort media cleanup on
   * post-upload failure. Mirrors the admin product path's helper.
   */
  private async cleanupmedia(publicId: string | null | undefined): Promise<void> {
    if (!publicId) return;
    try {
      await this.media.delete(publicId);
    } catch (err: any) {
      this.logger.error(
        `media cleanup failed for orphaned asset ${publicId}: ${err?.message}`,
      );
    }
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  async deleteImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const image = await this.imageRepo.findProductImage(imageId, productId);

    if (!image) {
      throw new NotFoundAppException('Image not found');
    }

    // Delete from DB
    await this.imageRepo.deleteProductImage(imageId);

    // If was primary, set next image as primary
    if (image.isPrimary) {
      const nextImage = await this.imageRepo.findFirstByProduct(productId);

      if (nextImage) {
        await this.imageRepo.setImagePrimary(nextImage.id);
      }
    }

    // Delete from media (best-effort)
    if (image.publicId) {
      this.media.delete(image.publicId).catch((err) => {
        this.logger.warn(
          `Failed to delete media asset ${image.publicId}: ${err?.message}`,
        );
      });
    }

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(
      `Image deleted from product ${productId}: ${imageId}`,
    );

    return {
      success: true,
      message: 'Image deleted successfully',
      data: null,
    };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  async reorderImages(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: ReorderImagesDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Phase 42 (2026-05-21) — Gap #9 fix. Re-approval is fired only
    // AFTER the reorder succeeds. Pre-Phase-42 the trigger ran first,
    // so a reorder that failed (e.g. cross-product id mismatch) still
    // flipped the product back to SUBMITTED — undoing nothing.
    const images = await this.imageRepo.reorderProductImages(productId, dto.imageIds);
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    return {
      success: true,
      message: 'Images reordered successfully',
      data: images,
    };
  }

  /**
   * Phase 42 (2026-05-21) — Gap #1 fix. Explicit "set primary" so the
   * UI's Primary badge can be reassigned without delete+reupload.
   *
   * The repo demotes the previous primary and promotes the target in
   * one transaction (partial-unique-safe). Scope is validated by:
   *   1. ownershipService — seller owns the URL's productId
   *   2. findProductImage(imageId, productId) — id belongs to the product
   *
   * Re-approval triggers after the flip so a fresh hero image goes
   * back through moderation.
   */
  @Patch(':imageId/primary')
  @HttpCode(HttpStatus.OK)
  async setPrimary(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const image = await this.imageRepo.findProductImage(imageId, productId);
    if (!image) throw new NotFoundAppException('Image not found');

    await this.imageRepo.setImagePrimary(imageId);
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    return { success: true, message: 'Primary image updated', data: { id: imageId } };
  }
}
