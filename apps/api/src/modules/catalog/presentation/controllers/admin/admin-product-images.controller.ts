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
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
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

@ApiTags('Admin Products')
@Controller('admin/products/:productId/images')
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 29 (2026-05-21) — class-level `catalog.write` removed in favour
// of per-method granularity. Every method on this controller mutates,
// so all three handlers carry @Permissions('catalog.write') below.
export class AdminProductImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly media: MediaStorageAdapter,
    private readonly fileService: FileService,
  ) {
    this.logger.setContext('AdminProductImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async uploadImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altTextRaw?: string,
  ) {
    const adminId = (req as any).adminId;
    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    }
    if (file.size > MAX_IMAGE_BYTES) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');
    const altText = sanitizeAltText(altTextRaw);

    let uploadResult;
    try {
      uploadResult = await this.media.upload(file.buffer, {
        folder: `products/${productId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(`media upload failed for product ${productId}: ${error?.message}`);
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
        uploadedBy: adminId,
        uploadedByType: 'ADMIN',
        fileName: file.originalname,
        buffer: file.buffer,
      })
      .catch(() => undefined);

    // Phase 29 (2026-05-21) — DB write is wrapped so that a failure
    // (FK violation, unique-collision retry exhausted, schema drift)
    // doesn't leave the media asset orphaned forever. On any
    // throw we attempt a best-effort delete; a delete failure is
    // logged for a manual cleanup sweep but doesn't override the
    // original error returned to the caller.
    //
    // Phase 29 partial unique index `product_images_one_primary_idx`
    // enforces at-most-one primary at the DB layer. The read-then-
    // insert "first image becomes primary" still computes a hint
    // value, but on a concurrent first-upload race the second insert
    // hits P2002 — we retry that one with isPrimary=false instead of
    // surfacing a 500.
    const existingImages = await this.imageRepo.countByProduct(productId);
    let isPrimary = existingImages === 0;

    let image;
    try {
      image = await this.imageRepo.createProductImage({
        productId, url: uploadResult.secureUrl, publicId: uploadResult.publicId,
        isPrimary, sortOrder: existingImages, altText,
      });
    } catch (err: any) {
      // P2002 = Prisma unique-constraint violation. The only unique
      // we can trip on this insert is the partial primary index, so
      // retry once with isPrimary=false.
      if (err?.code === 'P2002' && isPrimary) {
        isPrimary = false;
        try {
          image = await this.imageRepo.createProductImage({
            productId, url: uploadResult.secureUrl, publicId: uploadResult.publicId,
            isPrimary, sortOrder: existingImages,
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

    this.logger.log(`Image uploaded for product ${productId} by admin ${adminId}: ${image.id}`);
    return { success: true, message: 'Image uploaded successfully', data: image };
  }

  private async cleanupmedia(publicId: string | null | undefined): Promise<void> {
    if (!publicId) return;
    try {
      await this.media.delete(publicId);
    } catch (err: any) {
      // Asset is orphaned — log loud so a manual sweep can pick it up.
      // We don't re-throw because the caller already has a more
      // useful error from the original DB-write failure.
      this.logger.error(
        `media cleanup failed for orphaned asset ${publicId}: ${err?.message}`,
      );
    }
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async deleteImage(@Req() req: Request, @Param('productId') productId: string, @Param('imageId') imageId: string) {
    const adminId = (req as any).adminId;
    const image = await this.imageRepo.findProductImage(imageId, productId);
    if (!image) throw new NotFoundAppException('Image not found');

    await this.imageRepo.deleteProductImage(imageId);

    if (image.isPrimary) {
      const nextImage = await this.imageRepo.findFirstByProduct(productId);
      if (nextImage) await this.imageRepo.setImagePrimary(nextImage.id);
    }

    if (image.publicId) {
      this.media.delete(image.publicId).catch((err) => {
        this.logger.warn(`Failed to delete media asset ${image.publicId}: ${err?.message}`);
      });
    }

    this.logger.log(`Image deleted from product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Image deleted successfully', data: null };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async reorderImages(@Req() req: Request, @Param('productId') productId: string, @Body() dto: ReorderImagesDto) {
    const adminId = (req as any).adminId;
    const images = await this.imageRepo.reorderProductImages(productId, dto.imageIds);
    this.logger.log(`Images reordered for product ${productId} by admin ${adminId}`);
    return { success: true, message: 'Images reordered successfully', data: images };
  }

  /**
   * Phase 42 (2026-05-21) — Gap #1 fix. Admin equivalent of the
   * seller set-primary endpoint. setImagePrimary demotes + promotes
   * atomically (Phase 42 repo).
   */
  @Patch(':imageId/primary')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async setPrimary(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    const adminId = (req as any).adminId;
    const image = await this.imageRepo.findProductImage(imageId, productId);
    if (!image) throw new NotFoundAppException('Image not found');

    await this.imageRepo.setImagePrimary(imageId);
    this.logger.log(`Primary image set on product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Primary image updated', data: { id: imageId } };
  }
}
