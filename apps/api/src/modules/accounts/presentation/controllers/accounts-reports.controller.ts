import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { AccountsReportsService } from '../../application/services/accounts-reports.service';
import { AccountsSettlementService } from '../../application/services/accounts-settlement.service';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';

@ApiTags('Admin Accounts - Reports')
@Controller('admin/accounts/reports')
@UseGuards(AdminAuthGuard)
export class AccountsReportsController {
  constructor(
    private readonly reportsService: AccountsReportsService,
    private readonly settlementService: AccountsSettlementService,
  ) {}

  /* ── GET /admin/accounts/reports/revenue ── */
  @Get('revenue')
  async getRevenueBreakdown(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy?: string,
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestException(
        'fromDate and toDate are required',
      );
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const validGroupBy = ['day', 'week', 'month'];
    const parsedGroupBy =
      groupBy && validGroupBy.includes(groupBy)
        ? (groupBy as 'day' | 'week' | 'month')
        : 'day';

    const data = await this.reportsService.getRevenueBreakdown(
      from,
      to,
      parsedGroupBy,
    );

    return {
      success: true,
      message: 'Revenue breakdown retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/reports/margins ── */
  @Get('margins')
  async getMargins(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestException(
        'fromDate and toDate are required',
      );
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const data = await this.reportsService.getPlatformMarginReport(
      from,
      to,
    );

    return {
      success: true,
      message: 'Platform margin report retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/reports/payouts ── */
  @Get('payouts')
  async getPayouts(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestException(
        'fromDate and toDate are required',
      );
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const data = await this.reportsService.getPayoutReport(from, to);

    return {
      success: true,
      message: 'Payout report retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/reports/payouts/export ── */
  @Get('payouts/export')
  async exportPayoutRegister(
    @Res() res: Response,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestException('fromDate and toDate are required');
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const { sellerPayouts, franchisePayouts } =
      await this.settlementService.exportPayoutRegister(from, to);

    const headers = [
      'paidAt',
      'partnerType',
      'partnerId',
      'partnerCode',
      'partnerName',
      'settlementId',
      'cycleId',
      'netPayable',
      'reference',
    ];

    const rows = [
      ...sellerPayouts.map((s) => ({
        paidAt: s.paidAt,
        partnerType: 'SELLER',
        partnerId: s.sellerId,
        partnerCode: '',
        partnerName: s.sellerName,
        settlementId: s.id,
        cycleId: s.cycleId,
        netPayable: Number(s.totalSettlementAmount),
        reference: s.utrReference ?? '',
      })),
      ...franchisePayouts.map((f: any) => ({
        paidAt: f.paidAt,
        partnerType: 'FRANCHISE',
        partnerId: f.franchiseId,
        partnerCode: f.franchise?.franchiseCode ?? '',
        partnerName: f.franchiseName,
        settlementId: f.id,
        cycleId: f.cycleId,
        netPayable: Number(f.netPayableToFranchise),
        reference: f.paymentReference ?? '',
      })),
    ].sort((a, b) => {
      const ta = a.paidAt ? new Date(a.paidAt as any).getTime() : 0;
      const tb = b.paidAt ? new Date(b.paidAt as any).getTime() : 0;
      return ta - tb;
    });

    const csv = toCsv(rows, headers);
    const filename = `${csvFilenameSlug([
      'payout_register',
      fromDate,
      toDate,
    ])}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(csv);
  }

  /* ── GET /admin/accounts/reports/reconciliation ── */
  @Get('reconciliation')
  async getReconciliation() {
    const data = await this.reportsService.getReconciliationReport();

    return {
      success: true,
      message: 'Reconciliation report generated',
      data,
    };
  }
}
