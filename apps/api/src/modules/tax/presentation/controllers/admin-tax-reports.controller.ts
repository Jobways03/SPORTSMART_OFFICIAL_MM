// Phase 25 GST — Admin-facing tax reports + audit-readiness API.
//
// Aggregates the per-service surfaces built in Phases 16–23 into HTTP
// endpoints the Super Admin dashboard calls.
//
// Auth: AdminAuthGuard + PermissionsGuard + @Permissions(...). Every
// endpoint gates on a specific tax.* permission key declared in
// `core/authorization/permission-registry.ts` so a non-finance admin
// (SELLER_SUPPORT, AFFILIATE_ADMIN, etc.) cannot pull GSTR exports or
// flip TCS lifecycle rows.

import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Gstr1ReportService } from '../../application/services/gstr1-report.service';
import { Gstr3bReportService } from '../../application/services/gstr3b-report.service';
import { Gstr8ReportService } from '../../application/services/gstr8-report.service';
import { TaxAuditReadinessService } from '../../application/services/tax-audit-readiness.service';
import { TaxModeService } from '../../application/services/tax-mode.service';
import { TcsService } from '../../application/services/tcs.service';
import { Tds194OService } from '../../application/services/tds-194o.service';
import { Form26QReportService } from '../../application/services/form-26q-report.service';
import { MarketplaceCommissionGstrService } from '../../application/services/marketplace-commission-gstr.service';
// Phase 36 — every GSTR export carries seller-level PII (legal names,
// GSTINs, taxable values). The audit row captures who downloaded
// which report for which (seller, period), with IP + UA, so a
// data-exfiltration investigation has a single-table read path.
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

