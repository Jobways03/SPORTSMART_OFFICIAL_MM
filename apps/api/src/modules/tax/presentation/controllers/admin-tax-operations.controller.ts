// Phase 25 follow-up — Admin tax OPERATIONS API (separate from
// reports/exports). Covers the 4 admin surfaces the frontend needs:
//
//   /admin/tax/timebar-review       — Phase 12 REQUIRES_FINANCE_REVIEW queue
//   /admin/tax/wallet-adjustments   — Phase 13 PENDING_APPROVAL queue
//   /admin/tax/eway-bills           — Phase 15 list + generate / cancel / override
//   /admin/tax/einvoices            — Phase 22 list + generate / cancel
//
// Same auth pattern as AdminTaxReportsController: AdminAuthGuard +
// PermissionsGuard + per-endpoint @Permissions.

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
// Phase 89 (2026-05-23) — DTO + override category enum.
import type { EWayBillOverrideReasonCategory } from '../../domain/eway-bill-events';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  WalletAdjustmentService,
  WalletAdjustmentNotFoundError,
  WalletAdjustmentNotApprovableError,
  WalletAdjustmentSelfApprovalError,
  WalletAdjustmentDuplicateApproverError,
  WalletAdjustmentFirstApproverRoleError,
  WalletAdjustmentSecondApproverRoleError,
} from '../../application/services/wallet-adjustment.service';
import {
  EWayBillService,
  EWayBillNotFoundError,
  EWayBillNotEligibleError,
  EWayBillCancellationWindowClosedError,
  EWayBillDisabledError,
} from '../../application/services/eway-bill.service';
import { EWayBillProviderError } from '../../infrastructure/eway-bill/eway-bill-provider';
import {
  EInvoiceService,
  EInvoiceCancellationWindowClosedError,
  EInvoiceNotApplicableError,
  EInvoiceDocumentNotFoundError,
  EInvoiceDisabledError,
} from '../../application/services/einvoice.service';
import { EInvoiceProviderError } from '../../infrastructure/einvoice/einvoice-provider';
import { CreditNoteService } from '../../application/services/credit-note.service';
import {
  GstnVerificationService,
  SellerGstinNotFoundError,
  CustomerTaxProfileNotFoundError,
} from '../../application/services/gstn-verification.service';
import { Tds194OExemptionService } from '../../application/services/tds-194o-exemption.service';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  ValidateNested,
} from 'class-validator';

// Phase 90 (2026-05-23) — typed bodies for the e-invoice endpoints.
export class CancelEinvoiceDto {
  // Phase 90 — Gap #19 enum validation. NIC accepts 1/2/3/4 only.
  @IsInt()
  @IsIn([1, 2, 3, 4])
  cancellationCode!: 1 | 2 | 3 | 4;

  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ResetEinvoiceRetryDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

// Phase 89 (2026-05-23) — typed bodies for the EWB endpoints.
const TRANSPORT_MODES = ['ROAD', 'RAIL', 'AIR', 'SHIP'] as const;
const OVERRIDE_CATEGORIES = [
  'URGENT_DISPATCH',
  'NIC_OUTAGE',
  'TEST_SHIPMENT',
  'GST_EXEMPT',
  'OTHER',
] as const;

export class GenerateEwayBillDto {
  // Phase 89 — Gap #12 NIC requirement check ensures HSN/UQC/qty at
  // service layer; the body itself just needs transport details.
  // ROAD requires vehicleNumber; other modes don't.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]{4,16}$/i)
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  transporterId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  transporterName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  distanceKm?: number;

  @IsOptional()
  @IsIn(TRANSPORT_MODES as unknown as string[])
  transportMode?: (typeof TRANSPORT_MODES)[number];

  // Phase 89 — Gap #29. Body can carry origin / destination so the
  // admin retry path (when resolveAddresses returns nulls) can
  // populate the row before the provider call.
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  fromPincode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  toPincode?: string;
}

export class CancelEwayBillDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class OverrideEwayBillDto {
  @IsIn(OVERRIDE_CATEGORIES as unknown as string[])
  reasonCategory!: EWayBillOverrideReasonCategory;

  // Phase 89 — Gap #26. When category=OTHER, require 20+ chars of
  // free-text justification; other categories allow shorter
  // (10 char min) since the category is self-descriptive.
  @IsString()
  @ValidateIf((o: OverrideEwayBillDto) => o.reasonCategory === 'OTHER')
  @Length(20, 500, {
    message: 'reason must be at least 20 chars when reasonCategory=OTHER',
  })
  @ValidateIf((o: OverrideEwayBillDto) => o.reasonCategory !== 'OTHER')
  @Length(10, 500)
  reason!: string;
}

export class RevokeOverrideEwayBillDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

// Phase 161 (Seller GSTIN Verification audit #9) — documents the verify
// contract + carries the optional `force` flag that bypasses the re-verify
// cooldown (#13).
export class VerifyGstinDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

// Phase 161 (TDS 194-O exempt audit B3/#9) — typed body. `reason` is required
// for BOTH grant (CBIC attestation basis) and revoke (revoke reason).
export class SetSeller194OExemptionDto {
  @IsBoolean()
  exempt!: boolean;

  @IsString()
  @Length(8, 500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}

export class Bulk194OExemptionItemDto {
  @IsString()
  @Length(1, 64)
  sellerId!: string;

  @IsBoolean()
  exempt!: boolean;

