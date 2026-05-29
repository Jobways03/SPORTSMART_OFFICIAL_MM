import {
  Controller,
  Get,
  Put,
  Patch,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminAuthGuard,
  RolesGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CommissionProcessorService } from '../../application/services/commission-processor.service';
import { AdjustCommissionDto } from '../dtos/adjust-commission.dto';
import { ExportCommissionDto } from '../dtos/export-commission.dto';
import { csvFilenameSlug, csvHeaderLine, csvRowLines } from '../../../../core/utils';

@ApiTags('Admin Commission')
@Controller('admin/commission')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
export class AdminCommissionController {
  constructor(private readonly commissionService: CommissionProcessorService) {}

  /* ── Global Commission Settings ── */

  @Get('settings')
  @Permissions('settlements.read')
  async getSettings() {
    const settings = await this.commissionService.getCommissionSettings();
    return { success: true, message: 'Commission settings retrieved', data: settings };
  }

  // Global commission formula — changes flow through to every new
  // commission record written by the background processor. A lower-tier
  // admin flipping this setting would change platform earnings across the
  // entire marketplace with no localised blast radius. Treat as a
  // platform-economics operation and restrict to SUPER_ADMIN, same as
  // settlement mark-paid and commission-record adjustment.
  @Put('settings')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.approve')
  // Phase 26 — flipping global commission rates is a platform-economics
  // change; 5-min window so SUPER_ADMIN is forced to re-prove on every
  // unusual config touch.
  @RequiresStepUp()
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
  @Permissions('settlements.read')
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

  /* ── CSV Export ── */

