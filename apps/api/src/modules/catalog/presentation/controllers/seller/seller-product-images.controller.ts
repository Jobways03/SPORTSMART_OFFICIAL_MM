import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
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
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import { ReorderImagesDto } from '../../dtos/reorder-images.dto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const MULTER_OPTIONS = {
  limits: { fileSize: MAX_FILE_SIZE },
};

@ApiTags('Seller Products')
@Controller('seller/products/:productId/images')
@UseGuards(SellerAuthGuard)
export class SellerProductImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {
    this.logger.setContext('SellerProductImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Validate file
    if (!file || !file.buffer) {
      throw new AppException('No image file provided', 'BAD_REQUEST');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new AppException(
        'Only JPG, PNG, and WEBP images are allowed',
        'BAD_REQUEST',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new AppException('Image must not exceed 5MB', 'BAD_REQUEST');
    }

    // Upload to Cloudinary
    let uploadResult;
    try {
      uploadResult = await this.cloudinary.upload(file.buffer, {
        folder: `products/${productId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(
        `Cloudinary upload failed for product ${productId}: ${error?.message}`,
      );
      throw new AppException(
        'Image upload failed. Please try again.',
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    // Check if this is the first image (set as primary)
    const existingImages = await this.prisma.productImage.count({
      where: { productId },
    });

    const isPrimary = existingImages === 0;
    const sortOrder = existingImages;

    const image = await this.prisma.productImage.create({
      data: {
        productId,
        url: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
        isPrimary,
        sortOrder,
      },
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(
      `Image uploaded for product ${productId}: ${image.id}`,
    );

    return {
      success: true,
      message: 'Image uploaded successfully',
      data: image,
    };
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

    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });

    if (!image) {
      throw new NotFoundAppException('Image not found');
    }

    // Delete from DB
    await this.prisma.productImage.delete({
      where: { id: imageId },
    });

    // If was primary, set next image as primary
    if (image.isPrimary) {
      const nextImage = await this.prisma.productImage.findFirst({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      });

      if (nextImage) {
        await this.prisma.productImage.update({
          where: { id: nextImage.id },
          data: { isPrimary: true },
        });
      }
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

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dto.imageIds.length; i++) {
        await tx.productImage.update({
          where: { id: dto.imageIds[i] },
          data: { sortOrder: i },
        });
      }
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    const images = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      success: true,
      message: 'Images reordered successfully',
      data: images,
    };
  }
}