  @IsString()
  @Length(8, 500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}

// Phase 161 (#16) — bulk grant/revoke for annual revalidation.
export class BulkSet194OExemptionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => Bulk194OExemptionItemDto)
  items!: Bulk194OExemptionItemDto[];
}

// Phase 162 (Wallet Adjustments audit #9) — rejection reason is stored + shown
// in the admin UI; bound length + charset (defence-in-depth vs XSS).
export class RejectWalletAdjustmentDto {
  @IsString()
  @Length(4, 2000)
  // Block the XSS vector (angle brackets) but allow normal punctuation
  // (#, %, &, etc. are legitimate in a reason); the UI escapes on render too.
  @Matches(/^[^<>]*$/, { message: 'reason must not contain < or >' })
  reason!: string;
}

// Phase 162 (#12) — reverse a posted adjustment.
export class ReverseWalletAdjustmentDto {
  @IsString()
  @Length(8, 2000)
  @Matches(/^[^<>]*$/, { message: 'reason must not contain < or >' })
  reason!: string;
}

// Phase 164 (Credit Note Generation audit #12) — the override "reason" is
// persisted on the CN row + audit log. Bound length + block the XSS vector
// (angle brackets) while allowing normal punctuation (#, %, &, ₹ are
// legitimate). Optional: the admin may issue without a custom reason.
export class IssueCreditNoteOverrideDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(/^[^<>]*$/, { message: 'reason must not contain < or >' })
  reason?: string;
}

// Phase 160 (cancel/override audit #11) — cancel + regenerate an EWB.
export class ReplaceEwayBillDto {
  @IsString()
  @Length(10, 500)
  cancelReason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]{4,16}$/i)
  vehicleNumber?: string;

  @IsOptional()
  @IsIn(TRANSPORT_MODES as unknown as string[])
  transportMode?: (typeof TRANSPORT_MODES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 64)
  transporterId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  transporterName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  distanceKm?: number;
}

// Phase 160 (e-way-bill audit #18) — Part-B (transport details) update.
export class UpdateEwayBillPartBDto {
  @IsString()
  @Length(3, 200)
  reason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]{4,16}$/i)
  vehicleNumber?: string;

  @IsOptional()
  @IsIn(TRANSPORT_MODES as unknown as string[])
  transportMode?: (typeof TRANSPORT_MODES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 64)
  transporterId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  transporterName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  distanceKm?: number;
}

