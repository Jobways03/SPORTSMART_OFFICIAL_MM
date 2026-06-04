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
@Controller('admin/products/:productId/variants/:variantId/images')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('catalog.write')
export class AdminVariantImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly media: MediaStorageAdapter,
    private readonly fileService: FileService,
  ) {
    this.logger.setContext('AdminVariantImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async uploadVariantImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altTextRaw?: string,
  ) {
    const adminId = (req as any).adminId;
    const variant = await this.imageRepo.findVariant(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');
    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    }
    if (file.size > MAX_IMAGE_BYTES) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');

    let uploadResult;
    try {
      uploadResult = await this.media.upload(file.buffer, { folder: `products/${productId}/variants/${variantId}`, transformation: [{ width: 1200, height: 1200, crop: 'limit' }] });
    } catch (error: any) {
      this.logger.error(`media upload failed for variant ${variantId}: ${error?.message}`);
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

    const altText = sanitizeAltText(altTextRaw);
    const siblingVariantIds = await this.imageRepo.findColorSiblingVariantIds(productId, variantId);
    const createdImages = [];
    // Phase 41 (2026-05-21) — Gap #7. First image per variant gets
    // isPrimary=true; subsequent stay false (partial-unique enforced
    // at the DB layer).
    //
    // Phase 42 (2026-05-21) — Gap #7 (this audit): if any DB write
    // fails mid color-sibling fan-out the media asset is
    // orphaned. Wrap in try/catch + best-effort delete on throw.
    try {
      for (const vId of siblingVariantIds) {
        const existingCount = await this.imageRepo.countByVariant(vId);
        const image = await this.imageRepo.createVariantImage({
          variantId: vId,
          url: uploadResult.secureUrl,
          publicId: uploadResult.publicId,
          sortOrder: existingCount,
          isPrimary: existingCount === 0,
          altText,
        });
        createdImages.push(image);
      }
    } catch (err) {
      this.media.delete(uploadResult.publicId).catch((e) =>
        this.logger.error(`media cleanup failed for orphaned ${uploadResult.publicId}: ${(e as Error).message}`),
      );
      throw err;
    }

    this.logger.log(`Image uploaded for variant ${variantId} (shared with ${siblingVariantIds.length} variants) of product ${productId} by admin ${adminId}`);
    return {
      success: true,
      message: siblingVariantIds.length > 1 ? `Variant image uploaded and shared across ${siblingVariantIds.length} color variants` : 'Variant image uploaded successfully',
      data: createdImages[0],
    };
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  async deleteVariantImage(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string, @Param('imageId') imageId: string) {
    const adminId = (req as any).adminId;
    const image = await this.imageRepo.findVariantImage(imageId, variantId);
    if (!image) throw new NotFoundAppException('Variant image not found');

    const siblingVariantIds = await this.imageRepo.findColorSiblingVariantIds(productId, variantId);
    if (image.publicId) {
      await this.imageRepo.deleteVariantImagesByPublicId(siblingVariantIds, image.publicId);
    } else {
      await this.imageRepo.deleteVariantImage(imageId);
    }

    // Phase 41 (2026-05-21) — Gap #7. Promote next survivor per sibling.
    for (const vId of siblingVariantIds) {
      await this.imageRepo.ensureVariantHasPrimary(vId);
    }

    if (image.publicId) {
      this.media.delete(image.publicId).catch((err) => this.logger.warn(`Failed to delete media asset ${image.publicId}: ${err?.message}`));
    }

    this.logger.log(`Image deleted from variant ${variantId} (and color siblings) of product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Variant image deleted successfully', data: null };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  async reorderVariantImages(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: ReorderImagesDto,
  ) {
    await this.imageRepo.reorderVariantImages(variantId, dto.imageIds);
    return { success: true, message: 'Variant images reordered successfully', data: null };
  }

  /**
   * Phase 42 (2026-05-21) — admin variant set-primary endpoint.
   * Mirrors the seller controller; the partial unique on
   * product_variant_images (variant_id) WHERE is_primary = true keeps
   * the constraint at one row per variant.
   */
  @Patch(':imageId/primary')
  @HttpCode(HttpStatus.OK)
  async setVariantImagePrimary(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
  ) {
    const adminId = (req as any).adminId;
    const image = await this.imageRepo.findVariantImage(imageId, variantId);
    if (!image) throw new NotFoundAppException('Variant image not found');

    await this.imageRepo.setVariantImagePrimary(imageId);
    this.logger.log(`Primary variant image set on variant ${variantId} of product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Variant primary image updated', data: { id: imageId } };
  }
}
