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
import { FranchiseAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { FranchiseReversalService } from '../../application/services/franchise-reversal.service';
import { RequestFranchiseReversalDto } from '../dtos/request-franchise-reversal.dto';

/**
 * Franchise-facing B2B / off-platform reversal API — franchise mirror of the
 * seller controller. Submitting only *requests* a reversal; an admin must
 * approve it before any stock/commission/finance effect is applied.
 */
@ApiTags('Franchise Reversals')
@Controller('franchise/reversals')
@UseGuards(FranchiseAuthGuard)
export class FranchiseReversalsController {
  constructor(private readonly service: FranchiseReversalService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async request(
    @Req() req: any,
    @Body() body: RequestFranchiseReversalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.service.request({
      franchiseId: req.franchiseId,
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
      franchiseId: req.franchiseId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'Reversals retrieved', data };
  }

  @Get(':id')
  async getMine(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getForFranchise(id, req.franchiseId);
    return { success: true, message: 'Reversal retrieved', data };
  }

  @Patch(':id/cancel')
  @Idempotent()
  async cancel(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.cancel({
      reversalId: id,
      franchiseId: req.franchiseId,
    });
    return { success: true, message: 'Reversal cancelled', data };
  }
}
