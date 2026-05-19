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
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
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
} from '../../application/services/eway-bill.service';
import {
  EInvoiceService,
  EInvoiceCancellationWindowClosedError,
  EInvoiceNotApplicableError,
  EInvoiceDocumentNotFoundError,
} from '../../application/services/einvoice.service';
import { CreditNoteService } from '../../application/services/credit-note.service';
import {
  GstnVerificationService,
  SellerGstinNotFoundError,
  CustomerTaxProfileNotFoundError,
} from '../../application/services/gstn-verification.service';

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
  async issueCreditNoteOverride(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: { reason?: string } = {},
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
  async approveWalletAdjustment(@Req() req: any, @Param('id') id: string) {
    try {
      const adj = await this.walletAdj.approve({
        adjustmentId: id,
        approvedByAdminId: req.adminId ?? 'unknown-admin',
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
  async rejectWalletAdjustment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason) {
      throw new HttpException(
        { success: false, message: 'reason required', code: 'INVALID_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const adj = await this.walletAdj.reject({
        adjustmentId: id,
        rejectedByAdminId: req.adminId ?? 'unknown-admin',
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
  async generateEwayBill(
    @Param('subOrderId') subOrderId: string,
    @Body()
    body: {
      vehicleNumber?: string;
      transporterId?: string;
      transporterName?: string;
      distanceKm?: number;
      transportMode?: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
    } = {},
  ) {
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
  async cancelEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason) {
      throw new HttpException(
        { success: false, message: 'reason required', code: 'INVALID_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }
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
  async overrideEwayBill(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason) {
      throw new HttpException(
        { success: false, message: 'reason required', code: 'INVALID_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const ewb = await this.eway.adminOverride({
        ewbId: id,
        adminId: req.adminId ?? 'unknown-admin',
        reason: body.reason,
      });
      return {
        success: true,
        message: 'EWB override stamped',
        data: {
          id: ewb.id,
          overrideAdminId: ewb.overrideAdminId,
          overrideAt: ewb.overrideAt,
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
  async generateEinvoice(@Param('documentId') documentId: string) {
    try {
      const doc = await this.einvoice.generateForDocument(documentId);
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
  async cancelEinvoice(
    @Req() req: any,
    @Param('documentId') documentId: string,
    @Body() body: { cancellationCode: number; reason: string },
  ) {
    if (!body?.reason || !body?.cancellationCode) {
      throw new HttpException(
        {
          success: false,
          message: 'cancellationCode + reason required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
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

  // ── GSTN portal verification (Phase 35) ──────────────────────────
  //
  // List + verify endpoints for both target shapes. List is paginated
  // + filterable by verification state so the admin queue surfaces
  // unverified rows first.

  @Get('seller-gstins')
  @Permissions('tax.gstn.verify')
  async listSellerGstins(
    @Query('verified') verified?: string,
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (verified === 'true') where.verifiedAt = { not: null };
    if (verified === 'false') where.verifiedAt = null;
    const rows = await this.prisma.sellerGstin.findMany({
      where,
      orderBy: [{ verifiedAt: 'asc' }, { createdAt: 'desc' }],
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
    @Query('limit') limit?: string,
  ) {
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const where: any = {};
    if (verified === 'true') where.isVerified = true;
    if (verified === 'false') where.isVerified = false;
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
  async verifySellerGstin(@Req() req: any, @Param('id') id: string) {
    try {
      const result = await this.gstn.verifySellerGstin({
        sellerGstinId: id,
        actorId: req.adminId ?? 'unknown-admin',
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
  async verifyCustomerTaxProfile(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    try {
      const result = await this.gstn.verifyCustomerTaxProfile({
        profileId: id,
        actorId: req.adminId ?? 'unknown-admin',
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

  @Post('sellers/:id/194o-exempt')
  @Permissions('tax.gstn.verify')
  async setSellerTds194OExemption(
    @Req() req: any,
    @Param('id') sellerId: string,
    @Body() body: { exempt: boolean; reason?: string },
  ) {
    if (typeof body?.exempt !== 'boolean') {
      throw new HttpException(
        { success: false, message: 'exempt (boolean) required', code: 'INVALID_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const adminId = req.adminId ?? 'unknown-admin';
    const seller = await (this.prisma as any).seller.update({
      where: { id: sellerId },
      data: {
        is194OExempt: body.exempt,
        exempt194OReason: body.exempt ? body.reason ?? null : null,
        exempt194OAttestedBy: body.exempt ? adminId : null,
        exempt194OAttestedAt: body.exempt ? new Date() : null,
      },
      select: {
        id: true,
        is194OExempt: true,
        exempt194OReason: true,
        exempt194OAttestedBy: true,
        exempt194OAttestedAt: true,
      },
    });
    return {
      success: true,
      message: body.exempt
        ? 'Seller marked 194-O exempt'
        : 'Seller 194-O exemption cleared',
      data: seller,
    };
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
  return new HttpException(
    { success: false, message: (err as Error)?.message ?? 'failed', code: 'INTERNAL_ERROR' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
