import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { FranchiseAccessGuard } from '../../../../core/guards';
import { StaffPermissions } from '../../../../core/decorators/staff-permissions.decorator';
import { FranchisePosService } from '../../application/services/franchise-pos.service';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { PosRecordSaleDto } from '../dtos/pos-record-sale.dto';
import { PosVoidSaleDto } from '../dtos/pos-void-sale.dto';
import { PosReturnSaleDto } from '../dtos/pos-return-sale.dto';
import { PosReportQueryDto } from '../dtos/pos-report-query.dto';

@ApiTags('Franchise POS')
@Controller('franchise/pos')
// Phase 159u (staff-auth B3) — accept the OWNER token OR a STAFF token. Owner
// behaviour is unchanged (delegates to FranchiseAuthGuard + FranchiseActiveGuard);
// staff must hold the per-route @StaffPermissions (and req.staffId now flows to
// createdByStaffId / voidedBy / returnedBy, closing #141 B5 / #142). Routes
// without @StaffPermissions are owner-only.
@UseGuards(FranchiseAccessGuard)
export class FranchisePosController {
  constructor(private readonly posService: FranchisePosService) {}

  @Post('sales')
  @StaffPermissions('pos.sell')
  @HttpCode(HttpStatus.CREATED)
  // Phase 159q (audit #4) — POS terminals re-fire on slow networks. Without
  // dedup a retry creates a second sale, a second stock deduction, a second
  // tax invoice and a second receipt number. voidSale already had this; the
  // most important endpoint did not.
  @Idempotent()
  async recordSale(@Req() req: Request, @Body() dto: PosRecordSaleDto) {
    const franchiseId = (req as any).franchiseId;
    // Org-level actor for the inventory ledger (attributed FRANCHISE_OWNER).
    const actorId = (req as any).franchiseId;
    // Phase 159q (audit #5) — staff attribution. The franchise auth is
    // org-level today; a per-cashier staff JWT (follow-up) would populate
    // req.staffId. Pass it through (null today) so createdByStaffId is either a
    // real FranchiseStaff id or NULL — never the franchise's own id.
    const staffId = (req as any).staffId ?? (req as any).franchiseUserId ?? null;

    const sale = await this.posService.recordSale(
      franchiseId,
      {
        saleType: dto.saleType,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        paymentMethod: dto.paymentMethod,
        items: dto.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineDiscount: item.lineDiscount,
        })),
      },
      actorId,
      staffId,
    );

    return {
      success: true,
      message: 'POS sale recorded successfully',
      data: sale,
    };
  }

  @Get('sales')
  @StaffPermissions('report.read')
  async listSales(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('saleType') saleType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const franchiseId = (req as any).franchiseId;

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
      message: 'POS sales fetched successfully',
      data,
    };
  }

  @Get('daily-report')
  @StaffPermissions('report.read')
  async getDailyReport(
    @Req() req: Request,
    @Query() query: PosReportQueryDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const dateStr = query.date ?? this.posService.todayInReportTz();

    const data = await this.posService.getDailyReport(franchiseId, dateStr);

    return {
      success: true,
      message: 'Daily POS report fetched successfully',
      data,
    };
  }

  // Phase 159s (audit #7) — finance CSV export (RFC-4180 + formula-injection safe).
  @Get('daily-report.csv')
  @StaffPermissions('report.read')
  async getDailyReportCsv(
    @Req() req: Request,
    @Query() query: PosReportQueryDto,
    @Res() res: Response,
  ) {
    const franchiseId = (req as any).franchiseId;
    const dateStr = query.date ?? this.posService.todayInReportTz();
    const csv = await this.posService.getDailyReportCsv(franchiseId, dateStr);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pos-report-${dateStr}.csv"`);
    res.send(csv);
  }

  @Get('reconciliation')
  @StaffPermissions('report.read')
  async getDailyReconciliation(
    @Req() req: Request,
    @Query() query: PosReportQueryDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const dateStr = query.date ?? this.posService.todayInReportTz();

    const data = await this.posService.getDailyReconciliation(
      franchiseId,
      dateStr,
    );

    return {
      success: true,
      message: 'Daily POS reconciliation fetched successfully',
      data,
    };
  }

  @Get('sales/:saleId')
  @StaffPermissions('report.read')
  async getSaleDetail(
    @Req() req: Request,
    @Param('saleId') saleId: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.posService.getSaleDetail(franchiseId, saleId);

    return {
      success: true,
      message: 'POS sale detail fetched successfully',
      data,
    };
  }

  @Post('sales/:saleId/void')
  @StaffPermissions('pos.void')
  @HttpCode(HttpStatus.OK)
  // Phase 7 (2026-05-16) — header-level dedup via the
  // `X-Idempotency-Key` header. Service-level CAS in
  // FranchisePosService.voidSale closes the race even when the header
  // is absent (legacy clients); the decorator adds belt + braces for
  // POS terminals that re-fire on slow network.
  @Idempotent()
  // Phase 159r (audit #18) — flood-protection on the reversal surface.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async voidSale(
    @Req() req: Request,
    @Param('saleId') saleId: string,
    @Body() dto: PosVoidSaleDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).franchiseId;
    const staffId = (req as any).staffId ?? (req as any).franchiseUserId ?? null;

    const data = await this.posService.voidSale(
      franchiseId,
      saleId,
      dto.reason,
      actorId,
      staffId,
    );

    return {
      success: true,
      message: 'POS sale voided successfully',
      data,
    };
  }

  @Post('sales/:saleId/return')
  @StaffPermissions('pos.return')
  @HttpCode(HttpStatus.OK)
  // Phase 159q (audit #14) — same retry-dedup as void; the service also gained
  // a CAS guard so a double-return can't double-restock.
  @Idempotent()
  // Phase 159r (audit #18) — flood-protection.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async returnSale(
    @Req() req: Request,
    @Param('saleId') saleId: string,
    @Body() dto: PosReturnSaleDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).franchiseId;
    const staffId = (req as any).staffId ?? (req as any).franchiseUserId ?? null;

    const data = await this.posService.returnSale(
      franchiseId,
      saleId,
      dto.items.map((item) => ({
        itemId: item.itemId,
        returnQty: item.returnQty,
        condition: item.condition,
      })),
      actorId,
      {
        refundMethod: dto.refundMethod,
        returnReason: dto.returnReason ?? null,
        refundReference: dto.refundReference ?? null,
        staffId,
      },
    );

    return {
      success: true,
      message: 'POS sale return processed successfully',
      data,
    };
  }
}
