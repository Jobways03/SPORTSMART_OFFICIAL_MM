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
import { AdminAuthGuard } from '../../../../../core/guards';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import { PRODUCT_IMAGE_REPOSITORY, IProductImageRepository } from '../../../domain/repositories/product-image.repository.interface';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MULTER_OPTIONS = { limits: { fileSize: MAX_FILE_SIZE } };

@ApiTags('Admin Products')
@Controller('admin/products/:productId/variants/:variantId/images')
@UseGuards(AdminAuthGuard)
export class AdminVariantImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {
    this.logger.setContext('AdminVariantImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadVariantImage(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string, @UploadedFile() file: Express.Multer.File) {
    const adminId = (req as any).adminId;
    const variant = await this.imageRepo.findVariant(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');
    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    if (file.size > MAX_FILE_SIZE) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');

    let uploadResult;
    try {
      uploadResult = await this.cloudinary.upload(file.buffer, { folder: `products/${productId}/variants/${variantId}`, transformation: [{ width: 1200, height: 1200, crop: 'limit' }] });
    } catch (error: any) {
      this.logger.error(`Cloudinary upload failed for variant ${variantId}: ${error?.message}`);
      throw new AppException('Image upload failed. Please try again.', 'EXTERNAL_SERVICE_ERROR');
    }

    const siblingVariantIds = await this.imageRepo.findColorSiblingVariantIds(productId, variantId);
    const createdImages = [];
    for (const vId of siblingVariantIds) {
      const existingCount = await this.imageRepo.countByVariant(vId);
      const image = await this.imageRepo.createVariantImage({ variantId: vId, url: uploadResult.secureUrl, publicId: uploadResult.publicId, sortOrder: existingCount });
      createdImages.push(image);
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

    if (image.publicId) {
      this.cloudinary.delete(image.publicId).catch((err) => this.logger.warn(`Failed to delete Cloudinary asset ${image.publicId}: ${err?.message}`));
    }

    this.logger.log(`Image deleted from variant ${variantId} (and color siblings) of product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Variant image deleted successfully', data: null };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  async reorderVariantImages(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string, @Body() body: { imageIds: string[] }) {
    if (!body.imageIds || !Array.isArray(body.imageIds) || body.imageIds.length === 0) {
      throw new AppException('imageIds array is required', 'BAD_REQUEST');
    }
    await this.imageRepo.reorderVariantImages(variantId, body.imageIds);
    return { success: true, message: 'Variant images reordered successfully', data: null };
  }
}
