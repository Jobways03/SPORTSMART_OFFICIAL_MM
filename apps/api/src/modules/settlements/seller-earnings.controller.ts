import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../seller/infrastructure/guards/seller-auth.guard';
import { SettlementService } from './settlement.service';

@ApiTags('Seller Earnings')
@Controller('seller/earnings')
@UseGuards(SellerAuthGuard)
export class SellerEarningsController {
  constructor(private readonly settlementService: SettlementService) {}

  /* ── GET /seller/earnings/summary ── */
  @Get('summary')
  async getSummary(@Req() req: any) {
    const data = await this.settlementService.getSellerEarningsSummary(req.sellerId);

    return {
      success: true,
      message: 'Earnings summary retrieved',
      data,
    };
  }

  /* ── GET /seller/earnings/records ── */
  @Get('records')
  async getRecords(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.settlementService.getSellerCommissionRecords(
      req.sellerId,
      pageNum,
      limitNum,
      search,
      status,
    );

    return {
      success: true,
      message: 'Commission records retrieved',
      data,
    };
  }

  /* ── GET /seller/earnings/settlements ── */
  @Get('settlements')
  async getSettlements(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.settlementService.getSellerSettlementHistory(
      req.sellerId,
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Settlement history retrieved',
      data,
    };
  }
}
