import {
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminAuthGuard,
  RolesGuard,
  PermissionsGuard,
  AdminSettlementSellerScopeGuard,
} from '../../core/guards';
import { Roles } from '../../core/decorators/roles.decorator';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { resolveScopedTypes } from '../../core/authorization/seller-scope';
import { Idempotent } from '../../core/decorators/idempotent.decorator';
import { SettlementService } from './settlement.service';
import { CommissionInvoiceUnavailableError } from '../tax/application/services/commission-invoice.service';
import {
  CreateCycleDto,
  CancelCycleDto,
  ApproveCycleDto,
  MarkPaidDto,
  MarkFailedDto,
  CreateAdjustmentDto,
  VoidAdjustmentDto,
} from './dtos/create-cycle.dto';

// Phase 141 — interpret a bare YYYY-MM-DD as an Asia/Kolkata day boundary
// (fixed +05:30, no DST), not server-local. A full ISO string with its own
// offset is respected verbatim.
const IST = '+05:30';
function istDayStart(input: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T00:00:00.000${IST}`)
    : new Date(input);
}
function istDayEnd(input: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T23:59:59.999${IST}`)
    : new Date(input);
}
// 6-month sanity cap so an operator can't accidentally sweep years of records.
const MAX_CYCLE_WINDOW_MS = 186 * 24 * 60 * 60 * 1000;

