import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  BlockedWhileImpersonating,
  BlockedWhileImpersonatingGuard,
  SellerAuthGuard,
} from '../../../../core/guards';
import { SubmitSellerOnboardingUseCase } from '../../application/use-cases/submit-seller-onboarding.use-case';
import { SubmitSellerOnboardingDto } from '../dtos/submit-seller-onboarding.dto';

@ApiTags('Seller Onboarding')
@Controller('seller/onboarding')
// Phase 28 (2026-05-21) — KYC submit requires the seller's true
// consent (PAN/GST/business details). Hard-blocked while admin is
// impersonating; the chain adds BlockedWhileImpersonatingGuard.
@UseGuards(SellerAuthGuard, BlockedWhileImpersonatingGuard)
export class SubmitSellerOnboardingController {
  constructor(
    private readonly submitOnboardingUseCase: SubmitSellerOnboardingUseCase,
  ) {}

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  // Phase 19 (2026-05-20) — 3/min/IP throttle. A determined seller who
  // hits "Submit" repeatedly (form spinner panic) or a rejected
  // seller who keeps resubmitting after rejection won't overrun the
  // admin queue with redundant rows.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @BlockedWhileImpersonating()
  async submit(
    @Req() req: Request,
    @Body() dto: SubmitSellerOnboardingDto,
    @Ip() ip: string,
  ) {
    const sellerId = (req as unknown as { sellerId?: string }).sellerId;
    if (!sellerId) {
      // SellerAuthGuard should have rejected this; defensive only.
      throw new Error('Seller session not found on request');
    }

    const userAgentHeader = req.headers['user-agent'];
    const userAgent =
      typeof userAgentHeader === 'string' ? userAgentHeader : undefined;
    const ipAddress = ip || req.socket.remoteAddress || undefined;

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
      ipAddress,
      userAgent,
    });

    return {
      success: true,
      message:
        'Onboarding details submitted for review. Our team will respond within 2-3 business days.',
      data,
    };
  }
}
