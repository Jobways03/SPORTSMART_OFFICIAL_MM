import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SellerAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { SellerReversalService } from '../../application/services/seller-reversal.service';
import { RequestSellerReversalDto } from '../dtos/request-seller-reversal.dto';

/**
 * Seller-facing B2B / off-platform reversal API (Phase 108). Submitting only
 * *requests* a reversal — an admin must approve it before any stock/commission/
 * settlement effect is applied. Replaces the old self-serve
 * POST /seller/orders/:id/return (removed).
 */
@ApiTags('Seller Reversals')
@Controller('seller/reversals')
@UseGuards(SellerAuthGuard)
export class SellerReversalsController {
  constructor(private readonly service: SellerReversalService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async request(
    @Req() req: any,
    @Body() body: RequestSellerReversalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.service.request({
      sellerId: req.sellerId,
      subOrderId: body.subOrderId,
      reason: body.reason,
      items: body.items,
      idempotencyKey: idempotencyKey || undefined,
    });
    return { success: true, message: 'Reversal requested', data };
  }

  @Get()
  async listMine(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list({
      sellerId: req.sellerId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'Reversals retrieved', data };
  }

  @Get(':id')
  async getMine(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getForSeller(id, req.sellerId);
    return { success: true, message: 'Reversal retrieved', data };
  }

  @Patch(':id/cancel')
  @Idempotent()
  async cancel(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.cancel({ reversalId: id, sellerId: req.sellerId });
    return { success: true, message: 'Reversal cancelled', data };
  }
}