@ApiTags('Admin Settlements')
@Controller('admin/settlements')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  /* ── POST /admin/settlements/preview-cycle ── */
  // Phase 141/142 — read-only dry-run: "what would this cycle include?" before
  // committing. Same DTO + period resolution as create, same aggregator, so the
  // numbers match. Throttled (it's a heavier aggregate scan than the list).
  @Post('preview-cycle')
  @Permissions('settlements.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async previewCycle(@Req() req: Request, @Body() body: CreateCycleDto) {
    const { periodStart, periodEnd } = this.resolvePeriod(body);
    const adminId = (req as any).adminId;
    const preview = await this.settlementService.previewCycle(
      periodStart,
      periodEnd,
      { adminId },
    );
    return { success: true, message: 'Settlement cycle preview', data: preview };
  }

  /* ── POST /admin/settlements/create-cycle ── */
  // Phase 141 — locking 100s/1000s of commission records into a payout cycle is
  // the flow's most consequential write, so it's tightened to SUPER_ADMIN with
  // its own granular permission (was the broad settlements.approve, no @Roles —
  // looser than the approve gate it feeds) + throttled.
  @Post('create-cycle')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.createCycle')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async createCycle(@Req() req: Request, @Body() body: CreateCycleDto) {
    const { periodStart, periodEnd } = this.resolvePeriod(body);
    const adminId = (req as any).adminId;
    const result = await this.settlementService.createCycle(
      periodStart,
      periodEnd,
      { adminId },
    );

    return {
      success: true,
      message: result.message,
      data: result.cycle,
    };
  }

  /**
   * Phase 141 — shared period resolution: IST day boundaries + start<end +
   * a max-window cap. (DTO already guarantees both are valid ISO-8601.)
   */
  private resolvePeriod(body: CreateCycleDto): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const periodStart = istDayStart(body.periodStart);
    const periodEnd = istDayEnd(body.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    if (periodStart >= periodEnd) {
      throw new BadRequestException('periodStart must be before periodEnd');
    }
    if (periodEnd.getTime() - periodStart.getTime() > MAX_CYCLE_WINDOW_MS) {
      throw new BadRequestException(
        'Cycle window too large (max ~6 months). Narrow the date range.',
      );
    }
    return { periodStart, periodEnd };
  }

  /* ── GET /admin/settlements/cycles ── */
  @Get('cycles')
  @Permissions('settlements.read')
  async listCycles(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.settlementService.listCycles(pageNum, limitNum);

    return {
      success: true,
      message: 'Settlement cycles retrieved',
      data: result,
    };
  }

  /* ── GET /admin/settlements/cycles/:cycleId ── */
  @Get('cycles/:cycleId')
  @Permissions('settlements.read')
  async getCycleDetail(@Param('cycleId') cycleId: string) {
    const cycle = await this.settlementService.getCycleDetail(cycleId);

    if (!cycle) {
      throw new NotFoundException('Settlement cycle not found');
    }

    return {
      success: true,
      message: 'Settlement cycle detail retrieved',
      data: cycle,
    };
  }

  /* ── PATCH /admin/settlements/cycles/:cycleId/approve ── */
  @Patch('cycles/:cycleId/approve')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.approve')
  // Phase 144 — approval runs TCS+TDS hooks (dozens-to-hundreds of ledger rows
  // each); throttle + idempotency so a double-click / retry can't double-fire.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Idempotent()
  async approveCycle(
    @Req() req: Request,
    @Param('cycleId') cycleId: string,
    @Body() body: ApproveCycleDto,
  ) {
    const adminId = (req as any).adminId;
    const result = await this.settlementService.approveCycle(
      cycleId,
      adminId,
      body?.notes,
    );

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: result.message,
      data: { tcs: result.tcs, tds: result.tds },
    };
  }

  /* ── PATCH /admin/settlements/cycles/:cycleId/cancel ── */
  // Phase 141 — reverse an erroneously-created DRAFT/PREVIEWED cycle: releases
  // its claimed commission records and marks the cycle + seller settlements
  // CANCELLED. SUPER_ADMIN-only, same as create.
  @Patch('cycles/:cycleId/cancel')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.createCycle')
  async cancelCycle(
    @Req() req: Request,
    @Param('cycleId') cycleId: string,
    @Body() body: CancelCycleDto,
  ) {
    const adminId = (req as any).adminId;
    const result = await this.settlementService.cancelCycle(
      cycleId,
      { adminId },
      body.reason,
    );
    return {
      success: true,
      message: result.message,
      data: { releasedRecordCount: result.releasedRecordCount },
    };
  }

  /* ── PATCH /admin/settlements/:settlementId/mark-paid ── */
  @Patch(':settlementId/mark-paid')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.markPaid')
  // Phase 145 — real money movement: throttle + idempotency so a double-click /
  // retry can't double-fire the TCS/TDS hooks or surface a spurious error.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async markPaid(
    @Req() req: Request,
    @Param('settlementId') settlementId: string,
    @Body() body: MarkPaidDto,
  ) {
    const result = await this.settlementService.markSettlementPaid(
      settlementId,
      body.utrReference.trim(),
      {
        adminId: (req as any).adminId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
        paymentMethod: body.paymentMethod,
        paymentProofUrl: body.paymentProofUrl,
      },
    );

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: result.message,
    };
  }

  /* ── PATCH /admin/settlements/:settlementId/mark-failed ── */
  // Phase 145 — record a bank-rejected/reversed payout as FAILED so it can be
  // retried (FAILED → PAID) with an audit chain instead of left blind-APPROVED.
  @Patch(':settlementId/mark-failed')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.markPaid')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async markFailed(
    @Req() req: Request,
    @Param('settlementId') settlementId: string,
    @Body() body: MarkFailedDto,
  ) {
    const result = await this.settlementService.markSettlementFailed(
      settlementId,
      body.reason,
      {
        adminId: (req as any).adminId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      },
    );

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return { success: true, message: result.message };
  }

  /* ── GET /admin/settlements/margin-summary ── */
  @Get('margin-summary')
  @Permissions('settlements.read')
  async getMarginSummary() {
    const data = await this.settlementService.getAdminMarginSummary();

    return {
      success: true,
      message: 'Admin margin summary retrieved',
      data,
    };
  }

  /* ── GET /admin/settlements/cycles/:cycleId/export.csv ──
   * Phase 3.5 (2026-05-16) — Tally / accounting-package CSV export.
   * Generates a Tally Prime-compatible voucher import file for the
   * cycle's seller settlements. Finance hands this to their bookkeeper
   * at monthly close. */
  @Get('cycles/:cycleId/export.csv')
  // Phase 148 — exporting a cycle's payment vouchers exposes seller financials,
  // so it's tightened from "any settlements.read holder" to admin/seller-admin
  // roles + throttled. The cycleId is validated as a UUID at the boundary.
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('settlements.read')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCycleToTallyCsv(
    @Req() req: Request,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Res() res: any,
  ) {
    const csv = await this.settlementService.exportCycleToTallyCsv(cycleId, {
      adminId: (req as any).adminId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="settlement-cycle-${cycleId.slice(0, 8)}.csv"`,
    );
    res.send(csv);
  }

  /* ── GET /admin/settlements/cycles/:cycleId/balances ──
   * Phase 3.5 — opening / closing balance per seller for a cycle.
   * Used by finance for monthly reconciliation. */
  @Get('cycles/:cycleId/balances')
  // Phase 149 — balance data exposes every seller's outstanding payable; tighten
  // from "any settlements.read holder" to admin/seller-admin + UUID-validate +
  // throttle (the computation is a couple of indexed aggregates).
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('settlements.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getCycleBalances(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    const data = await this.settlementService.computeOpeningClosingBalance(
      cycleId,
    );
    return {
      success: true,
      message: 'Opening / closing balances computed',
      data,
    };
  }

  /* ── GET /admin/settlements/seller-breakdown ── */
  @Get('seller-breakdown')
  @Permissions('settlements.read')
  async getSellerBreakdown(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    // Isolation fix (2026-06-16) — a scoped admin only sees their own seller
    // type's per-seller rows (null = unrestricted: super / franchise admin).
    const allowedSellerTypes = resolveScopedTypes((req as any).user?.permissions);
    const data = await this.settlementService.getAdminSellerBreakdown(
      pageNum,
      limitNum,
      allowedSellerTypes,
    );

    return {
      success: true,
      message: 'Per-seller breakdown retrieved',
      data,
    };
  }

  /* ── T6: GET /admin/settlements/reconciliation ── */
  @Get('reconciliation')
  @Permissions('recon.read')
  async getReconciliation() {
    const data = await this.settlementService.getReconciliation();

    return {
      success: true,
      message: 'Reconciliation report generated',
      data,
    };
  }

  /* ── GET /admin/settlements/:settlementId/commission-invoice ──
   * Renders the marketplace's commission tax invoice (SAC 9985) for one
   * seller settlement as HTML, served inline so the admin can view /
   * print / save it. The invoice itself is issued (numbered + snapshotted)
   * at cycle approval; this only renders the persisted snapshot. 404 if
   * the settlement is missing or its invoice hasn't been issued yet. */
  @Get(':settlementId/commission-invoice')
  @Permissions('settlements.read')
  // Isolation fix (2026-06-16) — a scoped admin may only view a settlement of
  // their own seller type; cross-type → 404.
  @UseGuards(AdminSettlementSellerScopeGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getCommissionInvoice(
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Res() res: any,
  ) {
    let result: { documentNumber: string; html: string };
    try {
      result = await this.settlementService.getCommissionInvoiceHtml(
        settlementId,
      );
    } catch (err) {
      if (err instanceof CommissionInvoiceUnavailableError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.documentNumber}.html"`,
    );
    res.send(result.html);
  }

  /* ── GET /admin/settlements/:settlementId/settlement-statement ──
   * The full settlement / payout statement (gross → commission → GST →
   * TCS → TDS → net) for one seller settlement, served inline as HTML.
   * This is a remittance advice, not a tax invoice. 404 if missing. */
  @Get(':settlementId/settlement-statement')
  @Permissions('settlements.read')
  // Isolation fix (2026-06-16) — own seller type only; cross-type → 404.
  @UseGuards(AdminSettlementSellerScopeGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getSettlementStatement(
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Res() res: any,
  ) {
    let result: { documentNumber: string; html: string };
    try {
      result = await this.settlementService.getSettlementStatementHtml(
        settlementId,
      );
    } catch (err) {
      if (err instanceof CommissionInvoiceUnavailableError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.documentNumber}.html"`,
    );
    res.send(result.html);
  }

  /* ── Manual adjustments on a settlement ── */
  // Phase 147 — granular settlements.adjust (split off the broad
  // settlements.approve), DTO-validated, idempotent, transactional.
  @Post(':settlementId/adjustments')
  @Permissions('settlements.adjust')
  async recordAdjustment(
    @Req() req: Request,
    @Param('settlementId') settlementId: string,
    @Body() body: CreateAdjustmentDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.settlementService.recordAdjustment({
      settlementId,
      amount: body.amount,
      reason: body.reason,
      notes: body.notes,
      adjustmentType: body.adjustmentType,
      referenceDocumentUrl: body.referenceDocumentUrl,
      idempotencyKey: idempotencyKey?.trim() || undefined,
      adminId: (req as any).adminId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return { success: true, message: 'Adjustment recorded', data };
  }

  /* ── PATCH /admin/settlements/:settlementId/adjustments/:adjustmentId/void ── */
  // Phase 147 — void (never hard-delete) a mistaken adjustment; reverses its
  // effect on the settlement + cycle totals.
  @Patch(':settlementId/adjustments/:adjustmentId/void')
  @Permissions('settlements.adjust')
  async voidAdjustment(
    @Req() req: Request,
    @Param('adjustmentId') adjustmentId: string,
    @Body() body: VoidAdjustmentDto,
  ) {
    const data = await this.settlementService.voidAdjustment(adjustmentId, {
      adminId: (req as any).adminId,
      voidReason: body.voidReason,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return { success: true, message: data.message, data };
  }

  @Get(':settlementId/adjustments')
  @Permissions('settlements.read')
  // Isolation fix (2026-06-16) — own seller type only; cross-type → 404.
  @UseGuards(AdminSettlementSellerScopeGuard)
  async listAdjustments(
    @Param('settlementId') settlementId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.settlementService.listAdjustments(
      settlementId,
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '50', 10) || 50,
    );
    // Keep the response `data` an array for backward-compat with the FE;
    // surface pagination alongside.
    return {
      success: true,
      message: 'Adjustments retrieved',
      data: result.items,
      pagination: { total: result.total, page: result.page, limit: result.limit },
    };
  }
}
