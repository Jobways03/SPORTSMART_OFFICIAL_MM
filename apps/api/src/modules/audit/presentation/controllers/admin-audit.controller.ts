import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { AuditChainAnchorService } from '../../application/services/audit-chain-anchor.service';
import { AuditPublicFacade } from '../../application/facades/audit-public.facade';
import {
  maskEmailsInText,
  maskIp,
} from '../../application/services/audit-export-redaction.util';
import { AUDIT_SELF_ACTIONS } from '../../application/services/audit-event-types';
import { AuditLogQueryDto } from '../dtos/audit-log-query.dto';
import { AuditVerifyQueryDto, AuditVerifyRangeDto } from '../dtos/audit-verify-query.dto';
import { AuditExportQueryDto } from '../dtos/audit-export-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Admin-only audit log surface. Reads from the hash-chained AuditLog
 * table. Writers go through AuditPublicFacade (cross-module).
 */
@ApiTags('Admin Audit')
@Controller('admin/audit')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminAuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchors: AuditChainAnchorService,
    private readonly audit: AuditPublicFacade,
    private readonly env: EnvService,
  ) {}

  private actorId(req: Request): string | undefined {
    const r = req as any;
    return r?.adminId ?? r?.user?.id ?? undefined;
  }

  @Get('logs')
  @Permissions('audit.read')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async list(@Query() q: AuditLogQueryDto) {
    const p = q.page ?? 1;
    const l = q.limit ?? 100;
    const where: any = {};
    if (q.module) where.module = q.module;
    if (q.resource) where.resource = q.resource;
    if (q.resourceId) where.resourceId = q.resourceId;
    if (q.actorId) where.actorId = q.actorId;
    if (q.actorType) where.actorType = q.actorType;
    if (q.action) where.action = q.action;
    if (q.fromDate || q.toDate) {
      where.createdAt = {};
      if (q.fromDate) where.createdAt.gte = new Date(q.fromDate);
      if (q.toDate) where.createdAt.lte = new Date(q.toDate);
    }
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        // Deterministic newest-first (sequenceNumber is gap-free + unique;
        // createdAt can tie at ms resolution).
        orderBy: { sequenceNumber: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      success: true,
      message: 'Audit logs',
      data: { items: items.map(serializeRow), total, page: p, limit: l },
    };
  }

  @Get('logs/:id')
  @Permissions('audit.read')
  async getOne(@Param('id') id: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Log not found');
    return { success: true, message: 'Log', data: serializeRow(row) };
  }

  /**
   * Phase 8 (PR 8.1) — fast-path verification using the latest anchor pin.
   * Phase 204 (#1) — response reshaped to the FE contract
   * `{ scanned, fromAnchorAt, breaks: [{ id, createdAt, issueType, severity, reason }] }`.
   * The old shape (`{ anchorSequence, rowsChecked, breaks: [{ id, reason }] }`)
   * left `verifyResult.scanned` undefined and threw in the UI.
   */
  @Get('verify-chain-fast')
  @Permissions('audit.chain.verify')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  async verifyChainFast(@Req() req: Request, @Query() q: AuditVerifyQueryDto) {
    const take = q.limit ?? 10_000;
    const data = await this.anchors.verifyFromLatestAnchor(take, this.actorId(req));
    return {
      success: true,
      message: data.breaks.length === 0 ? 'Chain healthy' : 'Chain breaks detected',
      data: toFeVerifyShape(data),
    };
  }

  /**
   * Phase 204 (#2/#8/#15) — FULL cursor-batched walk over the entire chain.
   * Persists a FULL run. Synchronous for now; the async job framework that
   * would background a very large run is SURFACED (see notes) — the bounded,
   * batched capability that job would call is real and used here.
   */
  @Post('verify-chain-full')
  @Permissions('audit.chain.verify')
  @Throttle({ default: { limit: 2, ttl: 10 * 60_000 } })
  async verifyChainFull(@Req() req: Request) {
    const data = await this.anchors.verifyFull({ startedBy: this.actorId(req) });
    return {
      success: true,
      message: data.breaks.length === 0 ? 'Chain healthy' : 'Chain breaks detected',
      data: toFeVerifyShape(data),
    };
  }

  /** Phase 204 (#9) — range/sample verify. */
  @Get('verify-chain-range')
  @Permissions('audit.chain.verify')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  async verifyChainRange(@Req() req: Request, @Query() q: AuditVerifyRangeDto) {
    if (q.toSeq < q.fromSeq) {
      throw new BadRequestAppException('toSeq must be >= fromSeq');
    }
    const data = await this.anchors.verifyRange(
      BigInt(q.fromSeq),
      BigInt(q.toSeq),
      this.actorId(req),
    );
    return {
      success: true,
      message: data.breaks.length === 0 ? 'Chain healthy' : 'Chain breaks detected',
      data: toFeVerifyShape(data),
    };
  }

  /**
   * Legacy genesis-walk verifier. Phase 204 (#5) — now uses the SAME shared
   * recompute as the writer (no longer "informational" — it HARD-FAILS on a
   * content mismatch for v2 rows). Bounded; prefer the anchor fast-path.
   */
  @Get('verify-chain')
  @Permissions('audit.chain.verify')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  async verifyChain(@Req() req: Request, @Query() q: AuditVerifyQueryDto) {
    const take = q.limit ?? 1_000;
    // Bounded genesis walk: from the lowest sequence through `take` sequence
    // values. verifyRange caps the span itself, so this stays bounded even if
    // the chain is huge.
    const first = await this.prisma.auditLog.findFirst({
      orderBy: { sequenceNumber: 'asc' },
      select: { sequenceNumber: true },
    });
    if (!first) {
      return { success: true, message: 'Walked 0 rows', data: toFeVerifyShape({
        anchorSequence: null, anchorCreatedAt: null, rowsChecked: 0, breaks: [],
      }) };
    }
    const data = await this.anchors.verifyRange(
      first.sequenceNumber,
      first.sequenceNumber + BigInt(take) - 1n,
      this.actorId(req),
    );
    return {
      success: true,
      message: `Walked ${data.rowsChecked} rows`,
      data: toFeVerifyShape(data),
    };
  }

  /** Phase 204 (#16) — verification-run history for the UI. */
  @Get('verification-runs')
  @Permissions('audit.chain.verify')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listVerificationRuns(@Query('limit') limit?: string) {
    const l = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const runs = await this.prisma.auditChainVerificationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: l,
    });
    return { success: true, message: 'Verification runs', data: { items: runs } };
  }

  /** Phase 204 (#17) — drill into one run's issues. */
  @Get('verification-runs/:id')
  @Permissions('audit.chain.verify')
  async getVerificationRun(@Param('id') id: string) {
    const run = await this.prisma.auditChainVerificationRun.findUnique({
      where: { id },
      include: { issues: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundAppException('Verification run not found');
    return { success: true, message: 'Verification run', data: run };
  }

  // ── Event log query API (unchanged) ────────────────────────────────────
  @Get('events')
  @Permissions('audit.read')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async listEvents(
    @Query('eventName') eventName?: string,
    @Query('aggregate') aggregate?: string,
    @Query('aggregateId') aggregateId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parseInt(page || '1', 10) || 1;
    const l = Math.min(parseInt(limit || '100', 10) || 100, 500);
    const where: any = {};
    if (eventName) where.eventName = eventName;
    if (aggregate) where.aggregate = aggregate;
    if (aggregateId) where.aggregateId = aggregateId;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    const [items, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.eventLog.count({ where }),
    ]);
    return { success: true, message: 'Event logs', data: { items, total, page: p, limit: l } };
  }

  @Get('events/:id')
  @Permissions('audit.read')
  async getEvent(@Param('id') id: string) {
    const row = await this.prisma.eventLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Event log not found');
    return { success: true, message: 'Event log', data: row };
  }

  /**
   * CSV export — Phase 206.
   *
   *   #1  includes the hash-chain fields (id, sequence_number, prev_hash,
   *       hash, payload, metadata, user_agent) so the file can be re-verified
   *       offline;
   *   #2  self-audited (audit.exported with {filters, rowsExported, mode});
   *   #3  formula-injection safe via the shared escapeCsvField;
   *   #4  fromDate + toDate REQUIRED (DTO), 90-day span cap, refuses > 100K rows;
   *   #6  mode=redacted DEFAULT (IP masked, JSON stripped, emails masked);
   *       mode=full gated by audit.export.full;
   *   #5  throttled 3 / 5 min;
   *   #8  STREAMED via res.write + cursor batches (no take:100K buffering);
   *   #9  deterministic ordering by sequence_number;
   *   #18 UTF-8 BOM; #19 RFC-5987 filename.
   */
  @Post('export.csv')
  @Permissions('audit.export')
  @Throttle({ default: { limit: 3, ttl: 5 * 60_000 } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@Req() req: Request, @Query() q: AuditExportQueryDto, @Res() res: Response) {
    const from = new Date(q.fromDate);
    const to = new Date(q.toDate);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestAppException('toDate must be on or after fromDate');
    }
    const maxSpanDays = this.env.getNumber('AUDIT_EXPORT_MAX_RANGE_DAYS', 90);
    if (to.getTime() - from.getTime() > maxSpanDays * DAY_MS) {
      throw new BadRequestAppException(
        `Date range exceeds the ${maxSpanDays}-day export limit. Narrow the window.`,
      );
    }

    const mode = q.mode ?? 'redacted';
    if (mode === 'full') {
      // #6/#7 — full (un-redacted) export needs the higher permission. The
      // PermissionsGuard already cleared audit.export; assert the elevated one.
      await this.assertFullExportPermission(req);
    }

    const where: any = { createdAt: { gte: from, lte: to } };
    if (q.module) where.module = q.module;
    if (q.resource) where.resource = q.resource;
    if (q.resourceId) where.resourceId = q.resourceId;
    if (q.actorId) where.actorId = q.actorId;
    if (q.action) where.action = q.action;

    // #4 — refuse a too-large export up front rather than truncating silently.
    const maxRows = this.env.getNumber('AUDIT_EXPORT_MAX_ROWS', 100_000);
    const count = await this.prisma.auditLog.count({ where });
    if (count > maxRows) {
      throw new BadRequestAppException(
        `Export matches ${count} rows, exceeding the ${maxRows}-row limit. Narrow the filters or date range.`,
      );
    }

    const slug = `audit_${mode}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    // With @Res() (manual mode) the @Header decorator may not apply, so set the
    // content type explicitly alongside the disposition.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // #19 — RFC-5987 + a plain ASCII fallback.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slug}.csv"; filename*=UTF-8''${encodeURIComponent(slug)}.csv`,
    );

    const headers = [
      'id', 'sequence_number', 'created_at', 'actor_id', 'actor_role', 'actor_type',
      'module', 'resource', 'resource_id', 'action', 'request_id', 'ip',
      'user_agent', 'prev_hash', 'hash', 'schema_version', 'old_value', 'new_value', 'metadata',
    ];
    // #18 — UTF-8 BOM so Excel renders Indic / accented content.
    res.write('\uFEFF');
    res.write(headers.map(escapeCsvField).join(',') + '\n');

    // #8 — stream in cursor batches; never buffer the whole set.
    const BATCH = 2_000;
    let cursorSeq: bigint | null = null;
    let exported = 0;
    for (;;) {
      // Annotated any[] — `where` is already `any`, and the explicit type
      // breaks a TS7022 self-referential-inference cycle from findMany(any).
      const rows: any[] = await this.prisma.auditLog.findMany({
        where: cursorSeq != null ? { ...where, sequenceNumber: { gt: cursorSeq } } : where,
        orderBy: { sequenceNumber: 'asc' }, // #9 deterministic
        take: BATCH,
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        res.write(this.rowToCsvLine(r, mode, headers));
        exported += 1;
      }
      cursorSeq = rows[rows.length - 1].sequenceNumber;
      if (rows.length < BATCH) break;
    }

    res.end();

    // #2 — self-audit (after the stream so a download failure doesn't log a
    // success). Best-effort; never throw out of an already-sent response.
    try {
      await this.audit.writeAuditLog({
        actorId: this.actorId(req),
        actorType: 'ADMIN',
        action: AUDIT_SELF_ACTIONS.EXPORTED,
        module: 'audit',
        resource: 'AuditLog',
        requestId: (req.headers['x-request-id'] as string) || undefined,
        metadata: {
          mode,
          rowsExported: exported,
          filters: {
            fromDate: q.fromDate, toDate: q.toDate,
            module: q.module, resource: q.resource, resourceId: q.resourceId,
            actorId: q.actorId, action: q.action,
          },
        },
      });
    } catch {
      /* response already streamed; audit failure is logged by the facade */
    }
  }

  private async assertFullExportPermission(req: Request): Promise<void> {
    const perms: string[] = (req as any)?.user?.permissions ?? (req as any)?.permissions ?? [];
    if (Array.isArray(perms) && (perms.includes('audit.export.full') || perms.includes('*'))) {
      return;
    }
    // 403 if the elevated grant is absent.
    throw new ForbiddenAppException(
      'mode=full requires the audit.export.full permission.',
    );
  }

  private rowToCsvLine(
    r: {
      id: string; sequenceNumber: bigint; createdAt: Date;
      actorId: string | null; actorRole: string | null; actorType: string | null;
      module: string; resource: string; resourceId: string | null; action: string;
      requestId: string | null; ipAddress: string | null; userAgent: string | null;
      prevHash: string | null; hash: string; schemaVersion: number;
      oldValue: unknown; newValue: unknown; metadata: unknown;
    },
    mode: 'redacted' | 'full',
    headers: string[],
  ): string {
    const redacted = mode === 'redacted';
    const json = (v: unknown): string =>
      redacted ? '[redacted]' : maskEmailsInText(v == null ? '' : JSON.stringify(v));
    const cells: Record<string, unknown> = {
      id: r.id,
      sequence_number: r.sequenceNumber.toString(),
      created_at: r.createdAt.toISOString(),
      actor_id: r.actorId,
      actor_role: r.actorRole,
      actor_type: r.actorType,
      module: r.module,
      resource: r.resource,
      resource_id: r.resourceId,
      action: r.action,
      request_id: r.requestId,
      ip: redacted ? maskIp(r.ipAddress) : r.ipAddress,
      user_agent: redacted ? '[redacted]' : r.userAgent,
      prev_hash: r.prevHash,
      hash: r.hash,
      schema_version: r.schemaVersion,
      old_value: json(r.oldValue),
      new_value: json(r.newValue),
      metadata: json(r.metadata),
    };
    return headers.map((h) => escapeCsvField(cells[h])).join(',') + '\n';
  }
}

/** Serialize an AuditLog row for JSON: BigInt sequenceNumber → string. */
function serializeRow(row: any) {
  return {
    ...row,
    sequenceNumber:
      row.sequenceNumber != null ? row.sequenceNumber.toString() : null,
    // The FE expects `payload` (the JSON change-set); surface oldValue/newValue
    // under that key for the detail drawer.
    payload: { oldValue: row.oldValue, newValue: row.newValue, metadata: row.metadata },
  };
}

/** Phase 204 (#1) — map the service result to the FE's verify contract. */
function toFeVerifyShape(data: {
  anchorSequence: number | null;
  anchorCreatedAt: Date | null;
  rowsChecked: number;
  breaks: Array<{
    id: string | null;
    issueType: string;
    severity: string;
    reason: string;
    createdAt: Date | null;
  }>;
}) {
  return {
    scanned: data.rowsChecked,
    fromAnchorAt: data.anchorCreatedAt ? data.anchorCreatedAt.toISOString() : null,
    anchorSequence: data.anchorSequence,
    breaks: data.breaks.map((b) => ({
      id: b.id,
      createdAt: b.createdAt ? b.createdAt.toISOString() : null,
      issueType: b.issueType,
      severity: b.severity,
      reason: b.reason,
    })),
  };
}
