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
import { ReorderImagesDto } from '../../dtos/reorder-images.dto';
import { PRODUCT_IMAGE_REPOSITORY, IProductImageRepository } from '../../../domain/repositories/product-image.repository.interface';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const MULTER_OPTIONS = {
  limits: { fileSize: MAX_FILE_SIZE },
};

@ApiTags('Admin Products')
@Controller('admin/products/:productId/images')
@UseGuards(AdminAuthGuard)
export class AdminProductImagesController {
  constructor(
    @Inject(PRODUCT_IMAGE_REPOSITORY) private readonly imageRepo: IProductImageRepository,
    private readonly logger: AppLoggerService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {
    this.logger.setContext('AdminProductImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const adminId = (req as any).adminId;
    if (!file || !file.buffer) throw new AppException('No image file provided', 'BAD_REQUEST');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) throw new AppException('Only JPG, PNG, and WEBP images are allowed', 'BAD_REQUEST');
    if (file.size > MAX_FILE_SIZE) throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');

    let uploadResult;
    try {
      uploadResult = await this.cloudinary.upload(file.buffer, {
        folder: `products/${productId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(`Cloudinary upload failed for product ${productId}: ${error?.message}`);
      throw new AppException('Image upload failed. Please try again.', 'EXTERNAL_SERVICE_ERROR');
    }

    const existingImages = await this.imageRepo.countByProduct(productId);
    const isPrimary = existingImages === 0;

    const image = await this.imageRepo.createProductImage({
      productId, url: uploadResult.secureUrl, publicId: uploadResult.publicId,
      isPrimary, sortOrder: existingImages,
    });

    this.logger.log(`Image uploaded for product ${productId} by admin ${adminId}: ${image.id}`);
    return { success: true, message: 'Image uploaded successfully', data: image };
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
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
      this.cloudinary.delete(image.publicId).catch((err) => {
        this.logger.warn(`Failed to delete Cloudinary asset ${image.publicId}: ${err?.message}`);
      });
    }

    this.logger.log(`Image deleted from product ${productId} by admin ${adminId}: ${imageId}`);
    return { success: true, message: 'Image deleted successfully', data: null };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  async reorderImages(@Req() req: Request, @Param('productId') productId: string, @Body() dto: ReorderImagesDto) {
    const adminId = (req as any).adminId;
    const images = await this.imageRepo.reorderProductImages(productId, dto.imageIds);
    this.logger.log(`Images reordered for product ${productId} by admin ${adminId}`);
    return { success: true, message: 'Images reordered successfully', data: images };
  }
}
