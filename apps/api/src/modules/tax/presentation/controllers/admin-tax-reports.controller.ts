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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { SetTaxModeDto } from '../dtos/set-tax-mode.dto';
import { MarkTcsFiledDto } from '../dtos/mark-tcs-filed.dto';
import { MarkTcsPaidDto } from '../dtos/mark-tcs-paid.dto';
import { MarkTcsCertificatesIssuedDto } from '../dtos/mark-tcs-certificates-issued.dto';
import { ReverseTcsDto } from '../dtos/reverse-tcs.dto';
import { Gstr1ReportService } from '../../application/services/gstr1-report.service';
import { Gstr3bReportService } from '../../application/services/gstr3b-report.service';
import {
  CURRENT_GSTR8_SCHEMA_VERSION,
  GSTR8_SCHEMA_VERSIONS,
  Gstr8ReportService,
} from '../../application/services/gstr8-report.service';
import { PlatformGstProfileService } from '../../application/services/platform-gst-profile.service';
import {
  TaxAuditReadinessService,
  type TaxAuditReadinessReport,
} from '../../application/services/tax-audit-readiness.service';
import { TaxModeService } from '../../application/services/tax-mode.service';
import { TcsService } from '../../application/services/tcs.service';
import { Tds194OService } from '../../application/services/tds-194o.service';
import { Form26QReportService } from '../../application/services/form-26q-report.service';
import { MarketplaceCommissionGstrService } from '../../application/services/marketplace-commission-gstr.service';
import { validateGstin } from '../../domain/gstin-validator';
// Phase 36 — every GSTR export carries seller-level PII (legal names,
// GSTINs, taxable values). The audit row captures who downloaded
// which report for which (seller, period), with IP + UA, so a
// data-exfiltration investigation has a single-table read path.
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { EnvService } from '../../../../bootstrap/env/env.service';

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
    // Phase 159z (audit B3) — server-side source of the platform's
    // operator GSTIN. Replaces the previous query-param-driven
    // resolution that admins could spoof.
    private readonly platformGstProfile: PlatformGstProfileService,
    private readonly audit: AuditPublicFacade,
    // Phase 163 — readiness cache TTL + window knobs.
    private readonly env: EnvService,
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
    // Phase 159w (audit #14) — surface where the mode came from (db vs env).
    const info = await this.mode.getModeInfo();
    return {
      success: true,
      message: 'Tax mode retrieved',
      data: { mode: info.mode, source: info.source },
    };
  }

  @Post('mode')
  @Permissions('tax.configure')
  // Phase 159w (audit #13) — a regulatory toggle; cap oscillation / flooding.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setMode(@Req() req: any, @Body() dto: SetTaxModeDto) {
    // Phase 159w (audit #10) — readiness gate. Flipping to STRICT while the
    // AUDIT-readiness report still shows blockers would guarantee checkout /
    // invoice failures in production. Reject unless the admin explicitly
    // forces it; the forced override is audited + flagged on the history row.
    let blockerCount = 0;
    if (dto.mode === 'STRICT') {
      const report = await this.readiness.build();
      blockerCount = report.totalBlockers;
      if (blockerCount > 0 && !dto.force) {
        throw new HttpException(
          {
            success: false,
            code: 'STRICT_READINESS_NOT_MET',
            message:
              `Cannot enter STRICT mode: ${blockerCount} unresolved tax-readiness ` +
              `blocker(s). Clear them (see GET /admin/tax/audit-readiness) or ` +
              `re-submit with force=true to override.`,
            data: { totalBlockers: blockerCount, blockers: report.blockers },
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const result = await this.mode.setMode(dto.mode, req.adminId ?? null, {
      reason: dto.reason ?? null,
      forced: dto.mode === 'STRICT' && blockerCount > 0 && !!dto.force,
      blockerCount,
    });
    return {
      success: true,
      message: `Tax mode set to ${dto.mode}`,
      data: { mode: result.to, previousMode: result.from },
    };
  }

  // Phase 163 (audit #5) — small TTL cache so an admin holding the refresh
  // button (or several admins on the same minute) doesn't re-run the 14-scan
  // build against prod on every keystroke. Keyed by scope.
  private readonly readinessCache = new Map<
    string,
    { at: number; report: TaxAuditReadinessReport }
  >();

  /**
   * Phase 163 — the audit-readiness dashboard rollup.
   *   #5  @Throttle + a short TTL cache (the build is 14 scans).
   *   #6  optional ?sellerId / ?filingPeriod / ?gstProfileId scope.
   *   #10 every read is audit-logged (it reveals org-wide compliance posture).
   *   #18 returned directly — the report carries no BigInt fields.
   *   #20 gated on the dedicated tax.readiness.read (org-wide) permission.
   */
  @Get('audit-readiness')
  @Permissions('tax.readiness.read')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async auditReadiness(
    @Req() req: any,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('gstProfileId') gstProfileId?: string,
    @Query('refresh') refresh?: string,
  ) {
    const filter = {
      sellerId: sellerId?.trim() || null,
      filingPeriod: filingPeriod?.trim() || null,
      gstProfileId: gstProfileId?.trim() || null,
    };
    if (filter.filingPeriod && !/^\d{4}-\d{2}$/.test(filter.filingPeriod)) {
      throw new HttpException(
        { success: false, code: 'INVALID_REQUEST', message: 'filingPeriod must be YYYY-MM' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const report = await this.buildReadinessCached(filter, refresh === 'true');
    // #10 — audit the read (who looked at the posture, with what scope + result).
    try {
      await this.audit.writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'tax.readiness.viewed',
        module: 'tax',
        resource: 'tax_audit_readiness',
        resourceId: `${filter.sellerId ?? 'platform'}:${filter.filingPeriod ?? 'all'}`,
        metadata: {
          totalBlockers: report.totalBlockers,
          criticalBlockers: report.criticalBlockers,
          ready: report.ready,
          currentMode: report.currentMode,
          filter,
        },
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
        userAgent: req?.headers?.['user-agent'] ?? null,
      });
    } catch {
      // never fail the read on an audit-write blip
    }
    return { success: true, message: 'Audit readiness report built', data: report };
  }

  /**
   * Phase 163 (audit #16) — readiness trend. Recent snapshots written by
   * the 6-hourly cron, so finance can answer "are blockers trending down?".
   */
  @Get('audit-readiness/history')
  @Permissions('tax.readiness.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async auditReadinessHistory(@Query('days') days?: string) {
    const parsedDays = days ? Number.parseInt(days, 10) : 30;
    const items = await this.readiness.history(
      Number.isFinite(parsedDays) ? parsedDays : 30,
    );
    return { success: true, message: 'Audit readiness history', data: { items } };
  }

  /** Phase 163 (audit #5) — TTL-cached readiness build, keyed by scope. */
  private async buildReadinessCached(
    filter: { sellerId: string | null; filingPeriod: string | null; gstProfileId: string | null },
    forceRefresh: boolean,
  ): Promise<TaxAuditReadinessReport> {
    const ttlSeconds = this.env.getNumber('TAX_READINESS_CACHE_TTL_SECONDS', 30);
    const key = `${filter.sellerId ?? ''}|${filter.filingPeriod ?? ''}|${filter.gstProfileId ?? ''}`;
    const now = Date.now();
    if (!forceRefresh && ttlSeconds > 0) {
      const hit = this.readinessCache.get(key);
      if (hit && now - hit.at < ttlSeconds * 1000) return hit.report;
    }
    const report = await this.readiness.build(filter);
    if (ttlSeconds > 0) this.readinessCache.set(key, { at: now, report });
    return report;
  }

  /**
   * Phase 163 (audit #3) — STRICT-mode export readiness gate.
   *
   * In OFF / AUDIT mode exports are UNRESTRICTED — a CA needs to pull the
   * CSV precisely to inspect what's wrong (this is the deliberate design
   * accepted in the GSTR-3B audit: "exports must work regardless of mode").
   *
   * In STRICT mode — the "we assert we are production-compliant" posture —
   * a file-producing export with unresolved readiness blockers is blocked
   * with 409 BLOCKERS_PRESENT, UNLESS the caller passes
   * ?acknowledgeBlockers=true AND holds tax.reports.overrideBlockers. Every
   * such override is audit-logged with the blocker count, so a later review
   * can reconstruct "this GSTR was filed while N blockers existed, knowingly,
   * by admin X". Per-seller exports scope the readiness check to that seller
   * (plus the platform-wide blockers that gate everyone).
   */
  private async assertExportReadiness(
    req: any,
    args: {
      resource: string;
      sellerId?: string | null;
      filingPeriod?: string | null;
      acknowledgeBlockers?: boolean;
    },
  ): Promise<void> {
    const mode = await this.mode.getMode();
    if (mode !== 'STRICT') return;
    const report = await this.readiness.build({
      sellerId: args.sellerId ?? null,
      filingPeriod: args.filingPeriod ?? null,
    });
    if (report.totalBlockers === 0) return;

    if (!args.acknowledgeBlockers) {
      throw new HttpException(
        {
          success: false,
          code: 'BLOCKERS_PRESENT',
          message:
            `Cannot export ${args.resource} in STRICT mode: ${report.totalBlockers} ` +
            `unresolved tax-readiness blocker(s) (${report.criticalBlockers} critical). ` +
            `Clear them (see GET /admin/tax/audit-readiness) or re-submit with ` +
            `acknowledgeBlockers=true to file knowingly (requires ` +
            `tax.reports.overrideBlockers).`,
          data: {
            totalBlockers: report.totalBlockers,
            criticalBlockers: report.criticalBlockers,
            blockers: report.blockers.filter((b) => b.count > 0),
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const perms: string[] = Array.isArray(req?.user?.permissions)
      ? req.user.permissions
      : [];
    if (!perms.includes('tax.reports.overrideBlockers')) {
      throw new HttpException(
        {
          success: false,
          code: 'OVERRIDE_NOT_PERMITTED',
          message:
            'Acknowledging readiness blockers on a STRICT-mode export requires ' +
            'the tax.reports.overrideBlockers permission.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Audited override — the forensic record that this filing went out with
    // known gaps, knowingly, by this actor.
    try {
      await this.audit.writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'tax.report.exported_with_blockers',
        module: 'tax',
        resource: args.resource,
        resourceId: `${args.sellerId ?? 'platform'}:${args.filingPeriod ?? 'all'}`,
        metadata: {
          totalBlockers: report.totalBlockers,
          criticalBlockers: report.criticalBlockers,
          sellerId: args.sellerId ?? null,
          filingPeriod: args.filingPeriod ?? null,
        },
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
        userAgent: req?.headers?.['user-agent'] ?? null,
      });
    } catch {
      // never fail the (consciously-authorised) export on an audit-write blip
    }
  }

  // ── GSTR-1 ──────────────────────────────────────────────────────

  /** §4 B2B CSV. */
  // Phase 159x (audit §8 RBAC — flood-download). Generous cap: a real filing
  // day is hundreds of section downloads, so this only stops runaway abuse.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('reports/gstr1.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr1B2bCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    // Phase 163 (#3) — STRICT-mode readiness gate (scoped to this seller).
    await this.assertExportReadiness(req, {
      resource: 'gstr1.b2b',
      sellerId,
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
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

  /**
   * Phase 159x (audit #17) — section-wise counts + totals so the admin can
   * preview a filing period without downloading all six CSVs. Declared BEFORE
   * the `:section.csv` route so `preview` isn't matched as a section.
   */
  @Get('reports/gstr1/preview')
  @Permissions('tax.reports.read')
  async gstr1Preview(
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    const data = await this.gstr1.previewForSeller({
      sellerId: sellerId!,
      filingPeriod: filingPeriod!,
    });
    return { success: true, message: 'GSTR-1 preview', data };
  }

  /** §5 B2C Large / §7 B2C Small / §9B Credit Notes / §12 HSN / §13 Docs Issued. */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('reports/gstr1/:section.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr1SectionCsv(
    @Req() req: any,
    @Res() res: Response,
    @Param('section') section: string,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    await this.assertExportReadiness(req, {
      resource: `gstr1.${section}`,
      sellerId,
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
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

  // Phase 159y (audit #17) — cap flood-export; generous for filing-day bursts.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('reports/gstr3b.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr3bCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('sellerId') sellerId?: string,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertSellerAndPeriod(sellerId, filingPeriod);
    await this.assertExportReadiness(req, {
      resource: 'gstr3b',
      sellerId,
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
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

  /**
   * Phase 159z (audit B3 + #11) — server-side resolution of the
   * platform's operator GSTIN. Replaces the prior query-param-driven
   * resolution that admins could spoof. The GSTIN is taken from the
   * verified PlatformGstProfile.default row and regex-validated as a
   * defence-in-depth check (so a misconfigured profile fails loudly
   * instead of producing an invalid NIC payload).
   */
  private async resolveOperatorGstin(): Promise<string> {
    const profile = await this.platformGstProfile.requireDefault();
    const v = validateGstin(profile.gstin);
    if (!v.isValid) {
      throw new HttpException(
        {
          success: false,
          code: 'PLATFORM_GSTIN_INVALID',
          message:
            `Platform default GSTIN "${profile.gstin}" is not a valid GSTIN ` +
            `(${v.errors.join('; ')}). Fix the Platform GST profile before exporting.`,
        },
        HttpStatus.CONFLICT,
      );
    }
    return v.normalized!;
  }

  // Phase 159z (audit #13) — flood-download guard. Generous for filing-
  // day bursts while still capping runaway scripts.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('reports/gstr8.csv')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async gstr8Csv(
    @Req() req: any,
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('schemaVersion') schemaVersion?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    const sv = assertSchemaVersion(schemaVersion);
    // Phase 163 (#3) — platform-wide STRICT-mode readiness gate.
    await this.assertExportReadiness(req, {
      resource: 'gstr8',
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
    setCsvDownloadHeaders(res, `gstr8-${filingPeriod}.csv`);
    // Phase 159z (audit #8 + #15) — stream the CSV row-by-row and write
    // the audit log BEFORE we close the response. We capture bytes/rows
    // from the streamer's return value rather than buffering the body.
    const stream = await this.gstr8.streamCsv(res, filingPeriod!, {
      schemaVersion: sv,
    });
    await this.logReportDownload(req, {
      resource: 'gstr8',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: stream.bytesWritten,
      extra: { schemaVersion: sv, rowsEmitted: stream.rowsEmitted },
    });
  }

  // Phase 159z (audit #13) — same throttle as the CSV endpoint.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('reports/gstr8.json')
  @Permissions('tax.tcs.export')
  async gstr8Json(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('schemaVersion') schemaVersion?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    const sv = assertSchemaVersion(schemaVersion);
    await this.assertExportReadiness(req, {
      resource: 'gstr8',
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
    // Phase 159z (audit B3 + #11) — operator GSTIN is sourced from the
    // verified PlatformGstProfile, not from a user-supplied query
    // string. Any operatorGstin query param is ignored.
    const operatorGstin = await this.resolveOperatorGstin();
    const payload = await this.gstr8.generateJsonPayload(
      filingPeriod!,
      operatorGstin,
      { schemaVersion: sv },
    );
    const serialised = JSON.stringify(payload);
    await this.logReportDownload(req, {
      resource: 'gstr8',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'json',
      bytes: Buffer.byteLength(serialised, 'utf8'),
      extra: { operatorGstin, schemaVersion: sv },
    });
    return {
      success: true,
      message: 'GSTR-8 JSON payload built',
      data: payload,
    };
  }

  // Phase 159z (audit #13) — throttle the summary endpoint too. UI
  // refreshes are bursty but bounded.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('reports/gstr8/summary')
  @Permissions('tax.tcs.read')
  async gstr8Summary(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    // Phase 159z (audit #14) — paginated. Validates the inputs cheaply
    // and clamps so a malicious pageSize=99999 can't load the world.
    const parsedPage = clampPositiveInt(page, 1, 1, 100_000);
    const parsedPageSize = clampPositiveInt(pageSize, 50, 1, 500);
    const summary = await this.gstr8.summarise({
      filingPeriod: filingPeriod!,
      page: parsedPage,
      pageSize: parsedPageSize,
    });
    const serialised = serialiseBigInt(summary);
    await this.logReportDownload(req, {
      resource: 'gstr8.summary',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'summary',
      bytes: Buffer.byteLength(JSON.stringify(serialised), 'utf8'),
      extra: { page: parsedPage, pageSize: parsedPageSize },
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
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
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
    // Phase 163 (#3) — platform-wide readiness gate. filingPeriod here is a
    // quarter (YYYY-Qn), not the monthly scope the scan filters on, so the
    // check is unscoped-by-period (TDS-withheld + platform blockers still apply).
    await this.assertExportReadiness(req, {
      resource: 'form26q',
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
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

  /**
   * Phase 159aa (audit B3 + #6 + #11) — server-side supplier GSTIN
   * resolution shared by CSV + JSON + summary so a single
   * PlatformGstProfile entry feeds every download.
   */
  private async resolveMarketplaceCommissionContext(): Promise<{
    supplierGstin: string;
  }> {
    const profile = await this.platformGstProfile.requireDefault();
    const v = validateGstin(profile.gstin);
    if (!v.isValid) {
      throw new HttpException(
        {
          success: false,
          code: 'PLATFORM_GSTIN_INVALID',
          message:
            `Platform default GSTIN "${profile.gstin}" is not a valid GSTIN ` +
            `(${v.errors.join('; ')}). Fix the Platform GST profile before ` +
            'exporting the marketplace commission GSTR-1.',
        },
        HttpStatus.CONFLICT,
      );
    }
    return { supplierGstin: v.normalized! };
  }

  // Phase 159aa (audit #13) — bound the export flood rate. Filing-day
  // is bursty; 30/min comfortably covers manual re-pulls.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('reports/marketplace-commission-gstr1.csv')
  @Permissions('tax.reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async marketplaceCommissionGstr1Csv(
    @Req() req: any,
    @Res() res: Response,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('schemaVersion') schemaVersion?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    const sv = schemaVersion ?? '2024-Q3';
    // Phase 163 (#3) — platform-wide STRICT-mode readiness gate.
    await this.assertExportReadiness(req, {
      resource: 'marketplace.commission.gstr1',
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
    const { supplierGstin } = await this.resolveMarketplaceCommissionContext();
    setCsvDownloadHeaders(
      res,
      `marketplace-commission-gstr1-${filingPeriod}.csv`,
    );
    // Phase 159aa (audit #14) — streaming variant. Audit log written
    // BEFORE res.end() inside streamCsv via the caller-pre-stream
    // accounting; we still log the post-stream byte count for completeness.
    const stream = await this.marketplaceCommissionGstr.streamCsv(res, {
      filingPeriod: filingPeriod!,
      supplierGstin,
      schemaVersion: sv,
    });
    await this.logReportDownload(req, {
      resource: 'marketplace.commission.gstr1',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'csv',
      bytes: stream.bytesWritten,
      extra: { schemaVersion: sv, rowsEmitted: stream.rowsEmitted },
    });
  }

  // Phase 159aa (audit #7) — JSON export mirroring NIC §4 B2B / §7
  // B2C / §9B field names. Operator GSTIN is server-resolved (audit B3).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('reports/marketplace-commission-gstr1.json')
  @Permissions('tax.reports.export')
  async marketplaceCommissionGstr1Json(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
    @Query('schemaVersion') schemaVersion?: string,
    @Query('acknowledgeBlockers') acknowledgeBlockers?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    const sv = schemaVersion ?? '2024-Q3';
    await this.assertExportReadiness(req, {
      resource: 'marketplace.commission.gstr1',
      filingPeriod,
      acknowledgeBlockers: acknowledgeBlockers === 'true',
    });
    const { supplierGstin } = await this.resolveMarketplaceCommissionContext();
    const payload = await this.marketplaceCommissionGstr.generateJsonPayload({
      filingPeriod: filingPeriod!,
      supplierGstin,
      schemaVersion: sv,
    });
    const serialised = JSON.stringify(payload);
    await this.logReportDownload(req, {
      resource: 'marketplace.commission.gstr1',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'json',
      bytes: Buffer.byteLength(serialised, 'utf8'),
      extra: { schemaVersion: sv, supplierGstin },
    });
    return {
      success: true,
      message: 'Marketplace commission GSTR-1 JSON payload built',
      data: payload,
    };
  }

  // Phase 159aa (audit #16) — summary endpoint backing the admin UI
  // preview: counts + headline totals + drift warnings (#15).
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('reports/marketplace-commission-gstr1/summary')
  @Permissions('tax.reports.read')
  async marketplaceCommissionGstr1Summary(
    @Req() req: any,
    @Query('filingPeriod') filingPeriod?: string,
  ) {
    assertPeriod(filingPeriod);
    assertNotFuturePeriod(filingPeriod!);
    const { supplierGstin } = await this.resolveMarketplaceCommissionContext();
    const summary = await this.marketplaceCommissionGstr.summarise({
      filingPeriod: filingPeriod!,
      supplierGstin,
    });
    const serialised = serialiseBigInt(summary);
    await this.logReportDownload(req, {
      resource: 'marketplace.commission.gstr1.summary',
      sellerId: null,
      filingPeriod: filingPeriod!,
      format: 'summary',
      bytes: Buffer.byteLength(JSON.stringify(serialised), 'utf8'),
    });
    return {
      success: true,
      message: 'Marketplace commission GSTR-1 summary built',
      data: serialised,
    };
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

  // Phase 159z (audit #13) — bound the transition rate so an automated
  // script can't oscillate hundreds of rows. UI flow is single-click,
  // bulk-or-not — well within this cap.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('tcs/mark-filed')
  @Permissions('tax.tcs.markFiled')
  async markFiled(
    @Req() req: any,
    @Body() body: MarkTcsFiledDto,
  ) {
    const result = await this.tcs.markFiled({
      ledgerIds: body.ledgerIds,
      filedBy: req.adminId ?? 'unknown-admin',
      nicArn: body.nicArn,
    });
    // Phase 159z (audit §10 lifecycle audits) — write one audit_logs
    // row per ledger that actually flipped. This makes a future
    // forensic question ("who flipped this row to FILED, with what
    // ARN, on what request?") answerable from audit_logs alone.
    await this.writeLifecycleAuditLogs(req, {
      ledgerIds: result.flippedIds,
      action: 'tax.tcs.filed',
      requested: body.ledgerIds.length,
      extra: { nicArn: body.nicArn, skippedCount: result.skipped.length },
    });
    return {
      success: true,
      message:
        `${result.flippedCount} TCS row(s) marked FILED` +
        (result.skipped.length
          ? ` — ${result.skipped.length} skipped (not in COLLECTED state)`
          : ''),
      data: {
        flipped: result.flippedCount,
        requested: body.ledgerIds.length,
        nicArn: body.nicArn,
        // Phase 160 (§52 lifecycle audit B4 / #4) — the exact stragglers
        // so the UI can show which rows weren't flipped + why.
        skipped: result.skipped,
      },
    };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('tcs/mark-paid')
  @Permissions('tax.tcs.markPaidToGovt')
  async markPaid(
    @Req() req: any,
    @Body() body: MarkTcsPaidDto,
  ) {
    const result = await this.tcs.markPaidToGovt({
      ledgerIds: body.ledgerIds,
      paidBy: req.adminId ?? 'unknown-admin',
      paymentReference: body.paymentReference,
      paymentProofFileId: body.paymentProofFileId ?? null,
    });
    await this.writeLifecycleAuditLogs(req, {
      ledgerIds: result.flippedIds,
      action: 'tax.tcs.paidToGovt',
      requested: body.ledgerIds.length,
      extra: {
        paymentReference: body.paymentReference,
        paymentProofFileId: body.paymentProofFileId ?? null,
        skippedCount: result.skipped.length,
      },
    });
    return {
      success: true,
      message:
        `${result.flippedCount} TCS row(s) marked PAID_TO_GOVT` +
        (result.skipped.length
          ? ` — ${result.skipped.length} skipped (not in FILED state)`
          : ''),
      data: {
        flipped: result.flippedCount,
        requested: body.ledgerIds.length,
        skipped: result.skipped,
      },
    };
  }

  /**
   * Phase 160 (§52 lifecycle audit B1 / #12) — terminal stage: furnish
   * the §52(5) TCS certificate to suppliers. Bulk-marks PAID_TO_GOVT rows
   * CERTIFICATE_ISSUED with a per-row certificate number. Audited per
   * flipped row; returns the per-row certificate numbers + the skipped
   * stragglers (B4 / #4).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('tcs/mark-certificates-issued')
  @Permissions('tax.tcs.markCertificateIssued')
  async markCertificatesIssued(
    @Req() req: any,
    @Body() body: MarkTcsCertificatesIssuedDto,
  ) {
    const result = await this.tcs.markCertificatesIssued({
      ledgerIds: body.ledgerIds,
      issuedBy: req.adminId ?? 'unknown-admin',
      certificateNumberPrefix: body.certificateNumberPrefix,
    });
    // One audit_logs row per flipped ledger, carrying the certificate
    // number so a forensic search returns "who issued cert X, when".
    const ip = req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null;
    const ua = req?.headers?.['user-agent'] ?? null;
    for (const ledgerId of result.flippedIds) {
      try {
        await this.audit.writeAuditLog({
          actorId: req?.adminId,
          actorRole: 'ADMIN',
          action: 'tax.tcs.certificateIssued',
          module: 'tax',
          resource: 'gst_tcs_settlement_ledger',
          resourceId: ledgerId,
          newValue: { status: 'CERTIFICATE_ISSUED' },
          metadata: {
            requestedCount: body.ledgerIds.length,
            certificateNumber: result.certificateNumbers[ledgerId] ?? null,
            skippedCount: result.skipped.length,
          },
          ipAddress: ip,
          userAgent: ua,
        });
      } catch {
        // never fail the transition on an audit-write blip
      }
    }
    return {
      success: true,
      message:
        `${result.flippedCount} TCS certificate(s) issued` +
        (result.skipped.length
          ? ` — ${result.skipped.length} skipped (not in PAID_TO_GOVT state)`
          : ''),
      data: {
        flipped: result.flippedCount,
        requested: body.ledgerIds.length,
        certificateNumbers: result.certificateNumbers,
        skipped: result.skipped,
      },
    };
  }

  /**
   * Phase 160 (§52 lifecycle audit B1) — render the §52(5) TCS
   * certificate as HTML (admin preview / save-as-PDF). 404 when the
   * ledger row doesn't exist. Audit-logged like the Form 16A endpoint.
   */
  @Get('tcs/certificate/:ledgerId.html')
  @Permissions('tax.tcs.export')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async tcsCertificateHtml(
    @Req() req: any,
    @Res() res: Response,
    @Param('ledgerId') ledgerId: string,
  ) {
    const html = await this.tcs.renderCertificateHtml(ledgerId);
    if (!html) {
      throw new HttpException(
        { success: false, message: 'TCS ledger row not found', code: 'NOT_FOUND' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.logReportDownload(req, {
      resource: 'tcs.certificate',
      sellerId: null,
      filingPeriod: '',
      format: 'summary',
      bytes: Buffer.byteLength(html, 'utf8'),
      extra: { ledgerId },
    });
    res.send(html);
  }

  /**
   * Phase 159z (audit #10) — correction flow. Marks one ledger row
   * REVERSED with a free-text reason. Caller is expected to follow up
   * with `computeForSeller` to produce the corrected row (carrying
   * `correctionOfId` back to this one). Audited per row.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('tcs/:ledgerId/reverse')
  @Permissions('tax.tcs.reverse')
  async reverseTcs(
    @Req() req: any,
    @Param('ledgerId') ledgerId: string,
    @Body() body: ReverseTcsDto,
  ) {
    if (!ledgerId || !/^[a-f0-9-]{8,}$/i.test(ledgerId)) {
      throw new HttpException(
        {
          success: false,
          code: 'INVALID_REQUEST',
          message: 'ledgerId path param must be a valid id',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.tcs.reverse({
      ledgerId,
      reversedBy: req.adminId ?? 'unknown-admin',
      reason: body.reason,
    });
    // Audit log carries the previous status so a finance audit can
    // see whether the reversal undid a FILED or PAID_TO_GOVT row.
    try {
      await this.audit.writeAuditLog({
        actorId: req?.adminId,
        actorRole: 'ADMIN',
        action: 'tax.tcs.reversed',
        module: 'tax',
        resource: 'gst_tcs_settlement_ledger',
        resourceId: ledgerId,
        oldValue: { status: result.previousStatus },
        newValue: { status: 'REVERSED', reason: body.reason },
        metadata: {
          wasAlreadyReversed: result.wasAlreadyReversed,
        },
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
        userAgent: req?.headers?.['user-agent'] ?? null,
      });
    } catch {
      // audit-log failure must not block the mutation response
    }
    return {
      success: true,
      message: result.wasAlreadyReversed
        ? 'TCS row was already REVERSED (no-op)'
        : `TCS row ${ledgerId} marked REVERSED`,
      data: {
        ledgerId,
        previousStatus: result.previousStatus,
        wasAlreadyReversed: result.wasAlreadyReversed,
      },
    };
  }

  /**
   * Phase 159z (audit §10 lifecycle audits) — shared writer for
   * mark-filed / mark-paid. One row per flipped ledger so audit-log
   * search by resourceId returns a per-ledger lifecycle history.
   * Non-throwing — a write failure logs but doesn't fail the mutation.
   */
  private async writeLifecycleAuditLogs(
    req: any,
    args: {
      ledgerIds: string[];
      action: 'tax.tcs.filed' | 'tax.tcs.paidToGovt';
      requested: number;
      extra: Record<string, unknown>;
    },
  ): Promise<void> {
    if (args.ledgerIds.length === 0) return;
    const ip = req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null;
    const ua = req?.headers?.['user-agent'] ?? null;
    // Sequential writes — order matters less than not stampeding the
    // DB; lifecycle transitions are bounded by the DTO at 2000 rows.
    for (const ledgerId of args.ledgerIds) {
      try {
        await this.audit.writeAuditLog({
          actorId: req?.adminId,
          actorRole: 'ADMIN',
          action: args.action,
          module: 'tax',
          resource: 'gst_tcs_settlement_ledger',
          resourceId: ledgerId,
          newValue: {
            status:
              args.action === 'tax.tcs.filed' ? 'FILED' : 'PAID_TO_GOVT',
          },
          metadata: {
            requestedCount: args.requested,
            ...args.extra,
          },
          ipAddress: ip,
          userAgent: ua,
        });
      } catch {
        // Never fail the transition response on an audit-write blip.
      }
    }
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
  // Phase 159z (audit #12) — calendar sanity check: months 01-12 only.
  const month = parseInt(filingPeriod.slice(5, 7), 10);
  if (month < 1 || month > 12) {
    throw new HttpException(
      {
        success: false,
        message: `filingPeriod month component must be 01-12 (got ${filingPeriod.slice(5, 7)})`,
        code: 'INVALID_REQUEST',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Phase 159z (GSTR-8 audit #12) — reject future periods. The GSTR-8 is
 * monthly; a CA cannot legally file an export for a period that hasn't
 * ended. Comparing against the current IST month (not UTC) is important
 * because a request made at 00:30 IST on the 1st of the month is still
 * "today" IST-side but rolls a UTC day boundary.
 *
 * The reference month is computed from the same IST_OFFSET_MS the
 * compute path uses, so the boundary semantics match (no off-by-one).
 */
const IST_OFFSET_MS_FOR_GUARD = 5.5 * 60 * 60 * 1000;
function assertNotFuturePeriod(filingPeriod: string): void {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS_FOR_GUARD);
  const currentYear = istNow.getUTCFullYear();
  const currentMonth = istNow.getUTCMonth() + 1;
  const parts = filingPeriod.split('-');
  const y = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  if (y > currentYear || (y === currentYear && m > currentMonth)) {
    throw new HttpException(
      {
        success: false,
        code: 'FUTURE_PERIOD',
        message:
          `Cannot export GSTR-8 for ${filingPeriod} — the period has not ` +
          `ended yet (current IST month: ${currentYear}-${String(currentMonth).padStart(2, '0')}).`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Phase 159z (audit #7) — pin the GSTR-8 CSV / JSON layout to a known
 * CBIC schema version. Defaults to current; unknown values are rejected
 * so a typo doesn't silently fall back to a layout the CA didn't
 * expect.
 */
function assertSchemaVersion(schemaVersion?: string): string {
  if (!schemaVersion) return CURRENT_GSTR8_SCHEMA_VERSION;
  if (!(schemaVersion in GSTR8_SCHEMA_VERSIONS)) {
    throw new HttpException(
      {
        success: false,
        code: 'UNKNOWN_SCHEMA_VERSION',
        message:
          `Unknown GSTR-8 schemaVersion "${schemaVersion}". ` +
          `Supported: ${Object.keys(GSTR8_SCHEMA_VERSIONS).join(', ')}.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return schemaVersion;
}

/**
 * Phase 159z (audit #14) — clamp helper for ?page / ?pageSize query
 * params. Treats undefined / non-numeric / out-of-range as the default;
 * the upper bound is the cheap-to-fetch ceiling so a hostile
 * pageSize=99999 can't load the world.
 */
function clampPositiveInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return defaultValue;
  if (n > max) return max;
  return n;
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
