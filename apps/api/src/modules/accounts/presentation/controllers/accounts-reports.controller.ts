import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AccountsReportsService,
  MarginDateBasis,
  ReportNodeType,
} from '../../application/services/accounts-reports.service';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import { parseAccountsRange } from '../accounts-range.util';

/**
 * Phase 24 — class-level @Permissions('settlements.read'): every method is a
 * finance/payout/recon read (a finance-grade permission gate; #2 of the #180
 * audit is satisfied here, not missing).
 *
 * Phase 180 (Revenue/Margin/Payouts audit) hardening:
 *   #16 — @Throttle + 120s service cache + an audit-log row per read.
 *   #17 — dates go through parseAccountsRange (end-of-day inclusive `toDate`,
 *         366-day cap, Invalid-Date → 400) instead of a bare `new Date()`.
 *   #9  — revenue + margins now have CSV exports too (was payouts-only).
 *   #6  — payouts CSV/JSON are NET of TCS/TDS/commission-GST (the real wire).
 *   #18 — export filenames carry a timestamp to avoid browser collisions.
 *   CSV injection (#1) is already neutralised by the shared `toCsv`/escapeCsvField.
 */
@ApiTags('Admin Accounts - Reports')
@Controller('admin/accounts/reports')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('settlements.read')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AccountsReportsController {
  constructor(
    private readonly reportsService: AccountsReportsService,
    private readonly audit: AuditPublicFacade,
  ) {}

  private async logView(req: any, scope: string, meta: Record<string, unknown>) {
    await this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'accounts.report.viewed',
        module: 'accounts',
        resource: 'AccountsReport',
        resourceId: scope,
        metadata: { scope, ...meta, ip: req?.ip ?? null, userAgent: req?.headers?.['user-agent'] ?? null },
      })
      .catch(() => undefined);
  }

  // #15 — node-type / node-id filters (validated). AFFILIATE only valid for payouts.
  private parseNodeType(v: string | undefined, allowAffiliate = false): ReportNodeType | 'AFFILIATE' {
    if (!v) return 'ALL';
    const up = v.toUpperCase();
    if (up === 'SELLER') return 'SELLER';
    if (up === 'FRANCHISE') return 'FRANCHISE';
    if (up === 'ALL') return 'ALL';
    if (allowAffiliate && up === 'AFFILIATE') return 'AFFILIATE';
    throw new BadRequestException(`nodeType must be SELLER, FRANCHISE${allowAffiliate ? ', AFFILIATE' : ''} or ALL`);
  }
  private parseDateBasis(v?: string): MarginDateBasis {
    if (!v || v === 'created') return 'created';
    if (v === 'settled') return 'settled';
    throw new BadRequestException('dateBasis must be created or settled');
  }
  private range(fromDate?: string, toDate?: string) {
    if (!fromDate || !toDate) throw new BadRequestException('fromDate and toDate are required');
    const { from, to } = parseAccountsRange({ fromDate, toDate });
    if (!from || !to) throw new BadRequestException('Invalid date format');
    return { from, to };
  }
  private stamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  }

  /* ── GET /admin/accounts/reports/revenue ── */
  @Get('revenue')
  async getRevenueBreakdown(
    @Req() req: any,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const parsedGroupBy = (['day', 'week', 'month'] as const).includes(groupBy as any)
      ? (groupBy as 'day' | 'week' | 'month')
      : 'day';
    const data = await this.reportsService.getRevenueBreakdown(from, to, parsedGroupBy);
    await this.logView(req, 'revenue', { fromDate, toDate, groupBy: parsedGroupBy });
    return { success: true, message: 'Revenue breakdown retrieved', data };
  }

  /* ── #9 GET /admin/accounts/reports/revenue/export.csv ── */
  @Get('revenue/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportRevenueCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const parsedGroupBy = (['day', 'week', 'month'] as const).includes(groupBy as any)
      ? (groupBy as 'day' | 'week' | 'month')
      : 'day';
    const data = await this.reportsService.getRevenueBreakdown(from, to, parsedGroupBy);
    await this.logView(req, 'revenue-export', { fromDate, toDate, groupBy: parsedGroupBy });
    const headers = ['period', 'totalRevenue', 'refunds', 'netRevenue', 'sellerFulfilledAmount', 'franchiseFulfilledAmount', 'platformCommissionMargin'];
    const csv = toCsv(data as any, headers, { bom: true });
    this.sendCsv(res, csvFilenameSlug(['revenue', parsedGroupBy, fromDate, toDate, this.stamp()]), csv);
  }

  /* ── GET /admin/accounts/reports/margins ── */
  @Get('margins')
  async getMargins(
    @Req() req: any,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('dateBasis') dateBasis?: string,
    @Query('nodeType') nodeType?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const data = await this.reportsService.getPlatformMarginReport(from, to, {
      dateBasis: this.parseDateBasis(dateBasis),
      nodeType: this.parseNodeType(nodeType) as ReportNodeType,
      nodeId: nodeId || undefined,
    });
    await this.logView(req, 'margins', { fromDate, toDate, dateBasis, nodeType, nodeId });
    return { success: true, message: 'Platform margin report retrieved', data };
  }

  /* ── #9 GET /admin/accounts/reports/margins/export.csv ── */
  @Get('margins/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportMarginsCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('dateBasis') dateBasis?: string,
    @Query('nodeType') nodeType?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const data = await this.reportsService.getPlatformMarginReport(from, to, {
      dateBasis: this.parseDateBasis(dateBasis),
      nodeType: this.parseNodeType(nodeType) as ReportNodeType,
      nodeId: nodeId || undefined,
    });
    await this.logView(req, 'margins-export', { fromDate, toDate, dateBasis, nodeType, nodeId });
    const headers = ['nodeType', 'nodeId', 'nodeName', 'totalRecords', 'totalRevenue', 'totalPayable', 'platformMargin', 'marginPercentage'];
    const csv = toCsv([...data.sellers, ...data.franchises] as any, headers, { bom: true });
    this.sendCsv(res, csvFilenameSlug(['margins', data.dateBasis, fromDate, toDate, this.stamp()]), csv);
  }

  /* ── GET /admin/accounts/reports/payouts ── */
  @Get('payouts')
  async getPayouts(
    @Req() req: any,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('nodeType') nodeType?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const data = await this.reportsService.getPayoutReport(from, to, {
      nodeType: this.parseNodeType(nodeType, true),
      nodeId: nodeId || undefined,
    });
    await this.logView(req, 'payouts', { fromDate, toDate, nodeType, nodeId });
    return { success: true, message: 'Payout report retrieved', data };
  }

  /* ── GET /admin/accounts/reports/payouts/export ── (net of deductions, +affiliate) */
  @Get('payouts/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportPayoutRegister(
    @Req() req: any,
    @Res() res: Response,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('nodeType') nodeType?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    const { from, to } = this.range(fromDate, toDate);
    const data = await this.reportsService.getPayoutReport(from, to, {
      nodeType: this.parseNodeType(nodeType, true),
      nodeId: nodeId || undefined,
    });
    await this.logView(req, 'payouts-export', { fromDate, toDate, nodeType, nodeId });

    const headers = [
      'paidAt', 'partnerType', 'partnerId', 'partnerName', 'status',
      'settlementId', 'cycleId', 'grossAmount', 'tcsDeducted', 'tdsDeducted',
      'commissionGst', 'netAmountPaid', 'platformMargin', 'reference',
    ];
    const rows = [...data.sellerPayouts, ...data.franchisePayouts, ...data.affiliatePayouts]
      .map((p: any) => ({
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : '',
        partnerType: p.nodeType,
        partnerId: p.nodeId,
        partnerName: p.nodeName,
        status: p.status,
        settlementId: p.settlementId,
        cycleId: p.cycleId ?? '',
        grossAmount: p.grossAmount,
        tcsDeducted: p.tcsDeducted,
        tdsDeducted: p.tdsDeducted,
        commissionGst: p.commissionGst,
        netAmountPaid: p.netAmountPaid,
        platformMargin: p.platformMargin,
        reference: p.paymentReference ?? '',
      }))
      .sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0));

    const csv = toCsv(rows, headers, { bom: true });
    this.sendCsv(res, csvFilenameSlug(['payout_register', fromDate, toDate, this.stamp()]), csv);
  }

  /* ── #8 GET /admin/accounts/reports/reconciliation (date-scoped) ── */
  @Get('reconciliation')
  async getReconciliation(
    @Req() req: any,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    let from: Date | undefined;
    let to: Date | undefined;
    if (fromDate || toDate) {
      const r = this.range(fromDate, toDate);
      from = r.from;
      to = r.to;
    }
    const data = await this.reportsService.getReconciliationReport(from, to);
    await this.logView(req, 'reconciliation', { fromDate: fromDate ?? null, toDate: toDate ?? null });
    return { success: true, message: 'Reconciliation report generated', data };
  }

  private sendCsv(res: Response, slug: string, csv: string) {
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.csv"`);
    res.send(csv);
  }
}
