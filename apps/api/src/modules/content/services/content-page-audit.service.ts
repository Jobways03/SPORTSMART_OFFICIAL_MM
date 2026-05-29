import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 49 (2026-05-21) — best-effort writes to
 * content_page_audit_logs. Used by the static-page + FAQ services on
 * every CREATE / UPDATE / DELETE / PUBLISH / UNPUBLISH / RESTORE
 * transition so legal can answer "what was live on this date" for
 * DPDP-style audits.
 *
 * A failure here logs but does NOT throw — the source of truth is
 * the static-page row itself; the audit log is the mirror.
 */

export type ContentPageAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'RESTORE';

export type ContentPageAuditResource = 'PAGE' | 'FAQ';

@Injectable()
export class ContentPageAuditService {
  private readonly logger = new Logger(ContentPageAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    resourceType: ContentPageAuditResource;
    resourceId: string;
    action: ContentPageAuditAction;
    prevTitle?: string | null;
    prevBody?: string | null;
    newTitle?: string | null;
    newBody?: string | null;
    actorId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.contentPageAuditLog.create({
        data: {
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          action: entry.action,
          prevTitle: entry.prevTitle ?? null,
          prevBody: entry.prevBody ?? null,
          newTitle: entry.newTitle ?? null,
          newBody: entry.newBody ?? null,
          actorId: entry.actorId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `ContentPageAuditLog write failed for ${entry.resourceType}:${entry.resourceId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async list(
    resourceType: ContentPageAuditResource,
    resourceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.contentPageAuditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
