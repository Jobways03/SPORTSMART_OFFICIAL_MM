import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 47 (2026-05-21) — owns writes to content_audit_logs. Used by
 * the slot + content services on every CREATE / UPDATE / DELETE /
 * UPLOAD / RESET transition so marketing + compliance can answer
 * "who touched the hero on July 4" without trawling app logs.
 *
 * Best-effort: a failure here logs but does NOT throw — the source
 * of truth is the slot / content row itself, the audit log is the
 * mirror.
 */

export type ContentAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'UPLOAD'
  | 'RESET';

export type ContentAuditResource = 'SLOT' | 'CONTENT_BLOCK';

@Injectable()
export class ContentAuditService {
  private readonly logger = new Logger(ContentAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    resourceType: ContentAuditResource;
    resourceId: string;
    action: ContentAuditAction;
    prevState?: Prisma.InputJsonValue | null;
    newState?: Prisma.InputJsonValue | null;
    actorId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.contentAuditLog.create({
        data: {
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          action: entry.action,
          prevState: entry.prevState ?? undefined,
          newState: entry.newState ?? undefined,
          actorId: entry.actorId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `ContentAuditLog write failed for ${entry.resourceType}:${entry.resourceId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Read the audit log for a resource. Used by the admin UI's
   * content-history panel.
   */
  async list(
    resourceType: ContentAuditResource,
    resourceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.contentAuditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