@ApiTags('Admin / Tax Ops')
@Controller('admin/tax')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminTaxOperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletAdj: WalletAdjustmentService,
    private readonly eway: EWayBillService,
    private readonly einvoice: EInvoiceService,
    private readonly creditNote: CreditNoteService,
    private readonly gstn: GstnVerificationService,
    private readonly audit: AuditPublicFacade,
    // Phase 161 (TDS 194-O exempt audit) — dedicated exemption lifecycle.
    private readonly tds194oExemption: Tds194OExemptionService,
  ) {}

  // ── Time-bar review queue (Phase 12) ──────────────────────────────

  @Get('timebar-review')
  @Permissions('tax.creditNote.timebarReview')
  async listTimebarReview(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (status) {
      where.creditNoteEligibilityStatus = status;
    } else {
      where.creditNoteEligibilityStatus = {
        in: ['TIME_BARRED', 'REQUIRES_FINANCE_REVIEW'],
      };
    }
    const items = await this.prisma.return.findMany({
      where,
      select: {
        id: true,
        returnNumber: true,
        customerId: true,
        subOrderId: true,
        refundAmountInPaise: true,
        creditNoteEligibilityStatus: true,
        creditNoteEligibilityCheckedAt: true,
        creditNoteTimeBarReason: true,
        financeReviewedBy: true,
        financeReviewedAt: true,
        qcCompletedAt: true,
      },
      orderBy: { creditNoteEligibilityCheckedAt: 'desc' },
      take: safeLimit,
    });
    return {
      success: true,
      message: 'Time-bar review queue',
      data: {
        items: items.map((r) => ({
          ...r,
          refundAmountInPaise: r.refundAmountInPaise?.toString() ?? '0',
        })),
      },
    };
  }

  // ── Credit-note register (Phase 164 #11) ──────────────────────────

  /**
   * Phase 164 (#11) — admin credit-note list. Previously there was NO admin
   * surface to see issued credit notes; the only CN touch-point was the
   * override buried in the timebar-review page. Filters: filingPeriod
   * (YYYY-MM on generatedAt), sellerId, returnId, status. Gated on
   * tax.creditNote.read (MEDIUM tier, #13). PII (buyer GSTIN, amounts) is
   * surfaced read-only; per-row PDF download stays on the existing
   * ownership-checked download path.
   */
  @Get('credit-notes')
  @Permissions('tax.creditNote.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listCreditNotes(
    @Query('filingPeriod') filingPeriod?: string,
    @Query('sellerId') sellerId?: string,
    @Query('returnId') returnId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = { documentType: 'CREDIT_NOTE' };
    if (sellerId) where.sellerId = sellerId;
    if (returnId) where.returnId = returnId;
    if (status) where.status = status;
    if (filingPeriod) {
      if (!/^\d{4}-\d{2}$/.test(filingPeriod)) {
        throw new HttpException(
          { success: false, code: 'INVALID_REQUEST', message: 'filingPeriod must be YYYY-MM' },
          HttpStatus.BAD_REQUEST,
        );
      }
      // IST month window: [1st 00:00 IST, next 1st 00:00 IST) → UTC bounds.
      const [y, m] = filingPeriod.split('-').map((v) => parseInt(v, 10));
      const IST = 5.5 * 60 * 60 * 1000;
      const startUtc = new Date(Date.UTC(y!, m! - 1, 1) - IST);
      const endUtc = new Date(Date.UTC(m! === 12 ? y! + 1 : y!, m! === 12 ? 0 : m!, 1) - IST);
      where.generatedAt = { gte: startUtc, lt: endUtc };
    }
    const rows = await this.prisma.taxDocument.findMany({
      where,
      select: {
        id: true,
        documentNumber: true,
        generatedAt: true,
        originalDocumentNumber: true,
        returnId: true,
        customerId: true,
        sellerId: true,
        buyerGstin: true,
        invoiceType: true,
        status: true,
        taxableAmountInPaise: true,
        totalTaxAmountInPaise: true,
        cessAmountInPaise: true,
        documentTotalInPaise: true,
        partialCoverageLineCount: true,
        customerNotifiedAt: true,
        reason: true,
      },
      orderBy: { generatedAt: 'desc' },
      take: safeLimit,
    });
    return {
      success: true,
      message: 'Credit notes',
      data: {
        items: rows.map((r) => ({
          ...r,
          taxableAmountInPaise: r.taxableAmountInPaise.toString(),
          totalTaxAmountInPaise: r.totalTaxAmountInPaise.toString(),
          cessAmountInPaise: r.cessAmountInPaise.toString(),
          documentTotalInPaise: r.documentTotalInPaise.toString(),
        })),
      },
    };
  }

  /** Force a wallet-adjustment routing on a finance-reviewed return. */
  @Post('timebar-review/:returnId/route-to-wallet')
  @Permissions('tax.creditNote.timebarOverride')
  async routeReturnToWallet(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: { reason?: string } = {},
  ) {
    try {
      const adjustment = await this.walletAdj.requestForTimeBarredReturn({
        returnId,
        reason: body.reason,
        requestedByAdminId: req.adminId ?? null,
      });
      // Mark finance review on the return row.
      await this.prisma.return
        .update({
          where: { id: returnId },
          data: {
            financeReviewedBy: req.adminId ?? 'unknown-admin',
            financeReviewedAt: new Date(),
          },
        })
        .catch(() => undefined);
      // Compliance audit — admin manually overrode the time-bar classification
      // and forced a wallet-adjustment refund route.
      await this.audit
        .writeAuditLog({
          actorId: req.adminId,
          actorRole: req.adminRole,
          action: 'tax.timebar.route_to_wallet_override',
          module: 'tax',
          resource: 'return',
          resourceId: returnId,
          metadata: { adjustmentId: adjustment.id, reason: body.reason ?? null },
        })
        .catch(() => undefined);
      return {
        success: true,
        message: 'Routed to wallet adjustment',
        data: {
          adjustmentId: adjustment.id,
          status: adjustment.status,
          amountInPaise: adjustment.amountInPaise.toString(),
        },
      };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error).message, code: 'ROUTE_FAILED' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Try the regular credit-note path (admin "I think this is still
   *  in window despite the cron flagging it" lever). */
  @Post('timebar-review/:returnId/issue-credit-note')
  @Permissions('tax.creditNote.create')
  // Phase 164 (#16) — bound the manual override rate (CRITICAL-tier action).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async issueCreditNoteOverride(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: IssueCreditNoteOverrideDto = {},
  ) {
    try {
      const result = await this.creditNote.generateForReturn(returnId, {
        actorId: req.adminId ?? null,
        reason: body.reason,
      });
      await this.prisma.return
        .update({
          where: { id: returnId },
          data: {
            financeReviewedBy: req.adminId ?? 'unknown-admin',
            financeReviewedAt: new Date(),
          },
        })
        .catch(() => undefined);
      // Compliance audit — admin manually forced the credit-note path despite
      // the time-bar flag ("still in window" override).
      await this.audit
        .writeAuditLog({
          actorId: req.adminId,
          actorRole: req.adminRole,
          action: 'tax.timebar.issue_credit_note_override',
          module: 'tax',
          resource: 'return',
          resourceId: returnId,
          metadata: {
            creditNoteId: result.creditNote.id,
            documentNumber: result.creditNote.documentNumber,
            reason: body.reason ?? null,
          },
        })
        .catch(() => undefined);
      return {
        success: true,
        message: result.isNew ? 'Credit note issued' : 'Existing credit note returned',
        data: {
          creditNoteId: result.creditNote.id,
          documentNumber: result.creditNote.documentNumber,
          totalInPaise: result.creditNote.documentTotalInPaise.toString(),
          sourceInvoiceStatus: result.sourceInvoice.statusAfter,
        },
      };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error).message, code: 'CREDIT_NOTE_FAILED' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Wallet adjustments queue (Phase 13) ───────────────────────────

  @Get('wallet-adjustments')
  @Permissions('wallet.adjustment.read')
  async listWalletAdjustments(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (status) where.status = status;
    const items = await this.prisma.walletAdjustment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return {
      success: true,
      message: 'Wallet adjustments',
      data: {
        items: items.map((a) => ({
          ...a,
          amountInPaise: a.amountInPaise.toString(),
          wouldHaveBeenTaxableInPaise: a.wouldHaveBeenTaxableInPaise?.toString() ?? null,
          wouldHaveBeenCgstInPaise: a.wouldHaveBeenCgstInPaise?.toString() ?? null,
          wouldHaveBeenSgstInPaise: a.wouldHaveBeenSgstInPaise?.toString() ?? null,
          wouldHaveBeenIgstInPaise: a.wouldHaveBeenIgstInPaise?.toString() ?? null,
          wouldHaveBeenTotalTaxInPaise: a.wouldHaveBeenTotalTaxInPaise?.toString() ?? null,
        })),
      },
    };
  }

  @Post('wallet-adjustments/:id/approve')
  @Permissions('wallet.adjustment.approve')
  // Phase 162 (#7) — bound approve rate so a compromised token can't drain the queue.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async approveWalletAdjustment(@Req() req: any, @Param('id') id: string) {
    // Phase 162 (#2) — a financial approval actor must be a real admin.
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const adj = await this.walletAdj.approve({
        adjustmentId: id,
        approvedByAdminId: req.adminId,
      });
      const message =
        adj.status === 'FIRST_APPROVED'
          ? 'First approval recorded — awaiting second approver'
          : 'Adjustment approved';
      return {
        success: true,
        message,
        data: {
          id: adj.id,
          status: adj.status,
          firstApprovedByAdminId: adj.firstApprovedByAdminId,
          firstApprovedAt: adj.firstApprovedAt,
          walletTransactionId: adj.walletTransactionId,
        },
      };
    } catch (err) {
      throw mapWalletAdjustmentError(err);
    }
  }

  @Post('wallet-adjustments/:id/reject')
  @Permissions('wallet.adjustment.reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async rejectWalletAdjustment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RejectWalletAdjustmentDto,
  ) {
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const adj = await this.walletAdj.reject({
        adjustmentId: id,
        rejectedByAdminId: req.adminId,
        rejectionReason: body.reason,
      });
      return {
        success: true,
        message: 'Adjustment rejected',
        data: { id: adj.id, status: adj.status },
      };
    } catch (err) {
      throw mapWalletAdjustmentError(err);
    }
  }

  // Phase 162 (Wallet Adjustments audit #12) — reverse a POSTED adjustment.
  @Post('wallet-adjustments/:id/reverse')
  @Permissions('wallet.adjustment.reverse')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reverseWalletAdjustment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReverseWalletAdjustmentDto,
  ) {
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const adj = await this.walletAdj.reverse({
        adjustmentId: id,
        reversedByAdminId: req.adminId,
        reason: body.reason,
      });
      return {
        success: true,
        message: 'Adjustment reversed',
        data: { id: adj.id, status: adj.status, reversingTransactionId: adj.reversingTransactionId },
      };
    } catch (err) {
      throw mapWalletAdjustmentError(err);
    }
  }

  // ── E-way bills (Phase 15) ────────────────────────────────────────

  @Get('eway-bills')
  @Permissions('tax.ewayBill.read')
  async listEwayBills(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (status) where.status = status;
    const items = await this.prisma.eWayBill.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return {
      success: true,
      message: 'E-way bills',
      data: {
        items: items.map((e) => ({
          ...e,
          consignmentValueInPaise: e.consignmentValueInPaise.toString(),
          rawRequestJson: undefined,  // large; drop for list view
          rawResponseJson: undefined,
        })),
      },
    };
  }

  @Post('eway-bills/sub-order/:subOrderId/generate')
  @Permissions('tax.ewayBill.generate')
  // Phase 89 (2026-05-23) — Gap #11. Network retry can double-call
  // NIC and mint two EWB numbers under one billable sub-order. The
  // idempotent decorator caches the response keyed on the request's
  // X-Idempotency-Key (24h TTL).
  @Idempotent()
  // Phase 160 (audit #14) — bound the NIC call rate per admin.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async generateEwayBill(
    @Param('subOrderId') subOrderId: string,
    @Body() body: GenerateEwayBillDto,
  ) {
    // Phase 89 — Gap #29. ROAD mode requires a vehicle number per
    // CBIC; AIR/RAIL/SHIP carry their own identifiers via
    // transporterId. Body-validation cap.
    if (
      (body.transportMode ?? 'ROAD') === 'ROAD' &&
      !body.vehicleNumber
    ) {
      throw new HttpException(
        {
          success: false,
          message: 'vehicleNumber is required when transportMode=ROAD',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const ewb = await this.eway.generate(subOrderId, {
        vehicleNumber: body.vehicleNumber ?? null,
        transporterId: body.transporterId ?? null,
        transporterName: body.transporterName ?? null,
        distanceKm: body.distanceKm ?? null,
        transportMode: body.transportMode,
      });
      return {
        success: true,
        message: 'EWB generated',
        data: {
          id: ewb.id,
          ewbNumber: ewb.ewbNumber,
          status: ewb.status,
          validUntil: ewb.validUntil,
          provider: ewb.provider,
        },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  @Post('eway-bills/:id/cancel')
  @Permissions('tax.ewayBill.cancel')
  @Idempotent()
  // Phase 160 (audit #14) — bound the NIC call rate per admin.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cancelEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CancelEwayBillDto,
  ) {
    try {
      const ewb = await this.eway.cancel({
        ewbId: id,
        cancelledBy: req.adminId ?? 'unknown-admin',
        reason: body.reason,
      });
      return {
        success: true,
        message: 'EWB cancelled',
        data: { id: ewb.id, status: ewb.status },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  @Post('eway-bills/:id/override')
  @Permissions('tax.ewayBill.override')
  @Idempotent()
  // Phase 160 (audit #14) — bound the NIC call rate per admin.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async overrideEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: OverrideEwayBillDto,
  ) {
    // Phase 160 (cancel/override audit #17) — dual-control gate for
    // HIGH-VALUE overrides. The base @Permissions('tax.ewayBill.override')
    // above lets routine ops bypass the EWB for low-value consignments; a
    // ship-without-EWB on a >₹2L consignment is the highest-blast-radius
    // action in this flow and additionally requires the elevated
    // `tax.ewayBill.override.superAdmin` permission (SUPER_ADMIN-only). This
    // layers on the service-side separation-of-duty (override actor must
    // differ from the classifier/generator), so a high-value bypass can
    // never be done unilaterally by a single routine override-holder.
    //
    // Read the value BEFORE the mutation. A missing row falls through to the
    // service, which throws EWayBillNotFoundError → 404 (preserving the
    // not-found semantics rather than leaking it as a 403).
    const target = await this.prisma.eWayBill.findUnique({
      where: { id },
      select: { consignmentValueInPaise: true },
    });
    if (
      target &&
      target.consignmentValueInPaise >
        BigInt(EWayBillService.OVERRIDE_HIGH_VALUE_PAISE)
    ) {
      const perms: string[] = req?.user?.permissions ?? [];
      if (!perms.includes('tax.ewayBill.override.superAdmin')) {
        // Compliance signal — a high-value bypass was attempted without
        // the elevated grant. Best-effort; never blocks the 403.
        await this.audit
          .writeAuditLog({
            actorId: req.adminId,
            actorRole: req.adminRole,
            action: 'tax.ewayBill.override.denied_high_value',
            module: 'tax',
            resource: 'eway_bill',
            resourceId: id,
            metadata: {
              consignmentValueInPaise: target.consignmentValueInPaise.toString(),
              thresholdInPaise: String(EWayBillService.OVERRIDE_HIGH_VALUE_PAISE),
              reasonCategory: body.reasonCategory,
            },
          })
          .catch(() => undefined);
        throw new HttpException(
          {
            success: false,
            message:
              'High-value e-way-bill overrides (consignment > ₹2,00,000) require ' +
              'the elevated tax.ewayBill.override.superAdmin permission. Escalate to a Super Admin.',
            code: 'SUPER_ADMIN_REQUIRED',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }
    try {
      const ewb = await this.eway.adminOverride({
        ewbId: id,
        adminId: req.adminId ?? 'unknown-admin',
        reason: body.reason,
        reasonCategory: body.reasonCategory,
      });
      return {
        success: true,
        message: 'EWB override stamped',
        data: {
          id: ewb.id,
          status: ewb.status,
          overrideAdminId: ewb.overrideAdminId,
          overrideAt: ewb.overrideAt,
          overrideReasonCategory: ewb.overrideReasonCategory,
        },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  /**
   * Phase 89 (2026-05-23) — Gap #7 revoke endpoint. Returns an
   * OVERRIDDEN row back to REQUIRED. Senior-ops permission gate.
   */
  @Post('eway-bills/:id/override/revoke')
  @Permissions('tax.ewayBill.override')
  @Idempotent()
  // Phase 160 (audit #14) — bound the NIC call rate per admin.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async revokeOverrideEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RevokeOverrideEwayBillDto,
  ) {
    try {
      const ewb = await this.eway.revokeOverride({
        ewbId: id,
        adminId: req.adminId ?? 'unknown-admin',
        reason: body.reason,
      });
      return {
        success: true,
        message: 'EWB override revoked',
        data: {
          id: ewb.id,
          status: ewb.status,
          overrideRevokedAt: ewb.overrideRevokedAt,
          overrideRevokedBy: ewb.overrideRevokedBy,
        },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  /**
   * Phase 160 (e-way-bill audit #18) — update Part-B (transport details) on
   * an issued EWB WITHOUT cancelling (vehicle change / trans-shipment). NIC
   * re-issues the validity. Gated on tax.ewayBill.generate (EWB management).
   */
  @Post('eway-bills/:id/update-part-b')
  @Permissions('tax.ewayBill.generate')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateEwayBillPartB(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateEwayBillPartBDto,
  ) {
    // ROAD-without-vehicle is re-validated in the service against the
    // persisted value (admin may keep the existing vehicle + change only
    // the distance/transporter).
    try {
      const ewb = await this.eway.updateTransportDetails({
        ewbId: id,
        actorId: req.adminId ?? 'unknown-admin',
        reason: body.reason,
        transportMode: body.transportMode,
        vehicleNumber: body.vehicleNumber,
        transporterId: body.transporterId,
        transporterName: body.transporterName,
        distanceKm: body.distanceKm,
      });
      return {
        success: true,
        message: 'EWB Part-B updated',
        data: {
          id: ewb.id,
          status: ewb.status,
          vehicleNumber: ewb.vehicleNumber,
          transportMode: ewb.transportMode,
          validUntil: ewb.validUntil,
        },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  /**
   * Phase 160 (cancel/override audit #11) — replace an EWB: cancel the
   * existing one + generate a fresh one for the same sub-order, linked via
   * replacedEwayBillId. For corrections beyond a Part-B update (e.g. wrong
   * consignment / document). Gated on tax.ewayBill.generate.
   */
  @Post('eway-bills/:id/replace')
  @Permissions('tax.ewayBill.generate')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async replaceEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReplaceEwayBillDto,
  ) {
    try {
      const fresh = await this.eway.replaceEwayBill({
        ewbId: id,
        actorId: req.adminId ?? 'unknown-admin',
        cancelReason: body.cancelReason,
        transport: {
          vehicleNumber: body.vehicleNumber ?? null,
          transporterId: body.transporterId ?? null,
          transporterName: body.transporterName ?? null,
          distanceKm: body.distanceKm ?? null,
          transportMode: body.transportMode,
        },
      });
      return {
        success: true,
        message: 'EWB replaced',
        data: {
          id: fresh.id,
          ewbNumber: fresh.ewbNumber,
          status: fresh.status,
          replacedEwayBillId: fresh.replacedEwayBillId,
          validUntil: fresh.validUntil,
        },
      };
    } catch (err) {
      throw mapEwayBillError(err);
    }
  }

  // ── E-invoices / IRN (Phase 22) ───────────────────────────────────

  @Get('einvoices')
  @Permissions('tax.einvoice.manage')
  async listEinvoices(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {
      // Always restrict to documents that COULD have an IRN — skip
      // BILL_OF_SUPPLY / LEGACY_RECEIPT which are out-of-scope.
      documentType: {
        in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE'],
      },
    };
    if (status) where.einvoiceStatus = status;
    const items = await this.prisma.taxDocument.findMany({
      where,
      select: {
        id: true,
        documentNumber: true,
        documentType: true,
        documentTotalInPaise: true,
        einvoiceStatus: true,
        einvoiceProvider: true,
        einvoiceRetryCount: true,
        einvoiceLastAttemptedAt: true,
        einvoiceFailureReason: true,
        irn: true,
        ackNo: true,
        ackDate: true,
        supplierGstin: true,
        buyerGstin: true,
        generatedAt: true,
      },
      orderBy: { generatedAt: 'desc' },
      take: safeLimit,
    });
    return {
      success: true,
      message: 'E-invoices',
      data: {
        items: items.map((d) => ({
          ...d,
          documentTotalInPaise: d.documentTotalInPaise.toString(),
        })),
      },
    };
  }

  @Post('einvoices/:documentId/generate')
  @Permissions('tax.einvoice.manage')
  // Phase 90 (2026-05-23) — Gap #6. @Idempotent caches the response
  // keyed on the X-Idempotency-Key header (24h TTL) so a network
  // retry doesn't double-call NIC.
  @Idempotent()
  // Phase 160 (audit #10) — bound the manual-generate rate so an admin
  // flood can't blow NIC's ~100/min IRP credentials limit.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async generateEinvoice(
    @Req() req: any,
    @Param('documentId') documentId: string,
  ) {
    try {
      const doc = await this.einvoice.generateForDocument(documentId, {
        actorId: req.adminId ?? 'unknown-admin',
        actorRole: 'ADMIN',
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
      });
      return {
        success: true,
        message: 'IRN minted',
        data: {
          id: doc.id,
          irn: doc.irn,
          ackNo: doc.ackNo,
          einvoiceStatus: doc.einvoiceStatus,
        },
      };
    } catch (err) {
      throw mapEinvoiceError(err);
    }
  }

  @Post('einvoices/:documentId/cancel')
  @Permissions('tax.einvoice.cancelWithinWindow')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cancelEinvoice(
    @Req() req: any,
    @Param('documentId') documentId: string,
    @Body() body: CancelEinvoiceDto,
  ) {
    try {
      const doc = await this.einvoice.cancelForDocument({
        documentId,
        cancellationCode: body.cancellationCode,
        cancellationReason: body.reason,
        actorId: req.adminId,
      });
      return {
        success: true,
        message: 'IRN cancelled',
        data: { id: doc.id, einvoiceStatus: doc.einvoiceStatus },
      };
    } catch (err) {
      throw mapEinvoiceError(err);
    }
  }

  /**
   * Phase 90 (2026-05-23) — Gap #18. Reset einvoiceRetryCount on a
   * FAILED row so the retry cron picks it back up. Used when NIC
   * outage clears after the cap was hit.
   */
  @Post('einvoices/:documentId/reset-retry')
  @Permissions('tax.einvoice.manage')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resetEinvoiceRetry(
    @Req() req: any,
    @Param('documentId') documentId: string,
    @Body() body: ResetEinvoiceRetryDto,
  ) {
    try {
      const doc = await this.einvoice.resetRetryCount({
        documentId,
        actorId: req.adminId ?? 'unknown-admin',
        reason: body.reason,
      });
      return {
        success: true,
        message: 'Retry counter reset',
        data: {
          id: doc.id,
          einvoiceStatus: doc.einvoiceStatus,
          einvoiceRetryCount: doc.einvoiceRetryCount,
        },
      };
    } catch (err) {
      throw mapEinvoiceError(err);
    }
  }

  // ── GSTN portal verification (Phase 35) ──────────────────────────
  //
  // List + verify endpoints for both target shapes. List is paginated
  // + filterable by verification state so the admin queue surfaces
  // unverified rows first.

  @Get('seller-gstins')
  @Permissions('tax.gstn.verify')
  async listSellerGstins(
    @Query('verified') verified?: string,
    @Query('mismatch') mismatch?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    // Phase 161 (#16) — filter on the authoritative isVerified column, NOT
    // verifiedAt (which under the old logic was set even on a FAILED check).
    if (verified === 'true') where.isVerified = true;
    if (verified === 'false') where.isVerified = false;
    // Phase 161 (#17) — KYC triage: legal-name mismatches.
    if (mismatch === 'true') where.legalNameMismatch = true;
    const rows = await this.prisma.sellerGstin.findMany({
      where,
      orderBy: [{ isVerified: 'asc' }, { createdAt: 'desc' }],
      take: safeLimit,
      include: {
        seller: { select: { id: true, sellerShopName: true, sellerName: true } },
      },
    });
    return {
      success: true,
      message: 'Seller GSTINs retrieved',
      data: { items: rows },
    };
  }

  @Get('customer-tax-profiles')
  @Permissions('tax.gstn.verify')
  async listCustomerTaxProfiles(
    @Query('verified') verified?: string,
    @Query('mismatch') mismatch?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (verified === 'true') where.isVerified = true;
    if (verified === 'false') where.isVerified = false;
    // Phase 161 (#17) — KYC triage: legal-name mismatches.
    if (mismatch === 'true') where.legalNameMismatch = true;
    const rows = await this.prisma.customerTaxProfile.findMany({
      where,
      orderBy: [{ isVerified: 'asc' }, { createdAt: 'desc' }],
      take: safeLimit,
      include: {
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return {
      success: true,
      message: 'Customer tax profiles retrieved',
      data: { items: rows },
    };
  }

  // Phase 161 (Customer Tax Profile audit #9) — fraud-signal report: GSTINs
  // saved on more than `threshold` (default 2) distinct customer accounts
  // (possible account-takeover / GSTIN-abuse). Read-only aggregate.
  @Get('customer-tax-profiles/shared-gstins')
  @Permissions('tax.gstn.verify')
  async listSharedCustomerGstins(@Query('threshold') threshold?: string) {
    const t = Math.max(2, parseInt(threshold ?? '2', 10) || 2);
    const grouped = await this.prisma.customerTaxProfile.groupBy({
      by: ['gstin'],
      _count: { customerId: true },
      having: { customerId: { _count: { gt: t - 1 } } },
      orderBy: { _count: { customerId: 'desc' } },
      take: 200,
    });
    return {
      success: true,
      message: 'GSTINs shared across multiple customer accounts',
      data: {
        threshold: t,
        items: grouped.map((g) => ({
          gstin: g.gstin,
          customerCount: g._count.customerId,
        })),
      },
    };
  }

  // (verify endpoints below)

  //
  // Two endpoints — one per target row type. Both run via the active
  // GSTN_PROVIDER (stub today, sandbox once wired). The provider
  // contract returns `found / status / legalName`; the service
  // persists those onto the row + a verification note with the
  // timestamp + provider name. Idempotent — re-running refreshes
  // the timestamp and appends a fresh note line.

  @Post('seller-gstins/:id/verify')
  @Permissions('tax.gstn.verify')
  // Phase 161 (#10) — bound the GSTN provider call rate per admin.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verifySellerGstin(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: VerifyGstinDto = {},
  ) {
    // Phase 161 (#7) — a verification's actor is written to verifiedBy as a
    // compliance signal; refuse rather than stamp the literal 'unknown-admin'.
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const result = await this.gstn.verifySellerGstin({
        sellerGstinId: id,
        actorId: req.adminId,
        force: body?.force,
        ipAddress: req.ip ?? req.headers?.['x-forwarded-for'] ?? null,
      });
      return {
        success: true,
        message: result.verified
          ? 'Seller GSTIN verified'
          : 'Seller GSTIN check completed (not verified)',
        data: result,
      };
    } catch (err) {
      if (err instanceof SellerGstinNotFoundError) {
        throw new HttpException(
          { success: false, message: err.message, code: 'NOT_FOUND' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        {
          success: false,
          message: (err as Error)?.message ?? 'failed',
          code: 'INTERNAL_ERROR',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('customer-tax-profiles/:id/verify')
  @Permissions('tax.gstn.verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verifyCustomerTaxProfile(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: VerifyGstinDto = {},
  ) {
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const result = await this.gstn.verifyCustomerTaxProfile({
        profileId: id,
        actorId: req.adminId,
        force: body?.force,
        ipAddress: req.ip ?? req.headers?.['x-forwarded-for'] ?? null,
      });
      return {
        success: true,
        message: result.verified
          ? 'Customer tax profile verified'
          : 'Customer tax profile check completed (not verified)',
        data: result,
      };
    } catch (err) {
      if (err instanceof CustomerTaxProfileNotFoundError) {
        throw new HttpException(
          { success: false, message: err.message, code: 'NOT_FOUND' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        {
          success: false,
          message: (err as Error)?.message ?? 'failed',
          code: 'INTERNAL_ERROR',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Section 194-O exemption attestation (Phase 27) ──────────────
  //
  // Admin attests that a seller's projected annual gross stays below
  // the ₹5L threshold AND they're individual/HUF with verified PAN/
  // Aadhaar. Flipping is194OExempt=true tells Tds194OService.compute
  // ForSeller to skip persisting a TDS row for them. Flipping false
  // re-arms TDS deduction from the next settlement cycle.

  // Phase 161 (audit B1–B4, #5/#6/#8/#9/#11/#12/#17) — the exemption lifecycle
  // now lives in Tds194OExemptionService (effective-dating, history, audit,
  // events, revoke-without-history-loss). §194-O ONLY — not §52 TCS / §194H.
  @Post('sellers/:id/194o-exempt')
  @Permissions('tax.tds194o.exempt') // B2 — dedicated perm (was tax.gstn.verify)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // #12
  async setSellerTds194OExemption(
    @Req() req: any,
    @Param('id') sellerId: string,
    @Body() body: SetSeller194OExemptionDto,
  ) {
    if (!req.adminId) {
      // #8 — never stamp the literal 'unknown-admin' on a tax-decision actor.
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const ipAddress = req.ip ?? req.headers?.['x-forwarded-for'] ?? null;
    try {
      const data = body.exempt
        ? await this.tds194oExemption.grant({
            sellerId,
            reason: body.reason,
            effectiveFrom: body.effectiveFrom,
            effectiveTo: body.effectiveTo,
            actorId: req.adminId,
            ipAddress,
          })
        : await this.tds194oExemption.revoke({
            sellerId,
            reason: body.reason,
            actorId: req.adminId,
            ipAddress,
          });
      return {
        success: true,
        message: body.exempt ? 'Seller marked 194-O exempt' : 'Seller 194-O exemption revoked',
        data,
      };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error)?.message ?? 'failed', code: 'EXEMPTION_FAILED' },
        (err as any)?.status ?? HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Phase 161 (#16) — bulk grant/revoke for annual revalidation.
  @Post('sellers/194o-exempt/bulk')
  @Permissions('tax.tds194o.exempt')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async bulkSetSeller194OExemption(@Req() req: any, @Body() body: BulkSet194OExemptionDto) {
    if (!req.adminId) {
      throw new HttpException(
        { success: false, message: 'Authenticated admin required', code: 'UNAUTHENTICATED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.tds194oExemption.bulk({
      actorId: req.adminId,
      ipAddress: req.ip ?? req.headers?.['x-forwarded-for'] ?? null,
      items: body.items,
    });
    return { success: true, message: 'Bulk 194-O exemption applied', data: result };
  }
}

// ── Error mappers ────────────────────────────────────────────────────

function mapWalletAdjustmentError(err: unknown): HttpException {
  if (err instanceof WalletAdjustmentNotFoundError) {
    return new HttpException(
      { success: false, message: err.message, code: 'NOT_FOUND' },
      HttpStatus.NOT_FOUND,
    );
  }
  if (err instanceof WalletAdjustmentNotApprovableError) {
    return new HttpException(
      { success: false, message: err.message, code: 'INVALID_TRANSITION' },
      HttpStatus.CONFLICT,
    );
  }
  if (err instanceof WalletAdjustmentSelfApprovalError) {
    return new HttpException(
      { success: false, message: err.message, code: 'REQUESTER_CANNOT_APPROVE' },
      HttpStatus.FORBIDDEN,
    );
  }
  if (err instanceof WalletAdjustmentDuplicateApproverError) {
    return new HttpException(
      { success: false, message: err.message, code: 'DUPLICATE_APPROVER' },
      HttpStatus.FORBIDDEN,
    );
  }
  if (err instanceof WalletAdjustmentFirstApproverRoleError) {
    return new HttpException(
      { success: false, message: err.message, code: 'FIRST_APPROVER_ROLE_REQUIRED' },
      HttpStatus.FORBIDDEN,
    );
  }
  if (err instanceof WalletAdjustmentSecondApproverRoleError) {
    return new HttpException(
      { success: false, message: err.message, code: 'SECOND_APPROVER_ROLE_REQUIRED' },
      HttpStatus.FORBIDDEN,
    );
  }
  return new HttpException(
    { success: false, message: (err as Error)?.message ?? 'failed', code: 'INTERNAL_ERROR' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function mapEwayBillError(err: unknown): HttpException {
  if (err instanceof EWayBillNotFoundError) {
    return new HttpException(
      { success: false, message: err.message, code: 'NOT_FOUND' },
      HttpStatus.NOT_FOUND,
    );
  }
  if (err instanceof EWayBillCancellationWindowClosedError) {
    return new HttpException(
      { success: false, message: err.message, code: 'WINDOW_CLOSED' },
      HttpStatus.CONFLICT,
    );
  }
  if (err instanceof EWayBillNotEligibleError) {
    return new HttpException(
      { success: false, message: err.message, code: 'INVALID_TRANSITION' },
      HttpStatus.CONFLICT,
    );
  }
  // Phase 160 (audit B4) — kill switch is off.
  if (err instanceof EWayBillDisabledError) {
    return new HttpException(
      { success: false, message: err.message, code: 'EWAY_BILL_DISABLED' },
      HttpStatus.CONFLICT,
    );
  }
  // Phase 160 (audit #11) — map NIC's typed failure modes to the right HTTP
  // status instead of collapsing every provider error to 500.
  if (err instanceof EWayBillProviderError) {
    const httpByCategory: Record<string, HttpStatus> = {
      AUTH: HttpStatus.BAD_GATEWAY, // 502 — our NIC token problem
      RATE_LIMIT: HttpStatus.TOO_MANY_REQUESTS, // 429
      PERMANENT: HttpStatus.BAD_REQUEST, // 400 — bad payload (invalid GSTIN/vehicle)
      TRANSIENT: HttpStatus.SERVICE_UNAVAILABLE, // 503 — retryable NIC 5xx/network
    };
    return new HttpException(
      {
        success: false,
        message: err.message,
        code: `NIC_${err.category}`,
        nicErrorCode: err.opts.nicErrorCode ?? null,
        retryable: err.retryable,
      },
      httpByCategory[err.category] ?? HttpStatus.BAD_GATEWAY,
    );
  }
  return new HttpException(
    { success: false, message: (err as Error)?.message ?? 'failed', code: 'INTERNAL_ERROR' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function mapEinvoiceError(err: unknown): HttpException {
  if (err instanceof EInvoiceDocumentNotFoundError) {
    return new HttpException(
      { success: false, message: err.message, code: 'NOT_FOUND' },
      HttpStatus.NOT_FOUND,
    );
  }
  if (err instanceof EInvoiceCancellationWindowClosedError) {
    return new HttpException(
      { success: false, message: err.message, code: 'WINDOW_CLOSED' },
      HttpStatus.CONFLICT,
    );
  }
  if (err instanceof EInvoiceNotApplicableError) {
    return new HttpException(
      { success: false, message: err.message, code: 'NOT_APPLICABLE' },
      HttpStatus.CONFLICT,
    );
  }
  // Phase 160 (audit #2) — kill switch is off.
  if (err instanceof EInvoiceDisabledError) {
    return new HttpException(
      { success: false, message: err.message, code: 'EINVOICE_DISABLED' },
      HttpStatus.CONFLICT,
    );
  }
  // Phase 160 (audit #8) — map NIC's typed failure modes to the right HTTP
  // status + code instead of collapsing every IRP error to a 500.
  if (err instanceof EInvoiceProviderError) {
    const httpByCategory: Record<string, HttpStatus> = {
      AUTH: HttpStatus.BAD_GATEWAY, // 502 — our NIC token problem, not the client's
      RATE_LIMIT: HttpStatus.TOO_MANY_REQUESTS, // 429
      DUPLICATE: HttpStatus.CONFLICT, // 409 — already registered at NIC
      PERMANENT: HttpStatus.BAD_REQUEST, // 400 — bad payload (e.g. NIC 2253)
      TRANSIENT: HttpStatus.SERVICE_UNAVAILABLE, // 503 — retryable NIC 5xx/network
    };
    return new HttpException(
      {
        success: false,
        message: err.message,
        code: `NIC_${err.category}`,
        nicErrorCode: err.opts.nicErrorCode ?? null,
        retryable: err.retryable,
      },
      httpByCategory[err.category] ?? HttpStatus.BAD_GATEWAY,
    );
  }
  return new HttpException(
    { success: false, message: (err as Error)?.message ?? 'failed', code: 'INTERNAL_ERROR' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
