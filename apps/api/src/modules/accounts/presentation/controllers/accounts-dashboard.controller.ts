import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { AccountsDashboardService } from '../../application/services/accounts-dashboard.service';
import type { RankMetric, RankNodeType } from '../../domain/repositories/accounts.repository.interface';
import { AccountsDateRangeDto } from '../dtos/accounts-date-range.dto';
import { CreateFranchiseAdjustmentDto } from '../dtos/franchise-adjustment.dto';
import { SettlementHoldDto, RecordSettlementPaymentDto } from '../dtos/settlement-hold.dto';
import { parseAccountsDate, parseAccountsRange } from '../accounts-range.util';

/**
 * Phase 175 (Accounts Overview Dashboard audit) — platform-wide finance reads.
 *   #2/#5 — dedicated CRITICAL-adjacent `accounts.read` gate (was reusing
 *           settlements.read; the slug now exists in the registry @ HIGH).
 *   #6/#17 — date params are validated (Invalid Date → 400) and a bare calendar
 *           `toDate` is treated as INCLUSIVE end-of-day; range capped at 366d.
 *   #11   — throttled (heavy ~11-aggregate endpoints).
 *   #13   — every read writes an `accounts.overview.viewed` audit row (actor +
 *           IP + UA + range) — bulk financial data access is now traceable.
 */
