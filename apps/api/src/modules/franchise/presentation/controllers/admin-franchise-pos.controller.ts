import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchisePosService } from '../../application/services/franchise-pos.service';
import { PosReportQueryDto } from '../dtos/pos-report-query.dto';

@ApiTags('Admin Franchise POS')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('franchise.read')
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
  // Phase 159s (audit #3) — a franchise's daily revenue is competitive data;
  // require a dedicated read permission, not the class-level franchise.read.
  @Permissions('franchise.pos.report.read')
  async viewFranchisePosReport(
    @Param('franchiseId') franchiseId: string,
    @Query() query: PosReportQueryDto,
  ) {
    const dateStr = query.date ?? this.posService.todayInReportTz();
    const data = await this.posService.getDailyReport(franchiseId, dateStr);

    return {
      success: true,
      message: 'Franchise POS daily report fetched successfully',
      data,
    };
  }

  // Phase 159s (audit #7) — admin CSV export of a franchise's daily POS report.
  @Get(':franchiseId/pos-report.csv')
  @Permissions('franchise.pos.report.read')
  async exportFranchisePosReportCsv(
    @Param('franchiseId') franchiseId: string,
    @Query() query: PosReportQueryDto,
    @Res() res: Response,
  ) {
    const dateStr = query.date ?? this.posService.todayInReportTz();
    const csv = await this.posService.getDailyReportCsv(franchiseId, dateStr);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pos-report-${franchiseId}-${dateStr}.csv"`,
    );
    res.send(csv);
  }
}
