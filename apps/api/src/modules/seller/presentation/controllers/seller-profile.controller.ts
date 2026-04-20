import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { GetSellerProfileUseCase } from '../../application/use-cases/get-seller-profile.use-case';
import { UpdateSellerProfileUseCase } from '../../application/use-cases/update-seller-profile.use-case';
import { ChangeSellerPasswordUseCase } from '../../application/use-cases/change-seller-password.use-case';
import { UpdateSellerProfileDto } from '../dtos/update-seller-profile.dto';
import { SellerChangePasswordDto } from '../dtos/seller-change-password.dto';

@ApiTags('Seller Profile')
@Controller('seller/profile')
@UseGuards(SellerAuthGuard)
export class SellerProfileController {
  constructor(
    private readonly getSellerProfileUseCase: GetSellerProfileUseCase,
    private readonly updateSellerProfileUseCase: UpdateSellerProfileUseCase,
    private readonly changeSellerPasswordUseCase: ChangeSellerPasswordUseCase,
  ) {}

  @Get()
  async getProfile(@Req() req: Request) {
    const sellerId = (req as any).sellerId;
    const data = await this.getSellerProfileUseCase.execute(sellerId);

    return {
      success: true,
      message: 'Seller profile fetched successfully',
      data,
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Req() req: Request,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    const sellerId = (req as any).sellerId;
    const data = await this.updateSellerProfileUseCase.execute(sellerId, dto);

    return {
      success: true,
      message: 'Seller profile updated successfully',
      data,
    };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: Request,
    @Body() dto: SellerChangePasswordDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.changeSellerPasswordUseCase.execute({
      sellerId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      confirmPassword: dto.confirmPassword,
    });

    return {
      success: true,
      message: 'Password changed successfully. Please log in again.',
    };
  }
}
