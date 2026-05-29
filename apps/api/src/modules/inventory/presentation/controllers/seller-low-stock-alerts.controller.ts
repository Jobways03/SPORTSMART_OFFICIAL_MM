import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { LowStockAlertService } from '../../application/services/low-stock-alert.service';

/**
 * Phase 54 (2026-05-21) — seller-facing low-stock alerts (audit
 * Gap #16). Sellers couldn't see "which of my SKUs are low" without
 * the admin emailing them. This endpoint exposes only their own
 * alerts, scoped by the seller id pulled from the validated JWT.
 */
@ApiTags('Seller Inventory — Low-stock alerts')
@Controller('seller/catalog/low-stock-alerts')
@UseGuards(SellerAuthGuard)
export class SellerLowStockAlertsController {
  constructor(private readonly service: LowStockAlertService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: Request, @Query('limit') limit?: string) {
    const sellerId = (req as any).sellerId as string;
    const data = await this.service.listForSeller(sellerId, {
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { success: true, message: 'My low-stock alerts', data };
  }
}
