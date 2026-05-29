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
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import { ReorderImagesDto } from '../../dtos/reorder-images.dto';
import { PRODUCT_IMAGE_REPOSITORY, IProductImageRepository } from '../../../domain/repositories/product-image.repository.interface';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MULTER_OPTIONS,
  MAX_IMAGE_BYTES,
  sanitizeAltText,
} from '../_helpers/image-upload';

@ApiTags('Seller Products')
@Controller('seller/products/:productId/variants/:variantId/images')
@UseGuards(SellerAuthGuard)
export class SellerVariantImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {
    this.logger.setContext('SellerVariantImagesController');
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
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const variant = await this.imageRepo.findVariant(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');

    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    }
    if (file.size > MAX_IMAGE_BYTES) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');

    let uploadResult;
    try {
      uploadResult = await this.cloudinary.upload(file.buffer, {
        folder: `products/${productId}/variants/${variantId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(
        `Cloudinary upload failed for variant ${variantId}: ${error?.message}`,
      );
      throw new AppException('Image upload failed. Please try again.', 'EXTERNAL_SERVICE_ERROR');
    }

    const altText = sanitizeAltText(altTextRaw);

    // Find sibling variants that share the same color value
    const siblingVariantIds = await this.imageRepo.findColorSiblingVariantIds(productId, variantId);

    // Create image records for all sibling variants (color-grouped).
    //
    // Phase 41 (2026-05-21) — Gap #7 wiring. First image per variant
    // becomes the hero (isPrimary=true).
    //
    // Phase 42 (2026-05-21) — Gap #7 (this audit): cleanup the
    // Cloudinary asset if any DB write fails mid fan-out.
    const createdImages = [];
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
      this.cloudinary.delete(uploadResult.publicId).catch((e) =>
        this.logger.error(`Cloudinary cleanup failed for orphaned ${uploadResult.publicId}: ${(e as Error).message}`),
      );
      throw err;
    }

    // Phase 32 (2026-05-21) — variant image ADD is carved out of
    // re-approval. A seller adding a 6th angle photo to an already-
    // APPROVED product doesn't materially change what was reviewed:
    // the hero image (sortOrder=0) is unchanged, the gallery just
    // grew. Pre-Phase-32 every add bounced the product back to
    // SUBMITTED+PENDING, creating moderation-queue churn for a
    // change that doesn't need re-review.
    //
    // Variant image DELETE and REORDER still trigger re-approval —
    // either can change the de-facto hero image (sortOrder=0), and
    // moderators need to see the new front-and-centre shot.

    this.logger.log(
      `Image uploaded for variant ${variantId} (shared with ${siblingVariantIds.length} variants) of product ${productId}; re-approval skipped (Phase 32 carve-out)`,
    );

    return {
      success: true,
      message: siblingVariantIds.length > 1
        ? `Variant image uploaded and shared across ${siblingVariantIds.length} color variants`
        : 'Variant image uploaded successfully',
      data: createdImages[0],
    };
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  async deleteVariantImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const image = await this.imageRepo.findVariantImage(imageId, variantId);

    if (!image) {
      throw new NotFoundAppException('Variant image not found');
    }

    // Find and delete matching images from all color-sibling variants
    const siblingVariantIds = await this.imageRepo.findColorSiblingVariantIds(productId, variantId);

    if (image.publicId) {
      // Delete all variant image records sharing the same publicId (same Cloudinary asset)
      await this.imageRepo.deleteVariantImagesByPublicId(siblingVariantIds, image.publicId);
    } else {
      // Fallback: delete only this specific image
      await this.imageRepo.deleteVariantImage(imageId);
    }

    // Phase 41 (2026-05-21) — Gap #7. If the deleted image was the
    // primary hero, promote the next-lowest sort_order survivor on
    // each sibling so the variant always has a hero. Mirrors the
    // ProductImage delete pattern.
    for (const vId of siblingVariantIds) {
      await this.imageRepo.ensureVariantHasPrimary(vId);
    }

    // Delete from Cloudinary (best-effort)
    if (image.publicId) {
      this.cloudinary.delete(image.publicId).catch((err) => {
        this.logger.warn(
          `Failed to delete Cloudinary asset ${image.publicId}: ${err?.message}`,
        );
      });
    }

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(
      `Image deleted from variant ${variantId} (and color siblings) of product ${productId}: ${imageId}`,
    );

    return {
      success: true,
      message: 'Variant image deleted successfully',
      data: null,
    };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  // Phase 42 (2026-05-21) — Gap #8 fix. Inline @Body type replaced
  // with the existing ReorderImagesDto so class-validator enforces
  // shape + array size + UUID-per-element.
  async reorderVariantImages(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: ReorderImagesDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    await this.imageRepo.reorderVariantImages(variantId, dto.imageIds);
    return { success: true, message: 'Variant images reordered successfully', data: null };
  }

  /**
   * Phase 42 (2026-05-21) — Gap #1 + #5 follow-through. Variant
   * set-primary endpoint. The schema has the column + partial unique
   * since Phase 41; the repo's setVariantImagePrimary demotes +
   * promotes atomically. We just needed the HTTP surface.
   */
  @Patch(':imageId/primary')
  @HttpCode(HttpStatus.OK)
  async setVariantImagePrimary(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const image = await this.imageRepo.findVariantImage(imageId, variantId);
    if (!image) throw new NotFoundAppException('Variant image not found');

    await this.imageRepo.setVariantImagePrimary(imageId);
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);
    return { success: true, message: 'Variant primary image updated', data: { id: imageId } };
  }
}
