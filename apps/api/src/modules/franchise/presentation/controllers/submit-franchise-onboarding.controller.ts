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
import { FranchiseAuthGuard } from '../../../../core/guards';
import { SubmitFranchiseOnboardingUseCase } from '../../application/use-cases/submit-franchise-onboarding.use-case';
import { SubmitFranchiseOnboardingDto } from '../dtos/submit-franchise-onboarding.dto';

@ApiTags('Franchise Onboarding')
@Controller('franchise/onboarding')
@UseGuards(FranchiseAuthGuard)
export class SubmitFranchiseOnboardingController {
  constructor(
    private readonly submitOnboardingUseCase: SubmitFranchiseOnboardingUseCase,
  ) {}

  @Post('submit')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async submit(
    @Req() req: Request & { franchiseId?: string },
    @Body() dto: SubmitFranchiseOnboardingDto,
    @Ip() ip: string,
  ) {
    const franchiseId = req.franchiseId;
    if (!franchiseId) {
      throw new Error('Franchise session not found on request');
    }
    const userAgentHeader = req.headers['user-agent'];
    const data = await this.submitOnboardingUseCase.execute({
      franchiseId,
      legalBusinessName: dto.legalBusinessName,
      entityType: dto.entityType,
      gstRegistrationType: dto.gstRegistrationType,
      gstNumber: dto.gstNumber,
      gstStateCode: dto.gstStateCode,
      panNumber: dto.panNumber,
      businessAddress: dto.businessAddress,
      warehouseAddress: dto.warehouseAddress,
      confirmedAccurate: dto.confirmedAccurate,
      ipAddress: ip || req.socket.remoteAddress || undefined,
      userAgent:
        typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    });
    return {
      success: true,
      message:
        'Onboarding details submitted for review. Our team will respond within 2-3 business days.',
      data,
    };
  }
}
