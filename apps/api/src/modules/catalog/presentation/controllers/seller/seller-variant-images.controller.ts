import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
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

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const MULTER_OPTIONS = {
  limits: { fileSize: MAX_FILE_SIZE },
};

@ApiTags('Seller Products')
@Controller('seller/products/:productId/variants/:variantId/images')
@UseGuards(SellerAuthGuard)
export class SellerVariantImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {
    this.logger.setContext('SellerVariantImagesController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadVariantImage(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Validate the variant belongs to this product
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });

    if (!variant) {
      throw new NotFoundAppException('Variant not found');
    }

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
        folder: `products/${productId}/variants/${variantId}`,
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      });
    } catch (error: any) {
      this.logger.error(
        `Cloudinary upload failed for variant ${variantId}: ${error?.message}`,
      );
      throw new AppException(
        'Image upload failed. Please try again.',
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    // Count existing variant images to set sortOrder
    const existingImages = await this.prisma.productVariantImage.count({
      where: { variantId },
    });

    const sortOrder = existingImages;

    const image = await this.prisma.productVariantImage.create({
      data: {
        variantId,
        url: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
        sortOrder,
      },
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(
      `Image uploaded for variant ${variantId} of product ${productId}: ${image.id}`,
    );

    return {
      success: true,
      message: 'Variant image uploaded successfully',
      data: image,
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

    const image = await this.prisma.productVariantImage.findFirst({
      where: { id: imageId, variantId },
    });

    if (!image) {
      throw new NotFoundAppException('Variant image not found');
    }

    // Delete from DB
    await this.prisma.productVariantImage.delete({
      where: { id: imageId },
    });

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
      `Image deleted from variant ${variantId} of product ${productId}: ${imageId}`,
    );

    return {
      success: true,
      message: 'Variant image deleted successfully',
      data: null,
    };
  }
}
