import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RequiresStepUp,
  RolesGuard,
  StepUpGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { AffiliatePayoutService } from '../../application/services/affiliate-payout.service';
import {
  MarkPayoutPaidDto,
  MarkPayoutFailedDto,
  RejectPayoutDto,
} from '../dtos/affiliate-payout.dto';

// Phase 155 — actor context (admin + IP + UA) for the audit trail.
function actorCtx(req: Request) {
  return {
    adminId: (req as any).adminId as string,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

/**
 * Admin endpoints for processing affiliate payout requests.
 * Mounted at /admin/affiliates/payouts so it sits cleanly alongside
 * the rest of /admin/affiliates/*.
 */
@ApiTags('Admin Affiliate Payouts')
@Controller('admin/affiliates/payouts')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
export class AdminAffiliatePayoutController {
  constructor(
    private readonly payoutService: AffiliatePayoutService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get()
  @Permissions('affiliates.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('affiliateId') affiliateId?: string,
  ) {
    const data = await this.payoutService.listForAdmin({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      affiliateId,
    });
    return { success: true, message: 'Payouts fetched', data };
  }

  // Phase 159e — §194-O quarterly TDS report for Form 26Q. Read-only;
  // permission-gated separately from the payout actions so a tax/finance role
  // can be granted reporting access without payout-execution rights.
  @Get('tds-194o-report')
  @Permissions('affiliates.tax_report.read')
  async tds194oReport(@Query('quarter') quarter?: string) {
    const period = (quarter ?? '').trim();
    if (!/^\d{4}-Q[1-4]$/.test(period)) {
      return {
        success: false,
        message: 'Provide ?quarter=YYYY-Qn (e.g. 2026-Q1).',
        data: null,
      };
    }
    const data = await this.payoutService.get194OTdsReport(period);
    return { success: true, message: '§194-O TDS report', data };
  }

  // Phase 159g — affiliate Form 26Q CSV (CBDT-canonical, injection-safe, full
  // PAN). Streamed download; audit-logged per access.
  @Get('form26q.csv')
  @Permissions('affiliates.tax_report.read')
  async form26qCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query('quarter') quarter?: string,
  ) {
    const period = (quarter ?? '').trim();
    if (!/^\d{4}-Q[1-4]$/.test(period)) {
      res.status(400).json({ success: false, message: 'Provide ?quarter=YYYY-Qn (e.g. 2026-Q1).' });
      return;
    }
    const csv = await this.payoutService.generateAffiliateForm26QCsv(period);
    const ctx = actorCtx(req);
    this.audit
      .writeAuditLog({
        actorId: ctx.adminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_FORM26Q_EXPORTED',
        module: 'affiliate',
        resource: 'AffiliateTds194OLedger',
        resourceId: period,
        newValue: { format: 'csv', bytes: Buffer.byteLength(csv, 'utf8') },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      .catch(() => undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="form26q-affiliate-${period}.csv"`);
    res.send(csv);
  }

  // Phase 159f — §194-O ledger rows for a quarter (ops selection list).
  @Get('tds-ledger')
  @Permissions('affiliates.tax_report.read')
  async tdsLedger(
    @Query('quarter') quarter?: string,
    @Query('status') status?: string,
  ) {
    const period = (quarter ?? '').trim();
    if (!/^\d{4}-Q[1-4]$/.test(period)) {
      return { success: false, message: 'Provide ?quarter=YYYY-Qn.', data: null };
    }
    const data = await this.payoutService.listTds194OLedger({ filingPeriod: period, status });
    return { success: true, message: '§194-O ledger', data };
  }

  // Phase 159f — bulk mark TDS deposited (challan). WITHHELD → DEPOSITED.
  @Patch('tds/mark-deposited')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.tax.deposit')
  async markTdsDeposited(
    @Req() req: Request,
    @Body()
    body: {
      ledgerIds?: string[];
      challanReference?: string;
      bsrCode?: string;
      challanDate?: string;
    },
  ) {
    const ledgerIds = Array.isArray(body.ledgerIds) ? body.ledgerIds : [];
    const challanReference = (body.challanReference ?? '').trim();
    if (ledgerIds.length === 0 || !challanReference) {
      return { success: false, message: 'ledgerIds[] and challanReference are required.', data: null };
    }
    // Phase 159g — optional BSR code + challan date (CBDT Form 26Q).
    let challanDate: Date | undefined;
    if (body.challanDate) {
      const d = new Date(body.challanDate);
      if (Number.isNaN(d.getTime())) {
        return { success: false, message: 'challanDate is invalid.', data: null };
      }
      challanDate = d;
    }
    const ctx = actorCtx(req);
    const data = await this.payoutService.markTds194ODeposited({
      ledgerIds,
      depositedBy: ctx.adminId,
      challanReference,
      bsrCode: (body.bsrCode ?? '').trim() || undefined,
      challanDate,
      audit: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return { success: true, message: `Marked ${data.flipped} row(s) deposited.`, data };
  }

  // Phase 159f — bulk issue Form 16A. DEPOSITED → CERTIFICATE_ISSUED.
  @Patch('tds/mark-certificate-issued')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.tax.issue_certificate')
  async markTdsCertificateIssued(
    @Req() req: Request,
    @Body() body: { ledgerIds?: string[]; certificateNumber?: string },
  ) {
    const ledgerIds = Array.isArray(body.ledgerIds) ? body.ledgerIds : [];
    const certificateNumber = (body.certificateNumber ?? '').trim();
    if (ledgerIds.length === 0 || !certificateNumber) {
      return { success: false, message: 'ledgerIds[] and certificateNumber are required.', data: null };
    }
    const ctx = actorCtx(req);
    const data = await this.payoutService.markTds194OCertificateIssued({
      ledgerIds,
      issuedBy: ctx.adminId,
      certificateNumber,
      audit: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return { success: true, message: `Issued certificate for ${data.flipped} row(s).`, data };
  }

  @Patch(':payoutRequestId/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts.approve')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — approval transitions the payout to APPROVED and freezes
  // the bundled commissions; reversible only via reject. 5-min window.
  @RequiresStepUp()
  async approve(
    @Req() req: Request,
    @Param('payoutRequestId', ParseUUIDPipe) payoutRequestId: string,
  ) {
    const data = await this.payoutService.approve({
      payoutRequestId,
      ...actorCtx(req),
    });
    return { success: true, message: 'Payout approved', data };
  }

  @Patch(':payoutRequestId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts.reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — releases commissions back to CONFIRMED; non-money but
  // affects which affiliates can re-request. 5-min window.
  @RequiresStepUp()
  async reject(
    @Req() req: Request,
    @Param('payoutRequestId', ParseUUIDPipe) payoutRequestId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    const data = await this.payoutService.reject({
      payoutRequestId,
      reason: dto.reason,
      ...actorCtx(req),
    });
    return {
      success: true,
      message:
        'Payout rejected. Commissions released back to CONFIRMED so the affiliate can re-request.',
      data,
    };
  }

  @Patch(':payoutRequestId/mark-paid')
  @HttpCode(HttpStatus.OK)
  // Phase 155 — highest-stakes money-out transition: SUPER_ADMIN-only (mirrors
  // seller mark-paid) + granular permission + idempotent replay-safe.
  @Roles('SUPER_ADMIN')
  @Permissions('affiliates.payouts.mark_paid')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — terminal money-out transition. Tight 1-min step-up window.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async markPaid(
    @Req() req: Request,
    @Param('payoutRequestId', ParseUUIDPipe) payoutRequestId: string,
    @Body() dto: MarkPayoutPaidDto,
  ) {
    const data = await this.payoutService.markPaid({
      payoutRequestId,
      transactionRef: dto.transactionRef,
      ...actorCtx(req),
    });
    return {
      success: true,
      message: 'Payout marked paid. Bundled commissions are now PAID.',
      data,
    };
  }

  @Patch(':payoutRequestId/mark-failed')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts.mark_failed')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — transitions a payout to FAILED so it can be re-tried;
  // money is not moved here but the state pin matters. 5-min window.
  @RequiresStepUp()
  async markFailed(
    @Req() req: Request,
    @Param('payoutRequestId', ParseUUIDPipe) payoutRequestId: string,
    @Body() dto: MarkPayoutFailedDto,
  ) {
    const data = await this.payoutService.markFailed({
      payoutRequestId,
      reason: dto.reason,
      ...actorCtx(req),
    });
    return {
      success: true,
      message:
        'Payout marked failed. Commissions released back to CONFIRMED for re-request.',
      data,
    };
  }
}
