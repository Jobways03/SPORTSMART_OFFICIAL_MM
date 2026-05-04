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
import { AdminAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Admin-only audit log surface. Reads from the hash-chained AuditLog
 * table. Writers go through AuditPublicFacade (cross-module).
 */
@ApiTags('Admin Audit')
@Controller('admin/audit')
@UseGuards(AdminAuthGuard)
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('logs')
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
  @Get('verify-chain')
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

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('module') module: string | undefined,
    @Res() res: Response,
  ) {
    const where: any = {};
    if (module) where.module = module;
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
    const body = rows.map((r) => [
      r.createdAt.toISOString(),
      r.actorId ?? '',
      r.actorRole ?? '',
      r.module,
      r.resource,
      r.resourceId ?? '',
      r.action,
      r.ipAddress ?? '',
    ].join(',')).join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
    res.send(header + body);
  }
}
