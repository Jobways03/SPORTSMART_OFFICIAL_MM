import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import { CommissionProcessorService } from '../../application/services/commission-processor.service';

@ApiTags('Seller Commission')
@Controller('seller/commission')
@UseGuards(SellerAuthGuard)
export class SellerCommissionController {
  constructor(private readonly commissionService: CommissionProcessorService) {}

  @Get()
  async listCommissions(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { records, total } = await this.commissionService.getSellerCommissionRecords(
      req.sellerId,
      { search, dateFrom, dateTo, status },
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Commission records retrieved',
      data: {
        records,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }
}