  /**
   * Mirrors the filter semantics of `GET /admin/commission`. Returns
   * up to 50k rows; if the filter matches more, the X-Export-Truncated
   * header is set so the UI can warn the user and recommend narrowing
   * the date range.
   */
  @Get('export')
  @Permissions('settlements.read')
  // Phase 140 — a 50k-row CSV is ~12 MB; 3/min/IP is generous for legitimate
  // use and stops one IP from driving tens of MB/s of egress.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async exportCommissions(
    @Req() req: Request,
    @Res() res: Response,
    @Query() dto: ExportCommissionDto,
  ) {
    const adminId = (req as any).adminId;
    const { rows, total, truncated } =
      await this.commissionService.exportCommissionRecords(
        {
          sellerId: dto.sellerId,
          search: dto.search,
          dateFrom: dto.dateFrom,
          dateTo: dto.dateTo,
          commissionType: dto.commissionType,
          status: dto.status,
          subOrderId: dto.subOrderId,
          productId: dto.productId,
          settlementStatus: dto.settlementStatus,
          adjustedOnly: dto.adjustedOnly,
          reversedOnly: dto.reversedOnly,
        },
        { adminId },
      );

    const includePaise = dto.precision === 'paise';

    const headers = [
      'commissionRecordId',
      'createdAt',
      'orderNumber',
      'subOrderId',
      'orderItemId',
      'productId',
      'sellerName',
      'productTitle',
      'variantTitle',
      'quantity',
      'platformPrice',
      'settlementPrice',
      'totalPlatformAmount',
      'totalSettlementAmount',
      'platformMargin',
      'adminEarning',
      'productEarning',
      'refundedAdminEarning',
      'status',
      'commissionType',
      'commissionRate',
      'adjustedBy',
      'adjustedByName',
      'adjustedAt',
      'adjustmentReason',
      'originalAdminEarning',
      'settlementId',
      'settlementPaidAt',
      'utrReference',
      ...(includePaise
        ? [
            'totalPlatformAmountInPaise',
            'totalSettlementAmountInPaise',
            'platformMarginInPaise',
            'adminEarningInPaise',
            'productEarningInPaise',
            'refundedAdminEarningInPaise',
          ]
        : []),
    ];

    const mapRow = (r: any) => ({
      commissionRecordId: r.id,
      createdAt: r.createdAt,
      orderNumber: r.orderNumber,
      subOrderId: r.subOrderId,
      orderItemId: r.orderItemId,
      productId: r.productId,
      sellerName: r.sellerName,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      quantity: r.quantity,
      platformPrice: Number(r.platformPrice),
      settlementPrice: Number(r.settlementPrice),
      totalPlatformAmount: Number(r.totalPlatformAmount),
      totalSettlementAmount: Number(r.totalSettlementAmount),
      platformMargin: Number(r.platformMargin),
      adminEarning: Number(r.adminEarning),
      productEarning: Number(r.productEarning),
      refundedAdminEarning: Number(r.refundedAdminEarning),
      status: r.status,
      commissionType: r.commissionType,
      commissionRate: r.commissionRate,
      adjustedBy: r.adjustedBy,
      // Phase 140 — human name via the adjustedByAdmin FK, not a raw UUID.
      adjustedByName: r.adjustedByAdmin?.name ?? null,
      adjustedAt: r.adjustedAt,
      // Phase 140 — dispute notes are redacted unless explicitly requested.
      adjustmentReason: dto.includeReason
        ? r.adjustmentReason
        : r.adjustmentReason
          ? '[redacted — pass includeReason=true]'
          : null,
      originalAdminEarning:
        r.originalAdminEarning != null ? Number(r.originalAdminEarning) : null,
      settlementId: r.sellerSettlement?.id ?? null,
      settlementPaidAt: r.sellerSettlement?.paidAt ?? null,
      utrReference: r.sellerSettlement?.utrReference ?? null,
      ...(includePaise
        ? {
            totalPlatformAmountInPaise: r.totalPlatformAmountInPaise?.toString() ?? null,
            totalSettlementAmountInPaise: r.totalSettlementAmountInPaise?.toString() ?? null,
            platformMarginInPaise: r.platformMarginInPaise?.toString() ?? null,
            adminEarningInPaise: r.adminEarningInPaise?.toString() ?? null,
            productEarningInPaise: r.productEarningInPaise?.toString() ?? null,
            refundedAdminEarningInPaise: r.refundedAdminEarningInPaise?.toString() ?? null,
          }
        : {}),
    });

    const filename = `${csvFilenameSlug([
      'commission',
      dto.dateFrom,
      dto.dateTo,
      dto.status,
      dto.sellerId,
    ]) || 'commission_export'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Total', String(total));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');

    // Phase 140 — stream the CSV in batches via res.write rather than buffering
    // one ~12 MB string. Leading BOM so Excel renders Indic / accented names.
    res.write('﻿');
    res.write(csvHeaderLine(headers));
    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = (rows as any[]).slice(i, i + BATCH).map(mapRow);
      res.write(csvRowLines(batch, headers));
    }
    res.end();
  }

  /* ── Summary (aggregate margin data) ── */

  @Get('summary')
  @Permissions('settlements.read')
  async getSummary() {
    const summary = await this.commissionService.getAdminCommissionSummary();
    return {
      success: true,
      message: 'Commission summary retrieved',
      data: summary,
    };
  }

  /* ── Reversal + adjustment history ── */

  /**
   * Unified audit timeline for a single commission record. Returns the
   * processor's original numbers, every reversal event, and any manual
   * adjustment — sorted oldest-first so the UI can render a history list.
   */
  @Get(':id/history')
  // Phase 139 — split off settlements.read: the timeline exposes internal
  // dispute-resolution notes/reasons the basic list does not, so it gets its
  // own grant (additively re-seeded to existing settlements.read holders).
  @Permissions('settlements.history.read')
  async getHistory(@Param('id') id: string) {
    const data = await this.commissionService.getCommissionHistory(id);
    return {
      success: true,
      message: 'Commission history retrieved',
      data,
    };
  }

  /* ── Manual adjustment (dispute resolution) ── */

  /**
   * Override the platform earning on a commission record. Reserved for
   * dispute resolution. Rejects SETTLED / REFUNDED records; seller must
   * be reimbursed via the reversal flow in those cases.
   */
  @Patch(':id/adjust')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  // Phase 138 — granular permission split off the shared settlements.approve
  // (cycle approval). Adjusting a single record's earning is its own grant.
  @Permissions('settlements.adjustRecord')
  // Phase 26 — per-record platform-earning override; 5-min window.
  @RequiresStepUp()
  // Phase 138 — a double-submit (network retry) must not adjust twice; the
  // Idempotency-Key header replays the first response.
  @Idempotent()
  async adjustCommission(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AdjustCommissionDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.adjustCommissionRecord(id, {
      newAdminEarning: body.newAdminEarning,
      reason: body.reason,
      adminId,
    });
    return {
      success: true,
      message: 'Commission record adjusted',
      data,
    };
  }

  /* ── Hold / Resume (fraud-suspicion / operational review) ── */

  /**
   * Place a PENDING, not-yet-cycled commission record ON_HOLD so it's
   * excluded from settlement. Reversible via the resume endpoint. Distinct
   * from the system return-driven freeze (this stamps heldByAdminId).
   */
  @Patch(':id/hold')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('settlements.hold')
  // Holding pauses a payout — a money-control action; require a fresh step-up.
  @RequiresStepUp()
  async holdCommission(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { holdReason: string },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.holdCommissionRecord(
      id,
      adminId,
      body?.holdReason,
    );
    return { success: true, message: 'Commission held', data };
  }

  /**
   * Resume an admin-held record back to its previous state. Only lifts admin
   * holds; a system freeze (return in progress) resumes via the returns flow.
   */
  @Patch(':id/resume')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('settlements.hold')
  @RequiresStepUp()
  async resumeCommission(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { resumeReason?: string },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.resumeCommissionRecord(
      id,
      adminId,
      body?.resumeReason,
    );
    return { success: true, message: 'Commission resumed', data };
  }
}