@ApiTags('Admin Accounts - Dashboard')
@Controller('admin/accounts/dashboard')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('accounts.read')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AccountsDashboardController {
  constructor(
    private readonly dashboardService: AccountsDashboardService,
    private readonly audit: AuditPublicFacade,
  ) {}

  private async logView(req: any, scope: string, range: Record<string, unknown>) {
    await this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'accounts.overview.viewed',
        module: 'accounts',
        resource: 'AccountsOverview',
        resourceId: scope,
        metadata: {
          scope,
          ...range,
          ip: req?.ip ?? null,
          userAgent: req?.headers?.['user-agent'] ?? null,
        },
      })
      .catch(() => undefined);
  }

  /* ── GET /admin/accounts/dashboard/overview ── */
  @Get('overview')
  async getOverview(@Req() req: any, @Query() query: AccountsDateRangeDto) {
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getPlatformOverview(from, to);
    await this.logView(req, 'platform', { fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
    return { success: true, message: 'Platform finance overview retrieved', data };
  }

  /* ── GET /admin/accounts/dashboard/sellers ── */
  @Get('sellers')
  async getSellerOverview(@Req() req: any, @Query() query: AccountsDateRangeDto) {
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getSellerOverview(from, to);
    await this.logView(req, 'sellers', { fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
    return { success: true, message: 'Seller financial overview retrieved', data };
  }

  /* ── GET /admin/accounts/dashboard/franchises ── */
  @Get('franchises')
  async getFranchiseOverview(@Req() req: any, @Query() query: AccountsDateRangeDto) {
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getFranchiseOverview(from, to);
    await this.logView(req, 'franchises', { fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
    return { success: true, message: 'Franchise financial overview retrieved', data };
  }

  /* ── GET /admin/accounts/dashboard/outstanding ── */
  @Get('outstanding')
  async getOutstanding(
    @Req() req: any,
    @Query('asOfDate') asOfDate?: string, // #18
  ) {
    const asOf = parseAccountsDate(asOfDate, 'to');
    const data = await this.dashboardService.getOutstandingPayables(asOf);
    await this.logView(req, 'outstanding', { asOfDate: asOfDate ?? null });
    return { success: true, message: 'Outstanding payables retrieved', data };
  }

  // Phase 179 (#1/#14) — validate the ranking metric / node-type. An explicitly
  // supplied bad value is rejected (400); absent → sensible default.
  private parseMetric(v?: string): RankMetric {
    if (v === undefined || v === '') return 'REVENUE';
    const up = v.toUpperCase();
    if (up === 'REVENUE') return 'REVENUE';
    if (up === 'MARGIN') return 'MARGIN';
    throw new BadRequestAppException('metric must be REVENUE or MARGIN');
  }
  private parseNodeType(v?: string): RankNodeType {
    if (v === undefined || v === '') return 'ALL';
    const up = v.toUpperCase();
    if (up === 'SELLER') return 'SELLER';
    if (up === 'FRANCHISE') return 'FRANCHISE';
    if (up === 'ALL') return 'ALL';
    throw new BadRequestAppException('nodeType must be SELLER, FRANCHISE or ALL');
  }

  /* ── GET /admin/accounts/dashboard/top-performers ── */
  @Get('top-performers')
  async getTopPerformers(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('page') page?: string, // #19
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('metric') metric?: string, // #1 — REVENUE | MARGIN
    @Query('nodeType') nodeType?: string, // #14 — SELLER | FRANCHISE | ALL
  ) {
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '10', 10) || 10));
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const { from, to } = parseAccountsRange({ fromDate, toDate });
    const m = this.parseMetric(metric);
    const nt = this.parseNodeType(nodeType);
    const data = await this.dashboardService.getTopPerformers(limitNum, from, to, pageNum, m, nt);
    await this.logView(req, 'top-performers', { fromDate: fromDate ?? null, toDate: toDate ?? null, page: pageNum, limit: limitNum, metric: m, nodeType: nt });
    return { success: true, message: 'Top performers retrieved', data };
  }

  /* ── #10 — GET /admin/accounts/dashboard/top-performers/export.csv ── */
  @Get('top-performers/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportTopPerformersCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('metric') metric?: string,
    @Query('nodeType') nodeType?: string,
  ) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const { from, to } = parseAccountsRange({ fromDate, toDate });
    const m = this.parseMetric(metric);
    const nt = this.parseNodeType(nodeType);
    const data = await this.dashboardService.getTopPerformers(limitNum, from, to, 1, m, nt);
    await this.logView(req, 'top-performers-export', { metric: m, nodeType: nt, limit: limitNum });
    res.setHeader('Content-Disposition', `attachment; filename="top-performers-${m.toLowerCase()}.csv"`);
    const rows: string[][] = [
      ['node_type', 'rank', 'node_id', 'node_name', 'total_revenue', 'platform_margin', 'margin_percentage', 'total_orders'],
    ];
    for (const s of data.topSellers) {
      rows.push(['SELLER', String(s.rank), s.sellerId, s.sellerName, s.totalRevenue, s.platformMargin, String(s.marginPercentage), String(s.totalOrders)]);
    }
    for (const f of data.topFranchises) {
      rows.push(['FRANCHISE', String(f.rank), f.franchiseId, f.franchiseName, f.totalRevenue, f.platformEarning, String(f.marginPercentage), String(f.totalOnlineOrders + f.totalProcurements)]);
    }
    const csv = rows.map((r) => r.map(escapeCsvField).join(',')).join('\n');
    res.send(csv);
  }

  /* ── Phase 176: per-seller drill-down ── */

  /**
   * #1/#13 — single seller's financial bundle. `sellerId` is UUID-validated;
   * a missing/deleted seller 404s in the service. Inherits the class-level
   * accounts.read gate + throttle; audited (#12).
   */
  @Get('sellers/:sellerId/overview')
  async getSellerAccounts(
    @Req() req: any,
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
    @Query() query: AccountsDateRangeDto,
  ) {
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getSellerAccountsOverview(sellerId, from, to);
    await this.logView(req, 'seller-overview', { sellerId, fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
    return { success: true, message: 'Seller accounts overview retrieved', data };
  }

  /* #11 — paginated commission-record drill-down for a seller. */
  @Get('sellers/:sellerId/commission-records')
  async getSellerCommission(
    @Req() req: any,
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getSellerCommissionRecords(sellerId, from, to, pageNum, limitNum);
    await this.logView(req, 'seller-commission', { sellerId, page: pageNum });
    return { success: true, message: 'Seller commission records retrieved', data };
  }

  /* #11 — paginated settlement drill-down for a seller. */
  @Get('sellers/:sellerId/settlements')
  async getSellerSettlementsList(
    @Req() req: any,
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getSellerSettlements(sellerId, from, to, pageNum, limitNum);
    await this.logView(req, 'seller-settlements', { sellerId, page: pageNum });
    return { success: true, message: 'Seller settlements retrieved', data };
  }

  /* #14 — per-seller summary CSV export (every field formula-escaped). */
  @Get('sellers/:sellerId/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportSellerCsv(
    @Req() req: any,
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
    @Query() query: AccountsDateRangeDto,
    @Res() res: Response,
  ) {
    const { from, to } = parseAccountsRange(query);
    const o = await this.dashboardService.getSellerAccountsOverview(sellerId, from, to);
    await this.logView(req, 'seller-export', { sellerId });
    res.setHeader('Content-Disposition', `attachment; filename="seller-${sellerId}-accounts.csv"`);
    const rows: Array<[string, string]> = [
      ['metric', 'value'],
      ['seller_name', o.seller.name],
      ['gstin', o.seller.gstin ?? ''],
      ['status', o.seller.status],
      ['period_from', o.period.from ?? 'all-time'],
      ['period_to', o.period.to ?? 'all-time'],
      ['revenue_gross', o.revenue.gross],
      ['revenue_refunds_deducted', o.revenue.refundsDeducted],
      ['revenue_net', o.revenue.net],
      ['tax_on_commission_excluded', o.revenue.taxExcluded],
      ['platform_margin', o.margin.platformMargin],
      ['margin_percentage', String(o.margin.marginPercentage)],
      ['commission_records', String(o.commission.recordCount)],
      ['payable_pending_amount', o.payable.pendingAmount],
      ['payable_paid_amount', o.payable.paidAmount],
      ['last_settled_on', o.payable.lastSettledOn ?? ''],
      ['tds_deducted', o.taxDeductions.tdsDeducted],
      ['tcs_collected', o.taxDeductions.tcsCollected],
      ['adjustments_total', o.adjustments.totalAmount],
      ['reversals_count', String(o.reversals.count)],
      ['open_discrepancies', String(o.reconciliation.openDiscrepancies)],
    ];
    const csv = rows.map((r) => r.map(escapeCsvField).join(',')).join('\n');
    res.send(csv);
  }

  /* ── Phase 177: per-franchise drill-down ── */

  /** #1/#13 — single franchise's financial bundle (online + POS + procurement). */
  @Get('franchises/:franchiseId/overview')
  async getFranchiseAccounts(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query() query: AccountsDateRangeDto,
  ) {
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getFranchiseAccountsOverview(franchiseId, from, to);
    await this.logView(req, 'franchise-overview', { franchiseId, fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
    return { success: true, message: 'Franchise accounts overview retrieved', data };
  }

  /* #10 — paginated finance-ledger (online + procurement) drill-down. */
  @Get('franchises/:franchiseId/ledger')
  async getFranchiseLedger(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string, // ONLINE_ORDER (orders) | PROCUREMENT_FEE
    @Query('status') status?: string, // REVERSED (reversals) | ...
  ) {
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchiseLedgerEntries(franchiseId, from, to, pageNum, limitNum, sourceType, status);
    await this.logView(req, 'franchise-ledger', { franchiseId, page: pageNum, sourceType: sourceType ?? null, status: status ?? null });
    return { success: true, message: 'Franchise ledger retrieved', data };
  }

  /* #10/#13 — paginated reconciliation discrepancies attributable to a franchise. */
  @Get('franchises/:franchiseId/reconciliation-discrepancies')
  async getFranchiseRecon(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchiseReconciliationDiscrepancies(franchiseId, status, pageNum, limitNum);
    await this.logView(req, 'franchise-recon', { franchiseId, page: pageNum });
    return { success: true, message: 'Franchise reconciliation discrepancies retrieved', data };
  }

  /**
   * Phase 177 (#4) — record an itemized adjustment against a PENDING franchise
   * settlement. CRITICAL-gated (`accounts.franchise.adjust`) because it shifts
   * the franchise's net payable; audited. The service rejects a non-PENDING
   * settlement and CAS-guards the money mutation.
   */
  @Post('franchises/:franchiseId/settlements/:settlementId/adjustments')
  @Permissions('accounts.franchise.adjust')
  async createFranchiseAdjustment(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Param('settlementId', new ParseUUIDPipe()) settlementId: string,
    @Body() body: CreateFranchiseAdjustmentDto,
  ) {
    const data = await this.dashboardService.createFranchiseSettlementAdjustment({
      settlementId,
      amount: body.amount,
      adjustmentType: body.adjustmentType,
      notes: body.notes,
      adminId: req?.adminId,
    });
    void this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'accounts.franchise.adjustment.created',
        module: 'accounts',
        resource: 'FranchiseSettlementAdjustment',
        resourceId: data.id,
        newValue: { franchiseId, settlementId, amount: body.amount, adjustmentType: body.adjustmentType, notes: body.notes ?? null },
      })
      .catch(() => undefined);
    return { success: true, message: 'Franchise settlement adjustment recorded', data };
  }

  /* #10 — paginated POS sales drill-down. */
  @Get('franchises/:franchiseId/pos-sales')
  async getFranchisePos(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchisePosSales(franchiseId, from, to, pageNum, limitNum);
    await this.logView(req, 'franchise-pos', { franchiseId, page: pageNum });
    return { success: true, message: 'Franchise POS sales retrieved', data };
  }

  /* #10 — paginated settlement drill-down. */
  @Get('franchises/:franchiseId/settlements')
  async getFranchiseSettlementsList(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchiseSettlementsList(franchiseId, from, to, pageNum, limitNum);
    await this.logView(req, 'franchise-settlements', { franchiseId, page: pageNum });
    return { success: true, message: 'Franchise settlements retrieved', data };
  }

  /* #15 — per-franchise summary CSV export (every field formula-escaped). */
  @Get('franchises/:franchiseId/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportFranchiseCsv(
    @Req() req: any,
    @Param('franchiseId', new ParseUUIDPipe()) franchiseId: string,
    @Query() query: AccountsDateRangeDto,
    @Res() res: Response,
  ) {
    const { from, to } = parseAccountsRange(query);
    const o = await this.dashboardService.getFranchiseAccountsOverview(franchiseId, from, to);
    await this.logView(req, 'franchise-export', { franchiseId });
    res.setHeader('Content-Disposition', `attachment; filename="franchise-${franchiseId}-accounts.csv"`);
    const rows: Array<[string, string]> = [
      ['metric', 'value'],
      ['franchise_code', o.franchise.code],
      ['franchise_name', o.franchise.name],
      ['gstin', o.franchise.gstin ?? ''],
      ['status', o.franchise.status],
      ['period_from', o.period.from ?? 'all-time'],
      ['period_to', o.period.to ?? 'all-time'],
      ['online_revenue', o.revenue.onlineRevenue],
      ['pos_net_revenue', o.revenue.posNet],
      ['total_revenue', o.revenue.totalRevenue],
      ['procurement_value', o.procurement.totalProcuredValue],
      ['procurement_fees', o.procurement.procurementFees],
      ['platform_margin_total', o.platformMargin.total],
      ['payable_pending', o.payable.pendingAmount],
      ['payable_paid', o.payable.paidAmount],
      ['last_settled_on', o.payable.lastSettledOn ?? ''],
      ['reversals_count', String(o.reversals.count)],
      ['open_discrepancies', String(o.reconciliation.openDiscrepancies)],
    ];
    const csv = rows.map((r) => r.map(escapeCsvField).join(',')).join('\n');
    res.send(csv);
  }

  /* ── Phase 178: outstanding-payables aging / hold ── */

  /**
   * #4/#11 — freeze (`hold:true`) / release a settlement from payout. CRITICAL-
   * gated (`accounts.payable.hold`); audited. A frozen settlement drops out of
   * the overdue aging buckets until released.
   */
  @Post('payables/:nodeType/:settlementId/hold')
  @Permissions('accounts.payable.hold')
  async setSettlementHold(
    @Req() req: any,
    @Param('nodeType') nodeType: string,
    @Param('settlementId', new ParseUUIDPipe()) settlementId: string,
    @Body() body: SettlementHoldDto,
  ) {
    const nt = (nodeType || '').toUpperCase();
    if (nt !== 'SELLER' && nt !== 'FRANCHISE') {
      throw new BadRequestAppException('nodeType must be SELLER or FRANCHISE');
    }
    const data = await this.dashboardService.setSettlementHold({
      nodeType: nt as 'SELLER' | 'FRANCHISE',
      settlementId,
      hold: body.hold,
      holdReason: body.holdReason,
      adminId: req?.adminId,
    });
    void this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: body.hold ? 'accounts.payable.frozen' : 'accounts.payable.released',
        module: 'accounts',
        resource: `${nt}Settlement`,
        resourceId: settlementId,
        newValue: { hold: body.hold, holdReason: body.holdReason ?? null },
      })
      .catch(() => undefined);
    return { success: true, message: body.hold ? 'Settlement frozen' : 'Settlement released', data };
  }

  /**
   * Phase 178 (#12) — record a partial / full disbursement against a settlement.
   * CRITICAL-gated (`accounts.payable.recordPayment`); audited. Flips to PAID
   * (cumulative reaches net) or PARTIALLY_PAID; rejects over-payment.
   */
  @Post('payables/:nodeType/:settlementId/payment')
  @Permissions('accounts.payable.recordPayment')
  async recordSettlementPayment(
    @Req() req: any,
    @Param('nodeType') nodeType: string,
    @Param('settlementId', new ParseUUIDPipe()) settlementId: string,
    @Body() body: RecordSettlementPaymentDto,
  ) {
    const nt = (nodeType || '').toUpperCase();
    if (nt !== 'SELLER' && nt !== 'FRANCHISE') {
      throw new BadRequestAppException('nodeType must be SELLER or FRANCHISE');
    }
    // Exact rupee-string → paise (DTO guarantees the format).
    const [intPart = '0', fracPart = ''] = body.amount.split('.');
    const amountInPaise = BigInt(intPart) * 100n + BigInt((fracPart + '00').slice(0, 2));
    const data = await this.dashboardService.recordSettlementPayment({
      nodeType: nt as 'SELLER' | 'FRANCHISE',
      settlementId,
      amountInPaise,
      adminId: req?.adminId,
    });
    void this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'accounts.payable.paymentRecorded',
        module: 'accounts',
        resource: `${nt}Settlement`,
        resourceId: settlementId,
        newValue: { amount: body.amount, resultStatus: data.status },
      })
      .catch(() => undefined);
    return { success: true, message: 'Payment recorded', data };
  }

  /* #17 — aging-bucket CSV export. */
  @Get('payables/aging.csv')
  @Header('Content-Type', 'text/csv')
  async exportAgingCsv(
    @Req() req: any,
    @Query('asOfDate') asOfDate: string | undefined,
    @Res() res: Response,
  ) {
    const asOf = parseAccountsDate(asOfDate, 'to');
    const o = await this.dashboardService.getOutstandingPayables(asOf);
    await this.logView(req, 'payables-aging-export', { asOfDate: asOfDate ?? null });
    res.setHeader('Content-Disposition', 'attachment; filename="payables-aging.csv"');
    const rows: string[][] = [
      ['bucket', 'severity', 'count', 'amount_inr'],
      ...o.aging.buckets.map((b) => [b.bucket, b.severity ?? '', String(b.count), b.amount]),
      ['overdue_total', '', String(o.aging.overdue.count), o.aging.overdue.amount],
      ['frozen', '', String(o.frozen.count), ''],
      ['failed', '', String(o.failed.count), ''],
      ['TOTAL_OUTSTANDING', '', '', o.totalOutstanding],
    ];
    const csv = rows.map((r) => r.map(escapeCsvField).join(',')).join('\n');
    res.send(csv);
  }
}
