import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { SubmitSellerOnboardingUseCase } from '../../application/use-cases/submit-seller-onboarding.use-case';
import { SubmitSellerOnboardingDto } from '../dtos/submit-seller-onboarding.dto';

@ApiTags('Seller Onboarding')
@Controller('seller/onboarding')
@UseGuards(SellerAuthGuard)
export class SubmitSellerOnboardingController {
  constructor(
    private readonly submitOnboardingUseCase: SubmitSellerOnboardingUseCase,
  ) {}

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  async submit(@Req() req: Request, @Body() dto: SubmitSellerOnboardingDto) {
    const sellerId = (req as unknown as { sellerId?: string }).sellerId;
    if (!sellerId) {
      // SellerAuthGuard should have rejected this; defensive only.
      throw new Error('Seller session not found on request');
    }

    const data = await this.submitOnboardingUseCase.execute({
      sellerId,
      legalBusinessName: dto.legalBusinessName,
      gstRegistrationType: dto.gstRegistrationType,
      gstin: dto.gstin,
      gstStateCode: dto.gstStateCode,
      panNumber: dto.panNumber,
      registeredBusinessAddress: dto.registeredBusinessAddress,
      storeAddress: dto.storeAddress,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      sellerZipCode: dto.sellerZipCode,
      locality: dto.locality,
      sellerContactCountryCode: dto.sellerContactCountryCode,
      sellerContactNumber: dto.sellerContactNumber,
      shortStoreDescription: dto.shortStoreDescription,
      detailedStoreDescription: dto.detailedStoreDescription,
      confirmedAccurate: dto.confirmedAccurate,
    });

    return {
      success: true,
      message:
        'Onboarding details submitted for review. Our team will respond within 2-3 business days.',
      data,
    };
  }
}