@ApiTags('Admin / Tax')
@Controller('admin/tax')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminTaxReportsController {
  constructor(
    private readonly readiness: TaxAuditReadinessService,
    private readonly mode: TaxModeService,
    private readonly gstr1: Gstr1ReportService,
    private readonly gstr3b: Gstr3bReportService,
    private readonly gstr8: Gstr8ReportService,
    private readonly tcs: TcsService,
    private readonly tds: Tds194OService,
    private readonly form26q: Form26QReportService,
    private readonly marketplaceCommissionGstr: MarketplaceCommissionGstrService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Phase 36 — log a tax-report export to the audit ledger. Non-
   * throwing: an audit-write failure must not block the download
   * (the response is already being streamed). Errors are swallowed
   * with a console.warn — the alternative (failing the download)
   * is worse for ops than missing one audit row.
   *
   * resourceId encodes (sellerId | 'platform') + filingPeriod so
   * audit-history searches by resource can filter to "all exports
   * for seller X in period Y" cheaply.
   */
  private async logReportDownload(
    req: any,
    args: {
      resource: string;
      sellerId?: string | null;
      filingPeriod: string;
      format: 'csv' | 'json' | 'summary';
      bytes: number;
      section?: string;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    const resourceId = `${args.sellerId ?? 'platform'}:${args.filingPeriod}`;
    try {
      await this.audit.writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'tax.report.exported',
        module: 'tax',
        resource: args.resource,
        resourceId,
        metadata: {
          sellerId: args.sellerId ?? null,
          filingPeriod: args.filingPeriod,
          format: args.format,
          section: args.section ?? null,
          byteSize: args.bytes,
          ...(args.extra ?? {}),
        },
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
        userAgent: req?.headers?.['user-agent'] ?? null,
      });
    } catch {
      // never fail the download on an audit-write blip
    }
  }

  // ── Mode + readiness ────────────────────────────────────────────

  @Get('mode')
  @Permissions('tax.reports.read')
  async getMode() {
    const mode = await this.mode.getMode();
    return { success: true, message: 'Tax mode retrieved', data: { mode } };
  }

  @Post('mode')
  @Permissions('tax.configure')
  async setMode(
    @Req() req: any,
    @Body() body: { mode: 'OFF' | 'AUDIT' | 'STRICT' },
  ) {
    const allowed: ReadonlyArray<'OFF' | 'AUDIT' | 'STRICT'> = ['OFF', 'AUDIT', 'STRICT'];
    if (!body?.mode || !allowed.includes(body.mode)) {
      throw new HttpException(
        { success: false, message: 'mode must be OFF, AUDIT, or STRICT', code: 'INVALID_MODE' },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.mode.setMode(body.mode, req.adminId ?? null);
    return {
      success: true,
      message: `Tax mode set to ${body.mode}`,
      data: { mode: body.mode },
    };
  }

  @Get('audit-readiness')
  @Permissions('tax.reports.read')
  async auditReadiness() {
    const report = await this.readiness.build();
    return {
      success: true,
      message: 'Audit readiness report built',
      data: serialiseBigInt(report),
    };
  }

  // ── GSTR-1 ──────────────────────────────────────────────────────

  /** §4 B2B CSV. */
  @Get('reports/gstr1.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr1B2bCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    const csv = await this.gstr1.generateB2bCsv({
      sellerId: sellerId!,
      filingPeriod: filingPeriod!,
    });
    setCsvDownloadHeaders(
      res,
      `gstr1-b2b-${sellerId}-${filingPeriod}.csv`,
    );
    await this.logReportDownload(req, {
      resource: 'gstr1.b2b',
      sellerId,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
    });
    res.send(csv);
  }

  /** §5 B2C Large / §7 B2C Small / §9B Credit Notes / §12 HSN / §13 Docs Issued. */
  @Get('reports/gstr1/:section.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr1SectionCsv(
    @Req() req: any,
    @Res() res: Response,
    @Param('section') section: string,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    const args = { sellerId: sellerId!, filingPeriod: filingPeriod! };
    let csv: string;
    switch (section) {
      case 'b2c-large':
      case 'section5':
        csv = await this.gstr1.generateB2cLargeCsv(args);
        break;
      case 'b2c-small':
      case 'section7':
        csv = await this.gstr1.generateB2cSmallCsv(args);
        break;
      case 'credit-notes':
      case 'section9b':
        csv = await this.gstr1.generateCreditNoteCsv(args);
        break;
      case 'hsn':
      case 'section12':
        csv = await this.gstr1.generateHsnSummaryCsv(args);
        break;
      case 'docs-issued':
      case 'section13':
        csv = await this.gstr1.generateDocumentsIssuedCsv(args);
        break;
      default:
        throw new HttpException(
          {
            success: false,
            message: `Unknown GSTR-1 section: ${section}`,
            code: 'INVALID_SECTION',
          },
          HttpStatus.BAD_REQUEST,
        );
    }
    setCsvDownloadHeaders(
      res,
      `gstr1-${section}-${sellerId}-${filingPeriod}.csv`,
    );
    await this.logReportDownload(req, {
      resource: 'gstr1.section',
      sellerId,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
      section,
    });
    res.send(csv);
  }

  // ── GSTR-3B ─────────────────────────────────────────────────────

  @Get('reports/gstr3b.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr3bCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    const csv = await this.gstr3b.generateCsv({
      sellerId: sellerId!,
      filingPeriod: filingPeriod!,
    });
    setCsvDownloadHeaders(
      res,
      `gstr3b-${sellerId}-${filingPeriod}.csv`,
    );
    await this.logReportDownload(req, {
      resource: 'gstr3b',
      sellerId,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
    });
    res.send(csv);
  }

  // ── GSTR-8 (platform-side TCS) ──────────────────────────────────

  @Get('reports/gstr8.csv')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr8Csv(
    @Req() req: any,
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertPeriod(filingPeriod);
    const csv = await this.gstr8.generateCsv(filingPeriod!);
    setCsvDownloadHeaders(res, `gstr8-${filingPeriod}.csv`);
    await this.logReportDownload(req, {
      resource: 'gstr8',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
    });
    res.send(csv);
  }

  @Get('reports/gstr8.json')
  @Permissions('tax.tcs.export')
  async gstr8Json(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('operatorGstin') operatorGstin?: string,
  ) {
    assertPeriod(filingPeriod);
    if (!operatorGstin) {
      throw new HttpException(
        {
          success: false,
          message: 'operatorGstin query param required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const payload = await this.gstr8.generateJsonPayload(
      filingPeriod!,
      operatorGstin,
    );
    const serialised = JSON.stringify(payload);
    await this.logReportDownload(req, {
      resource: 'gstr8',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'json',
      bytes: Buffer.byteLength(serialised, 'utf8'),
      extra: { operatorGstin },
    });
    return {
      success: true,
      message: 'GSTR-8 JSON payload built',
      data: payload,
    };
  }

  @Get('reports/gstr8/summary')
  @Permissions('tax.tcs.read')
  async gstr8Summary(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertPeriod(filingPeriod);
    const summary = await this.gstr8.summarise(filingPeriod!);
    const serialised = serialiseBigInt(summary);
    await this.logReportDownload(req, {
      resource: 'gstr8.summary',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'summary',
      bytes: Buffer.byteLength(JSON.stringify(serialised), 'utf8'),
    });
    return {
      success: true,
      message: 'GSTR-8 summary built',
      data: serialised,
    };
  }

  // ── Form 26Q (Section 194-O TDS quarterly return) ────────────────

  @Get('reports/form26q.csv')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async form26qCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    if (!filingPeriod) {
      throw new HttpException(
        {
          success: false,
          message: 'filingPeriod query param required (YYYY-Qn)',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const csv = await this.form26q.generateCsv(filingPeriod);
    setCsvDownloadHeaders(res, `form26q-${filingPeriod}.csv`);
    await this.logReportDownload(req, {
      resource: 'form26q',
      sellerId: null,
      filingPeriod,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
    });
    res.send(csv);
  }

  // ── Marketplace's own GSTR-1 commission section ─────────────────
  //
  // The platform's commission to sellers is an outward supply on
  // the platform's OWN GSTR-1 (SAC 9985 / 18%). Separate from the
  // per-seller GSTR-1 the platform also generates ON BEHALF of
  // sellers (the §4 B2B / §7 B2C product-sale sections).

  @Get('reports/marketplace-commission-gstr1.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async marketplaceCommissionGstr1Csv(
    @Req() req: any,
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertPeriod(filingPeriod);
    const csv = await this.marketplaceCommissionGstr.generateCsv(filingPeriod!);
    setCsvDownloadHeaders(
      res,
      `marketplace-commission-gstr1-${filingPeriod}.csv`,
    );
    await this.logReportDownload(req, {
      resource: 'marketplace.commission.gstr1',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: Buffer.byteLength(csv, 'utf8'),
    });
    res.send(csv);
  }

  @Get('reports/form16a/:ledgerId.html')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async form16aHtml(
    @Req() req: any,
    @Res() res: Response,
    @Param('ledgerId') ledgerId: string,
  ) {
    const html = await this.form26q.renderForm16AHtml(ledgerId);
    if (!html) {
      throw new HttpException(
        { success: false, message: 'TDS ledger row not found', code: 'NOT_FOUND' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.logReportDownload(req, {
      resource: 'form16a',
      sellerId: null,
      filingPeriod: '',
      format: 'summary',
      bytes: Buffer.byteLength(html, 'utf8'),
      extra: { ledgerId },
    });
    res.send(html);
  }

  @Get('reports/form26q/summary')
  @Permissions('tax.tcs.read')
  async form26qSummary(@Query('filingPeriod') filingPeriod?: string) {
    if (!filingPeriod) {
      throw new HttpException(
        {
          success: false,
          message: 'filingPeriod query param required (YYYY-Qn)',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const summary = await this.form26q.summarise(filingPeriod);
    return {
      success: true,
      message: 'Form 26Q summary built',
      data: serialiseBigInt(summary),
    };
  }

  // ── TCS lifecycle transitions ───────────────────────────────────

  @Post('tcs/mark-filed')
  @Permissions('tax.tcs.markFiled')
  async markFiled(
    @Req() req: any,
    @Body() body: { ledgerIds: string[] },
  ) {
    if (!Array.isArray(body?.ledgerIds)) {
      throw new HttpException(
        {
          success: false,
          message: 'ledgerIds array required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const flipped = await this.tcs.markFiled({
      ledgerIds: body.ledgerIds,
      filedBy: req.adminId ?? 'unknown-admin',
    });
    return {
      success: true,
      message: `${flipped} TCS row(s) marked FILED`,
      data: { flipped, requested: body.ledgerIds.length },
    };
  }

  @Post('tcs/mark-paid')
  @Permissions('tax.tcs.markPaidToGovt')
  async markPaid(
    @Req() req: any,
    @Body() body: { ledgerIds: string[]; paymentReference: string },
  ) {
    if (!Array.isArray(body?.ledgerIds) || !body?.paymentReference) {
      throw new HttpException(
        {
          success: false,
          message: 'ledgerIds + paymentReference required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const flipped = await this.tcs.markPaidToGovt({
      ledgerIds: body.ledgerIds,
      paidBy: req.adminId ?? 'unknown-admin',
      paymentReference: body.paymentReference,
    });
    return {
      success: true,
      message: `${flipped} TCS row(s) marked PAID_TO_GOVT`,
      data: { flipped, requested: body.ledgerIds.length },
    };
  }

  // ── Section 194-O TDS lifecycle (Phase 27) ──────────────────────
  //
  // Parallel to the TCS lifecycle above. WITHHELD → DEPOSITED (after
  // challan upload to NSDL/TIN-Protean) → CERTIFICATE_ISSUED (after
  // Form 16A distributed). Both are bulk actions on ledger ids.

  @Get('tds194o')
  @Permissions('tax.tcs.read')
  async listTds(@Query('filingPeriod') filingPeriod?: string) {
    if (!filingPeriod) {
      throw new HttpException(
        {
          success: false,
          message: 'filingPeriod query param required (YYYY-Qn)',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const rows = await this.tds.listForPeriod(filingPeriod);
    return {
      success: true,
      message: 'Section 194-O TDS ledger retrieved',
      data: serialiseBigInt({ items: rows }),
    };
  }

  @Post('tds194o/mark-deposited')
  @Permissions('tax.tcs.markFiled')
  async markTdsDeposited(
    @Req() req: any,
    @Body() body: { ledgerIds: string[]; challanReference: string },
  ) {
    if (!Array.isArray(body?.ledgerIds) || !body?.challanReference) {
      throw new HttpException(
        {
          success: false,
          message: 'ledgerIds + challanReference required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const flipped = await this.tds.markDeposited({
      ledgerIds: body.ledgerIds,
      depositedBy: req.adminId ?? 'unknown-admin',
      challanReference: body.challanReference,
    });
    return {
      success: true,
      message: `${flipped} TDS row(s) marked DEPOSITED`,
      data: { flipped, requested: body.ledgerIds.length },
    };
  }

  @Post('tds194o/mark-certificate-issued')
  @Permissions('tax.tcs.markPaidToGovt')
  async markTdsCertificateIssued(
    @Req() req: any,
    @Body() body: { ledgerIds: string[]; certificateNumber: string },
  ) {
    if (!Array.isArray(body?.ledgerIds) || !body?.certificateNumber) {
      throw new HttpException(
        {
          success: false,
          message: 'ledgerIds + certificateNumber required',
          code: 'INVALID_REQUEST',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const flipped = await this.tds.markCertificateIssued({
      ledgerIds: body.ledgerIds,
      issuedBy: req.adminId ?? 'unknown-admin',
      certificateNumber: body.certificateNumber,
    });
    return {
      success: true,
      message: `${flipped} TDS row(s) marked CERTIFICATE_ISSUED`,
      data: { flipped, requested: body.ledgerIds.length },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function assertSellerAndPeriod(
  sellerId: string | undefined,
  filingPeriod: string | undefined,
): void {
  if (!sellerId) {
    throw new HttpException(
      { success: false, message: 'sellerId query param required', code: 'INVALID_REQUEST' },
      HttpStatus.BAD_REQUEST,
    );
  }
  assertPeriod(filingPeriod);
}

function assertPeriod(filingPeriod: string | undefined): void {
  if (!filingPeriod) {
    throw new HttpException(
      { success: false, message: 'filingPeriod query param required (YYYY-MM)', code: 'INVALID_REQUEST' },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!/^\d{4}-\d{2}$/.test(filingPeriod)) {
    throw new HttpException(
      { success: false, message: 'filingPeriod must be YYYY-MM', code: 'INVALID_REQUEST' },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function setCsvDownloadHeaders(res: Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/["\\]/g, '')}"`,
  );
}

/**
 * Recursively convert BigInt values to decimal strings so the JSON
 * response is safely serialisable. The frontend treats them as strings
 * (precision-safe) + converts at the boundary if it needs a number.
 */
function serialiseBigInt<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  );
}
