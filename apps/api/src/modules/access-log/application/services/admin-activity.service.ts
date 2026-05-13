import { Injectable } from '@nestjs/common';
import {
  AccessActorType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * PR 4 — unified Admin Activity timeline.
 *
 * Merges authentication events from `access_logs` (LOGIN_SUCCESS / LOGOUT
 * / TOKEN_REFRESH / etc.) with business-action events from
 * `admin_action_audit_logs` (role.created, seller_impersonated, ...).
 *
 * Both streams already exist independently; this service just joins them
 * by adminId + role + time window so an operator can see one stream
 * instead of cross-referencing two tables.
 *
 * Read-only. No writes from this service.
 */
export type ActivitySource = 'AUTH' | 'BUSINESS';

export interface ActivityItem {
  source: ActivitySource;
  // Stable id for the React key — prefixed so we never collide between
  // tables. `auth:<accessLogId>` or `biz:<adminActionAuditLogId>`.
  id: string;
  actorId: string;
  actorRole: string | null;
  // For AUTH: AccessEventKind (LOGIN_SUCCESS, etc.).
  // For BUSINESS: the actionType column (admin.action.role.created, etc.).
  kind: string;
  ipAddress: string | null;
  userAgent: string | null;
  // BUSINESS rows carry an arbitrary payload (the original event payload)
  // so the UI can show e.g. which roleId was created.
  metadata: unknown;
  succeeded: boolean | null;
  reason: string | null;
  createdAt: Date;
}

@Injectable()
export class AdminActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async timeline(args: {
    actorRole?: string;
    actorId?: string;
    actorType?: AccessActorType;
    hours?: number;
    limit?: number;
    // PR 4.1 — restrict to one stream. Useful for the RBAC dashboard
    // card which only wants admin_action_audit_logs rows.
    source?: 'AUTH' | 'BUSINESS';
  }): Promise<{ items: ActivityItem[]; since: string; hours: number }> {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 30));
    const limit = Math.min(args.limit ?? 200, 500);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const fetchAuth = args.source !== 'BUSINESS';
    const fetchBusiness = args.source !== 'AUTH';

    // ── AUTH stream — access_logs ──────────────────────────────────────
    const accessRows = fetchAuth
      ? await this.prisma.accessLog.findMany({
          where: (() => {
            const w: Prisma.AccessLogWhereInput = {
              createdAt: { gte: since },
              actorType: args.actorType ?? ('ADMIN' as AccessActorType),
            };
            if (args.actorRole) w.actorRole = args.actorRole;
            if (args.actorId) w.actorId = args.actorId;
            return w;
          })(),
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
      : [];

    // ── BUSINESS stream — admin_action_audit_logs ──────────────────────
    // No actorRole column on this table (it's per-admin, not per-role),
    // so when filtering by role we resolve admin ids first. For an
    // unscoped query this is the full window.
    let businessRows: any[] = [];
    if (fetchBusiness) {
      const businessWhere: Prisma.AdminActionAuditLogWhereInput = {
        createdAt: { gte: since },
      };
      if (args.actorId) businessWhere.adminId = args.actorId;
      if (args.actorRole && !args.actorId) {
        const admins = await this.prisma.admin.findMany({
          where: { role: args.actorRole as any },
          select: { id: true },
          take: 1000,
        });
        businessWhere.adminId = { in: admins.map((a) => a.id) };
      }
      businessRows = await this.prisma.adminActionAuditLog.findMany({
        where: businessWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    const items: ActivityItem[] = [
      ...accessRows.map<ActivityItem>((r) => ({
        source: 'AUTH',
        id: `auth:${r.id}`,
        actorId: r.actorId,
        actorRole: r.actorRole,
        kind: r.kind,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata ?? null,
        succeeded: r.succeeded,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      ...businessRows.map<ActivityItem>((r) => ({
        source: 'BUSINESS',
        id: `biz:${r.id}`,
        actorId: r.adminId,
        // BUSINESS rows have no actorRole column. Filling in from the
        // request filter is intentional — if you asked "show me
        // SUPER_ADMIN activity", every row in the result IS by a
        // SUPER_ADMIN at request time. Null otherwise.
        actorRole: args.actorRole ?? null,
        kind: r.actionType,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata ?? null,
        succeeded: null,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return { items, since: since.toISOString(), hours };
  }
}
