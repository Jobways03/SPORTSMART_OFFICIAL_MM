import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 48 (2026-05-21) — best-effort writes to menu_audit_logs.
 * Used by the menu service on every CREATE / UPDATE / DELETE / REORDER
 * transition so marketing + compliance can answer "who changed the
 * cricket nav link on July 4" without trawling app logs.
 *
 * A failure here logs but does NOT throw — the source of truth is the
 * menu / item row itself; the audit log is the mirror.
 */

export type MenuAuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'REORDER';
export type MenuAuditResource = 'MENU' | 'MENU_ITEM';

@Injectable()
export class MenuAuditService {
  private readonly logger = new Logger(MenuAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    resourceType: MenuAuditResource;
    resourceId: string;
    action: MenuAuditAction;
    prevState?: Prisma.InputJsonValue | null;
    newState?: Prisma.InputJsonValue | null;
    actorId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.menuAuditLog.create({
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
        `MenuAuditLog write failed for ${entry.resourceType}:${entry.resourceId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async list(
    resourceType: MenuAuditResource,
    resourceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.menuAuditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
