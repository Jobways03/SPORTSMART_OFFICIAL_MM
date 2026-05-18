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
  ) {}

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
    res.send(csv);
  }

  /** §5 B2C Large / §7 B2C Small / §9B Credit Notes / §12 HSN / §13 Docs Issued. */
  @Get('reports/gstr1/:section.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr1SectionCsv(
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
    res.send(csv);
  }

  // ── GSTR-3B ─────────────────────────────────────────────────────

  @Get('reports/gstr3b.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr3bCsv(
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
    res.send(csv);
  }

  // ── GSTR-8 (platform-side TCS) ──────────────────────────────────

  @Get('reports/gstr8.csv')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr8Csv(
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertPeriod(filingPeriod);
    const csv = await this.gstr8.generateCsv(filingPeriod!);
    setCsvDownloadHeaders(res, `gstr8-${filingPeriod}.csv`);
    res.send(csv);
  }

  @Get('reports/gstr8.json')
  @Permissions('tax.tcs.export')
  async gstr8Json(
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
    return {
      success: true,
      message: 'GSTR-8 JSON payload built',
      data: payload,
    };
  }

  @Get('reports/gstr8/summary')
  @Permissions('tax.tcs.read')
  async gstr8Summary(@Query('filingPeriod') filingPeriod?: string) {
    assertPeriod(filingPeriod);
    const summary = await this.gstr8.summarise(filingPeriod!);
    return {
      success: true,
      message: 'GSTR-8 summary built',
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
