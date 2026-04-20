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
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { CommissionProcessorService } from '../../application/services/commission-processor.service';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';

@ApiTags('Admin Commission')
@Controller('admin/commission')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminCommissionController {
  constructor(private readonly commissionService: CommissionProcessorService) {}

  /* ── Global Commission Settings ── */

  @Get('settings')
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

  /* ── CSV Export ── */

  /**
   * Mirrors the filter semantics of `GET /admin/commission`. Returns
   * up to 50k rows; if the filter matches more, the X-Export-Truncated
   * header is set so the UI can warn the user and recommend narrowing
   * the date range.
   */
  @Get('export')
  async exportCommissions(
    @Res() res: Response,
    @Query('sellerId') sellerId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('commissionType') commissionType?: string,
    @Query('status') status?: string,
  ) {
    const { rows, total, truncated } =
      await this.commissionService.exportCommissionRecords({
        sellerId,
        search,
        dateFrom,
        dateTo,
        commissionType,
        status,
      });

    const headers = [
      'createdAt',
      'orderNumber',
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
      'adjustedAt',
      'adjustmentReason',
      'originalAdminEarning',
      'settlementId',
      'settlementPaidAt',
      'utrReference',
    ];

    const mapped = rows.map((r: any) => ({
      createdAt: r.createdAt,
      orderNumber: r.orderNumber,
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
      adjustedAt: r.adjustedAt,
      adjustmentReason: r.adjustmentReason,
      originalAdminEarning:
        r.originalAdminEarning != null ? Number(r.originalAdminEarning) : null,
      settlementId: r.sellerSettlement?.id ?? null,
      settlementPaidAt: r.sellerSettlement?.paidAt ?? null,
      utrReference: r.sellerSettlement?.utrReference ?? null,
    }));

    const csv = toCsv(mapped, headers);
    const filename = `${csvFilenameSlug([
      'commission',
      dateFrom,
      dateTo,
      status,
      sellerId,
    ]) || 'commission_export'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('X-Export-Total', String(total));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
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

  /* ── Reversal + adjustment history ── */

  /**
   * Unified audit timeline for a single commission record. Returns the
   * processor's original numbers, every reversal event, and any manual
   * adjustment — sorted oldest-first so the UI can render a history list.
   */
  @Get(':id/history')
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
  async adjustCommission(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { newAdminEarning: number; reason: string },
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
}
