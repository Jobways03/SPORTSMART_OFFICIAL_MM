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
  SellerAuthGuard,
} from '../../../../core/guards';
import { SellerBankDetailsService } from '../../application/services/seller-bank-details.service';
import { UpdateSellerBankDetailsDto } from '../dtos/update-seller-bank-details.dto';

/**
 * Phase 19 (2026-05-20) — Seller bank-details endpoints.
 *
 * The first-listing wizard's "Update bank details" CTA referenced an
 * endpoint that did not exist. This controller fills that gap:
 *
 *   PATCH /seller/bank-details         — set / update
 *   GET   /seller/bank-details/status  — wizard-friendly check
 *
 * Both require an authenticated seller (SellerAuthGuard) and are
 * gated by the seller's own `req.sellerId` — body cannot inject the
 * sellerId.
 */
@ApiTags('Seller Bank Details')
@Controller('seller/bank-details')
// Phase 28 (2026-05-21) — bank-details edits redirect future payouts;
// hard-blocked while admin is impersonating.
@UseGuards(SellerAuthGuard, BlockedWhileImpersonatingGuard)
export class SellerBankDetailsController {
  constructor(
    private readonly bankDetailsService: SellerBankDetailsService,
  ) {}

  @Patch()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @BlockedWhileImpersonating()
  async update(
    @Req() req: Request & { sellerId?: string },
    @Body() dto: UpdateSellerBankDetailsDto,
  ) {
    if (!req.sellerId) throw new Error('Seller session not found on request');
    const data = await this.bankDetailsService.upsert({
      sellerId: req.sellerId,
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

  /**
   * Cheap "does this seller have bank details on file?" probe for
   * the first-listing wizard. Returns the masked view (last 4 +
   * IFSC) when present, or `{ hasBankDetails: false }`.
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async status(@Req() req: Request & { sellerId?: string }) {
    if (!req.sellerId) throw new Error('Seller session not found on request');
    const status = await this.bankDetailsService.getStatus(req.sellerId);
    return {
      success: true,
      data: status,
    };
  }
}
