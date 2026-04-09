import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { CommissionProcessorService } from '../../application/services/commission-processor.service';

@ApiTags('Admin Commission')
@Controller('admin/commission')
@UseGuards(AdminAuthGuard)
export class AdminCommissionController {
  constructor(private readonly commissionService: CommissionProcessorService) {}

  /* ── Global Commission Settings ── */

  @Get('settings')
  async getSettings() {
    const settings = await this.commissionService.getCommissionSettings();
    return { success: true, message: 'Commission settings retrieved', data: settings };
  }

  @Put('settings')
  async updateSettings(
    @Body()
    body: {
      commissionType: string;
      commissionValue: number;
      secondCommissionValue?: number;
      fixedCommissionType?: string;
      enableMaxCommission?: boolean;
      maxCommissionAmount?: number;
    },
  ) {
    const settings = await this.commissionService.updateCommissionSettings(body);
    return { success: true, message: 'Commission settings updated', data: settings };
  }

  /* ── Commission Records List ── */

  @Get()
  async listCommissions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('commissionType') commissionType?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { records, total } = await this.commissionService.getCommissionRecords(
      { sellerId, search, dateFrom, dateTo, commissionType, status },
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

  /* ── Summary (aggregate margin data) ── */

  @Get('summary')
  async getSummary() {
    const summary = await this.commissionService.getAdminCommissionSummary();
    return {
      success: true,
      message: 'Commission summary retrieved',
      data: summary,
    };
  }
}
