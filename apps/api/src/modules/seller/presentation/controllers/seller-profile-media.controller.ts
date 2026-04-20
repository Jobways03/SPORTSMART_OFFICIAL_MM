import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { UploadSellerMediaUseCase } from '../../application/use-cases/upload-seller-media.use-case';
import { DeleteSellerMediaUseCase } from '../../application/use-cases/delete-seller-media.use-case';

const MULTER_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Seller Profile')
@Controller('seller/profile/media')
@UseGuards(SellerAuthGuard)
export class SellerProfileMediaController {
  constructor(
    private readonly uploadSellerMediaUseCase: UploadSellerMediaUseCase,
    private readonly deleteSellerMediaUseCase: DeleteSellerMediaUseCase,
  ) {}

  @Patch('profile-image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('profileImage', MULTER_OPTIONS))
  async uploadProfileImage(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const sellerId = (req as any).sellerId;
    const data = await this.uploadSellerMediaUseCase.execute(
      sellerId,
      file,
      'profile-image',
    );

    return {
      success: true,
      message: 'Profile image uploaded successfully',
      data,
    };
  }

  @Delete('profile-image')
  @HttpCode(HttpStatus.OK)
  async deleteProfileImage(@Req() req: Request) {
    const sellerId = (req as any).sellerId;
    const data = await this.deleteSellerMediaUseCase.execute(
      sellerId,
      'profile-image',
    );

    return {
      success: true,
      message: 'Profile image removed successfully',
      data,
    };
  }

  @Patch('shop-logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('shopLogo', MULTER_OPTIONS))
  async uploadShopLogo(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const sellerId = (req as any).sellerId;
    const data = await this.uploadSellerMediaUseCase.execute(
      sellerId,
      file,
      'shop-logo',
    );

    return {
      success: true,
      message: 'Shop logo uploaded successfully',
      data,
    };
  }

  @Delete('shop-logo')
  @HttpCode(HttpStatus.OK)
  async deleteShopLogo(@Req() req: Request) {
    const sellerId = (req as any).sellerId;
    const data = await this.deleteSellerMediaUseCase.execute(
      sellerId,
      'shop-logo',
    );

    return {
      success: true,
      message: 'Shop logo removed successfully',
      data,
    };
  }
}
