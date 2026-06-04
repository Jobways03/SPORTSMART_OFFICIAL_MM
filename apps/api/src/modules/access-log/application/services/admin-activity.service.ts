import { Injectable } from '@nestjs/common';
import {
  AccessActorType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * PR 4 — unified Admin Activity timeline.
 *
 * Merges FOUR streams so an operator sees one timeline instead of
 * cross-referencing tables:
 *   • AUTH          — access_logs (LOGIN_SUCCESS / LOGOUT / TOKEN_REFRESH).
 *   • ADMIN_ACTION  — admin_action_audit_logs (role.created, ...). Event-
 *                     subscription style writes from the RBAC/admin flows.
 *   • BUSINESS      — audit_logs (the hash-chained business audit:
 *                     refund.approve, session.revoke, dispute.decide, ...).
 *                     Phase 208 (#1): pre-Phase-208 this stream was MISSING
 *                     entirely, so the timeline showed admin logins + RBAC
 *                     edits but NOT the actual money/state mutations the
 *                     same admins performed. Read with EXISTING columns
 *                     (actorId, actorRole, action, module, resource,
 *                     resourceId, createdAt).
 *   • IMPERSONATION — admin_impersonation_logs (Phase 208 #8): start/end of
 *                     seller/franchise impersonation, a high-value action
 *                     that was invisible here.
 *
 * Read-only. No writes from this service (the controller writes the
 * "timeline viewed" audit row — Phase 208 #5).
 */
export type ActivitySource =
  | 'AUTH'
  | 'ADMIN_ACTION'
  | 'BUSINESS'
  | 'IMPERSONATION';

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
    // card which only wants admin_action_audit_logs rows. Phase 208
    // widened the source set; an unknown/undefined source fetches all.
    source?: ActivitySource;
  }): Promise<{
    items: ActivityItem[];
    since: string;
    hours: number;
    // Phase 208 (#9) — true when at least one source returned a full
    // `perSourceLimit` page, so the merged+sliced result MAY be dropping
    // older events at the boundary. The UI surfaces this so an operator
    // knows to narrow the window rather than trust a silent cut.
    truncated: boolean;
  }> {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 30));
    const limit = Math.min(args.limit ?? 200, 500);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Phase 208 (#9) — over-fetch each source so the final merge+slice
    // isn't silently starved by one chatty stream. We pull up to 2× the
    // requested limit per source, merge, sort, then slice to `limit`.
    const perSourceLimit = Math.min(limit * 2, 1000);

    const fetchAuth = !args.source || args.source === 'AUTH';
    const fetchAdminAction = !args.source || args.source === 'ADMIN_ACTION';
    const fetchBusiness = !args.source || args.source === 'BUSINESS';
    const fetchImpersonation = !args.source || args.source === 'IMPERSONATION';

    // When filtering by role on the tables that have no actorRole column
    // (admin_action_audit_logs, audit_logs business rows keyed by admin,
    // impersonation logs), resolve the matching admin ids once and reuse.
    // audit_logs DOES carry actorRole, so it filters directly.
    let roleAdminIds: string[] | null = null;
    if (args.actorRole && !args.actorId) {
      const admins = await this.prisma.admin.findMany({
        where: { role: args.actorRole as any },
        select: { id: true },
        take: 2000,
      });
      roleAdminIds = admins.map((a) => a.id);
    }

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
          take: perSourceLimit,
        })
      : [];

    // ── ADMIN_ACTION stream — admin_action_audit_logs ──────────────────
    // Phase 208 (#4): the table now snapshots actor_role at write time;
    // prefer it and fall back to the request filter for legacy rows.
    let adminActionRows: any[] = [];
    if (fetchAdminAction) {
      const w: Prisma.AdminActionAuditLogWhereInput = {
        createdAt: { gte: since },
      };
      if (args.actorId) w.adminId = args.actorId;
      else if (roleAdminIds) w.adminId = { in: roleAdminIds };
      adminActionRows = await this.prisma.adminActionAuditLog.findMany({
        where: w,
        orderBy: { createdAt: 'desc' },
        take: perSourceLimit,
      });
    }

    // ── BUSINESS stream — audit_logs (Phase 208 #1) ────────────────────
    // The hash-chained business audit. Uses ONLY existing columns; does
    // NOT depend on any new audit column another agent may be adding.
    // audit_logs carries actorRole directly, so role filtering is exact.
    let businessRows: any[] = [];
    if (fetchBusiness) {
      const w: Prisma.AuditLogWhereInput = { createdAt: { gte: since } };
      if (args.actorId) w.actorId = args.actorId;
      else if (args.actorRole) w.actorRole = args.actorRole;
      businessRows = await this.prisma.auditLog.findMany({
        where: w,
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          action: true,
          module: true,
          resource: true,
          resourceId: true,
          metadata: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: perSourceLimit,
      });
    }

    // ── IMPERSONATION stream — admin_impersonation_logs (Phase 208 #8) ──
    // Each row yields up to two timeline events: STARTED (always) and
    // ENDED (when endedAt is set within the window). High-value action,
    // previously invisible on the timeline.
    let impersonationRows: any[] = [];
    if (fetchImpersonation) {
      const w: Prisma.AdminImpersonationLogWhereInput = {
        // Include rows that STARTED or ENDED in the window.
        OR: [
          { startedAt: { gte: since } },
          { endedAt: { gte: since } },
        ],
      };
      if (args.actorId) w.adminId = args.actorId;
      else if (roleAdminIds) w.adminId = { in: roleAdminIds };
      impersonationRows = await this.prisma.adminImpersonationLog.findMany({
        where: w,
        orderBy: { startedAt: 'desc' },
        take: perSourceLimit,
      });
    }

    const impersonationItems: ActivityItem[] = [];
    for (const r of impersonationRows) {
      const base = {
        actorId: r.adminId,
        actorRole: args.actorRole ?? null,
        ipAddress: r.ipAddress ?? null,
        userAgent: r.userAgent ?? null,
        succeeded: null as boolean | null,
      };
      if (r.startedAt && r.startedAt >= since) {
        impersonationItems.push({
          ...base,
          source: 'IMPERSONATION',
          id: `imp-start:${r.id}`,
          kind: 'IMPERSONATION_STARTED',
          metadata: {
            targetActorType: r.targetActorType,
            targetActorId: r.targetActorId,
          },
          reason: r.reason ?? null,
          createdAt: r.startedAt,
        });
      }
      if (r.endedAt && r.endedAt >= since) {
        impersonationItems.push({
          ...base,
          source: 'IMPERSONATION',
          id: `imp-end:${r.id}`,
          kind: 'IMPERSONATION_ENDED',
          metadata: {
            targetActorType: r.targetActorType,
            targetActorId: r.targetActorId,
            revokedAt: r.revokedAt ?? null,
          },
          reason: r.revokedReason ?? r.reason ?? null,
          createdAt: r.endedAt,
        });
      }
    }

    const merged: ActivityItem[] = [
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
      ...adminActionRows.map<ActivityItem>((r) => ({
        source: 'ADMIN_ACTION',
        id: `act:${r.id}`,
        actorId: r.adminId,
        // Phase 208 (#4) — truthful snapshotted role; fall back to the
        // request filter only for legacy rows where it's null.
        actorRole: r.actorRole ?? args.actorRole ?? null,
        kind: r.actionType,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata ?? null,
        succeeded: null,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      ...businessRows.map<ActivityItem>((r) => ({
        source: 'BUSINESS',
        id: `biz:${r.id}`,
        actorId: r.actorId ?? '',
        actorRole: r.actorRole ?? args.actorRole ?? null,
        // Surface "module.action" so the same business event reads
        // unambiguously next to AUTH kinds + ADMIN_ACTION action types.
        kind: r.module ? `${r.module}.${r.action}` : r.action,
        ipAddress: r.ipAddress ?? null,
        userAgent: r.userAgent ?? null,
        metadata: {
          ...(r.metadata && typeof r.metadata === 'object' ? r.metadata : {}),
          resource: r.resource,
          resourceId: r.resourceId ?? null,
        },
        succeeded: null,
        reason: null,
        createdAt: r.createdAt,
      })),
      ...impersonationItems,
    ];

    // Phase 208 (#9) — flag potential truncation: if any source filled a
    // full page, the merged window may be dropping older rows at the cut.
    const truncated =
      accessRows.length >= perSourceLimit ||
      adminActionRows.length >= perSourceLimit ||
      businessRows.length >= perSourceLimit ||
      impersonationRows.length >= perSourceLimit;

    const items = merged
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return { items, since: since.toISOString(), hours, truncated };
  }
}
