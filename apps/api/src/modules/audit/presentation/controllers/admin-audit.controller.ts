import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AuditChainAnchorService } from '../../application/services/audit-chain-anchor.service';

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
  ) {}

  @Get('logs')
  @Permissions('audit.read')
  async list(
    @Query('module') module?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parseInt(page || '1', 10) || 1;
    const l = Math.min(parseInt(limit || '100', 10) || 100, 500);
    const where: any = {};
    if (module) where.module = module;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { success: true, message: 'Audit logs', data: { items, total, page: p, limit: l } };
  }

  @Get('logs/:id')
  @Permissions('audit.read')
  async getOne(@Param('id') id: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Log not found');
    return { success: true, message: 'Log', data: row };
  }

  /**
   * Walk the hash chain and report any rows whose stored hash doesn't
   * match a recomputed sha256(prevHash + payload). Catches tampering or
   * application bugs that bypassed the facade.
   */
  /**
   * Phase 8 (PR 8.1) — fast-path verification using the latest anchor
   * pin. The legacy /verify-chain walks from genesis; this one walks
   * forward from the most recent anchor, so even at millions of audit
   * rows the response stays bounded.
   */
  @Get('verify-chain-fast')
  @Permissions('audit.read')
  async verifyChainFast(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '10000', 10) || 10000, 50_000);
    const data = await this.anchors.verifyFromLatestAnchor(take);
    return {
      success: true,
      message: data.breaks.length === 0 ? 'Chain healthy' : 'Chain breaks detected',
      data,
    };
  }

  @Get('verify-chain')
  @Permissions('audit.read')
  async verifyChain(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '1000', 10) || 1000, 10000);
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      take,
    });
    const { createHash } = await import('crypto');
    let prevHash: string | null = null;
    const breaks: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const payload = JSON.stringify({
        actorId: r.actorId,
        actorRole: r.actorRole,
        action: r.action,
        module: r.module,
        resource: r.resource,
        resourceId: r.resourceId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        metadata: r.metadata,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        ts: r.createdAt.toISOString(),
      });
      const expected = createHash('sha256')
        .update((prevHash ?? '') + '|' + payload)
        .digest('hex');
      if (r.prevHash !== prevHash) {
        breaks.push({ id: r.id, reason: 'prevHash mismatch' });
      } else if (r.hash && r.hash !== expected) {
        // ts-based hash recomputation is approximate (we used new Date()
        // at write time, not r.createdAt); flag as informational.
        breaks.push({ id: r.id, reason: 'hash recompute differs (timestamp-sensitive)' });
      }
      prevHash = r.hash;
    }
    return {
      success: true,
      message: `Walked ${rows.length} rows`,
      data: { rowsChecked: rows.length, breaks },
    };
  }

  // ── Event log query API (Sprint 2 Story 1.3) ──────────────────────
  // EventLog is the catalogue of every domain event published through
  // the outbox (ADR-008). Distinct from AuditLog (which records admin
  // actions) — EventLog captures what the SYSTEM did. Both are written
  // automatically; only AuditLog was queryable until now.

  /**
   * Paginated event log query. Filter by event name (`returns.return.approved`),
   * aggregate (the model — e.g. `Return`, `Order`), aggregate id, and
   * date range. Indexed columns: eventName, (aggregate, aggregateId),
   * createdAt — all supported filters hit an index.
   */
  @Get('events')
  @Permissions('audit.read')
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
    return {
      success: true,
      message: 'Event logs',
      data: { items, total, page: p, limit: l },
    };
  }

  /**
   * Event detail — full payload JSON for forensic / replay work.
   * Pair with the existing `verify-chain` endpoints when investigating
   * "did this event actually fire when audit says it did?"
   */
  @Get('events/:id')
  @Permissions('audit.read')
  async getEvent(@Param('id') id: string) {
    const row = await this.prisma.eventLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Event log not found');
    return { success: true, message: 'Event log', data: row };
  }

  @Get('export.csv')
  @Permissions('audit.read')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    // Filters mirror /admin/audit/logs one-for-one. Previously this
    // accepted only module + dates, so downloads silently included
    // rows the viewer had filtered out via resource/actor/action —
    // a real "what you see is not what you download" bug.
    @Query('module') module: string | undefined,
    @Query('resource') resource: string | undefined,
    @Query('resourceId') resourceId: string | undefined,
    @Query('actorId') actorId: string | undefined,
    @Query('action') action: string | undefined,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Res() res: Response,
  ) {
    const where: any = {};
    if (module) where.module = module;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100_000,
    });
    const header = 'created_at,actor_id,actor_role,module,resource,resource_id,action,ip\n';
    // CSV values may contain commas / quotes / newlines (esp. in
    // hand-typed reason strings). Escape per RFC 4180 — wrap in
    // double quotes and double-up any embedded quotes.
    const csvEscape = (v: string | null | undefined): string => {
      const s = (v ?? '').toString();
      if (s === '') return '';
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const body = rows
      .map((r) =>
        [
          csvEscape(r.createdAt.toISOString()),
          csvEscape(r.actorId),
          csvEscape(r.actorRole),
          csvEscape(r.module),
          csvEscape(r.resource),
          csvEscape(r.resourceId),
          csvEscape(r.action),
          csvEscape(r.ipAddress),
        ].join(','),
      )
      .join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
    res.send(header + body);
  }
}
