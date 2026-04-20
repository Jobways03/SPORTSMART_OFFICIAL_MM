import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { FranchisePosService } from '../../application/services/franchise-pos.service';

@ApiTags('Admin Franchise POS')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard)
export class AdminFranchisePosController {
  constructor(private readonly posService: FranchisePosService) {}

  @Get(':franchiseId/pos-sales')
  async viewFranchisePosSales(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('saleType') saleType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.posService.listSales(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      saleType,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      search,
    });

    return {
      success: true,
      message: 'Franchise POS sales fetched successfully',
      data,
    };
  }

  @Get(':franchiseId/pos-report')
  async viewFranchisePosReport(
    @Param('franchiseId') franchiseId: string,
    @Query('date') date?: string,
  ) {
    const reportDate = date ? new Date(date) : new Date();

    const data = await this.posService.getDailyReport(franchiseId, reportDate);

    return {
      success: true,
      message: 'Franchise POS daily report fetched successfully',
      data,
    };
  }
}
