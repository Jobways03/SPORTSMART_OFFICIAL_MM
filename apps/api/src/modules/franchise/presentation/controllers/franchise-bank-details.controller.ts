import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  BlockedWhileImpersonating,
  BlockedWhileImpersonatingGuard,
  FranchiseAuthGuard,
} from '../../../../core/guards';
import { FranchiseBankDetailsService } from '../../application/services/franchise-bank-details.service';
import { UpdateFranchiseBankDetailsDto } from '../dtos/update-franchise-bank-details.dto';

@ApiTags('Franchise Bank Details')
@Controller('franchise/bank-details')
// Phase 28 (2026-05-21) — bank-details edits redirect future payouts;
// hard-blocked while admin is impersonating.
@UseGuards(FranchiseAuthGuard, BlockedWhileImpersonatingGuard)
export class FranchiseBankDetailsController {
  constructor(
    private readonly bankDetailsService: FranchiseBankDetailsService,
  ) {}

  @Patch()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @BlockedWhileImpersonating()
  async update(
    @Req() req: Request & { franchiseId?: string },
    @Body() dto: UpdateFranchiseBankDetailsDto,
  ) {
    if (!req.franchiseId)
      throw new Error('Franchise session not found on request');
    const data = await this.bankDetailsService.upsert({
      franchisePartnerId: req.franchiseId,
      accountHolderName: dto.accountHolderName,
      accountNumber: dto.accountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
      upiVpa: dto.upiVpa,
    });
    return {
      success: true,
      message: 'Bank details saved',
      data,
    };
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async status(@Req() req: Request & { franchiseId?: string }) {
    if (!req.franchiseId)
      throw new Error('Franchise session not found on request');
    const status = await this.bankDetailsService.getStatus(req.franchiseId);
    return {
      success: true,
      data: status,
    };
  }
}
