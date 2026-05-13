import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AccessActorType,
  AccessEventKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

export interface RecordAccessInput {
  actorType: AccessActorType;
  actorId: string;
  // Optional sub-role within actorType. For ADMIN: SUPER_ADMIN /
  // SELLER_ADMIN / SELLER_SUPPORT / SELLER_OPERATIONS / AFFILIATE_ADMIN.
  // Leave undefined for failed-login (role unknown until authenticated)
  // and for non-admin actor types that don't carry sub-roles today.
  actorRole?: string | null;
  kind: AccessEventKind;
  ipAddress?: string | null;
  userAgent?: string | null;
  succeeded?: boolean;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  /**
   * Stable hash for "device" — combines UA + first three IP octets.
   * Avoids exact-IP fingerprinting while still detecting major changes
   * (different network, different browser).
   */
  static deviceHash(ua?: string | null, ip?: string | null): string {
    const ipPrefix = (ip ?? '').split('.').slice(0, 3).join('.');
    return createHash('sha256').update(`${ua ?? ''}|${ipPrefix}`).digest('hex').slice(0, 32);
  }

  async record(input: RecordAccessInput): Promise<void> {
    const deviceHash = AccessLogService.deviceHash(input.userAgent, input.ipAddress);

    await this.prisma.accessLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        actorRole: input.actorRole ?? null,
        kind: input.kind,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash,
        succeeded: input.succeeded ?? true,
        reason: input.reason,
        metadata: input.metadata,
      },
    });

    // Lockout: 5+ LOGIN_FAILURE for the same CUSTOMER actor within 15
    // minutes locks the account for 30 minutes. Other actor types use
    // their own lockout fields if/when added; for now we only act on
    // CUSTOMER since the User table is the only one with lockUntil.
    if (input.kind === 'LOGIN_FAILURE' && input.actorType === 'CUSTOMER') {
      await this.maybeLockCustomer(input.actorId);
    }

    // New-device alert: only when LOGIN_SUCCESS comes from a device
    // hash this CUSTOMER hasn't used before. Email goes via the
    // notifications module.
    if (input.kind === 'LOGIN_SUCCESS' && input.actorType === 'CUSTOMER') {
      const seenBefore = await this.prisma.accessLog.count({
        where: {
          actorType: input.actorType,
          actorId: input.actorId,
          deviceHash,
          kind: 'LOGIN_SUCCESS',
          NOT: { id: undefined },
        },
      });
      if (seenBefore <= 1) {
        await this.flagNewDevice(input);
      }
    }
  }

  private async maybeLockCustomer(actorId: string): Promise<void> {
    // actorId for LOGIN_FAILURE is the email (not yet a real userId).
    // Resolve the user; if no match, skip — the failure is meaningful
    // for the spike detector but not for lockout.
    const user = await this.prisma.user.findUnique({
      where: { email: actorId },
      select: { id: true, failedLoginAttempts: true, lockUntil: true },
    });
    if (!user) return;

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentFails = await this.prisma.accessLog.count({
      where: {
        actorType: 'CUSTOMER',
        actorId, // email
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: fifteenMinAgo },
      },
    });

    if (recentFails >= 5) {
      const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          lockUntil,
        },
      });
      this.logger.warn(
        `User ${user.id} locked until ${lockUntil.toISOString()} after ${recentFails} failed logins`,
      );
    } else {
      // Still increment counter for visibility, but don't lock yet.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    }
  }

  private async flagNewDevice(input: RecordAccessInput): Promise<void> {
    await this.prisma.accessLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        actorRole: input.actorRole ?? null,
        kind: 'NEW_DEVICE_DETECTED',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash: AccessLogService.deviceHash(input.userAgent, input.ipAddress),
        succeeded: true,
        metadata: input.metadata,
      },
    });

    try {
      await this.notifications.notifyFromTemplate({
        eventClass: 'security',
        templateKey: 'security.new_device_login',
        recipientId: input.actorId,
        vars: {
          customerName: '',
          loginTime: new Date().toLocaleString('en-IN'),
          ipAddress: input.ipAddress ?? 'unknown',
          userAgent: input.userAgent ?? 'unknown',
          accessHistoryUrl: '/account/access-history',
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to enqueue new-device notification: ${(e as Error).message}`);
    }
  }

  async listForActor(args: {
    actorType: AccessActorType;
    actorId: string;
    kind?: AccessEventKind;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }) {
    const limit = Math.min(args.limit ?? 50, 500);
    const where: Prisma.AccessLogWhereInput = {
      actorType: args.actorType,
      actorId: args.actorId,
    };
    if (args.kind) where.kind = args.kind;
    if (args.fromDate || args.toDate) {
      where.createdAt = {};
      if (args.fromDate) where.createdAt.gte = args.fromDate;
      if (args.toDate) where.createdAt.lte = args.toDate;
    }
    return this.prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Phase 4 (PR 3) — list access events for a given admin sub-role
   * (SUPER_ADMIN, SELLER_ADMIN, SELLER_OPERATIONS, SELLER_SUPPORT,
   * AFFILIATE_ADMIN). Powers the "By admin role" tab in the admin
   * access-logs dashboard so security ops can scope brute-force or
   * activity review to a particular tier of admin.
   *
   * actorType defaults to ADMIN since that's the only actor type with
   * sub-roles today, but we accept any to keep the door open for future
   * sub-roles on SELLER / FRANCHISE / AFFILIATE.
   */
  async listByRole(args: {
    actorRole: string;
    actorType?: AccessActorType;
    kind?: AccessEventKind;
    hours?: number;
    limit?: number;
  }) {
    const limit = Math.min(args.limit ?? 100, 500);
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 30));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where: Prisma.AccessLogWhereInput = {
      actorRole: args.actorRole,
      createdAt: { gte: since },
    };
    if (args.actorType) where.actorType = args.actorType;
    if (args.kind) where.kind = args.kind;

    const items = await this.prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      actorRole: args.actorRole,
      actorType: args.actorType ?? null,
      since: since.toISOString(),
      hours,
      items,
    };
  }

  /**
   * Phase 4 (PR 3.1) — recent-actors quick-pick. Returns the most
   * recently-active distinct actors of a given type within the window,
   * with a row count + last-seen + last-event-kind for each. Powers the
   * "Recent actors" panel on the Per-actor lookup tab so an operator
   * doesn't need to paste a UUID to start a forensic search.
   *
   * Cap is small (50) because this feeds a UI list; expanding beyond
   * that is what the spike summary or by-role dashboard is for.
   */
  async recentActors(args: {
    actorType: AccessActorType;
    actorRole?: string;
    hours?: number;
    limit?: number;
  }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24 * 7, 24 * 30));
    const limit = Math.min(args.limit ?? 20, 50);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // groupBy by actorId, with COUNT(*) + MAX(createdAt). The
    // last-event-kind needs a second pass — Prisma groupBy doesn't
    // expose a "row at max(createdAt)" without a join, but a per-actor
    // findFirst at this row count is fine.
    const where: Prisma.AccessLogWhereInput = {
      actorType: args.actorType,
      createdAt: { gte: since },
    };
    if (args.actorRole) where.actorRole = args.actorRole;

    const groups = await this.prisma.accessLog.groupBy({
      by: ['actorId', 'actorRole'],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit,
    });

    // For each actor, fetch the most recent row to get the latest event
    // kind. N small queries, where N ≤ 50.
    const baseItems = await Promise.all(
      groups.map(async (g) => {
        const latest = await this.prisma.accessLog.findFirst({
          where: { actorType: args.actorType, actorId: g.actorId },
          orderBy: { createdAt: 'desc' },
          select: { kind: true, succeeded: true, ipAddress: true },
        });
        return {
          actorType: args.actorType,
          actorId: g.actorId,
          actorRole: g.actorRole,
          eventCount: g._count._all,
          lastEventAt: g._max.createdAt,
          lastEventKind: latest?.kind ?? null,
          lastEventSucceeded: latest?.succeeded ?? null,
          lastEventIp: latest?.ipAddress ?? null,
          // Enriched below for ADMIN actors. Left null for other types
          // so the same row shape works across actor types.
          displayName: null as string | null,
          email: null as string | null,
          customRoles: null as string[] | null,
        };
      }),
    );

    // ── Identity enrichment ──────────────────────────────────────────
    // Without this, two SELLER_OPERATIONS admins look identical on the
    // dashboard (same role badge, only the UUID distinguishes them).
    // For SELLER actors the same logic surfaces shop name + email so an
    // operator viewing access logs knows which store an event came from.
    // Failed-login rows attribute by email (no admin/seller row exists
    // for unknown emails) — for those, populate `email` from `actorId`
    // so the operator still sees a human-readable label.
    if (args.actorType === 'ADMIN') {
      const ids = baseItems.map((r) => r.actorId);
      // Real admin rows (actorId is a UUID).
      const admins = await this.prisma.admin.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, role: true },
      });
      const adminById = new Map(admins.map((a) => [a.id, a]));

      // Custom role assignments per admin id.
      const assignments = await this.prisma.adminRoleAssignment.findMany({
        where: { adminId: { in: admins.map((a) => a.id) } },
        include: {
          role: { select: { name: true, isSystem: true } },
        },
      });
      const customRolesByAdmin = new Map<string, string[]>();
      for (const a of assignments) {
        if (a.role.isSystem) continue; // skip the SYSTEM_ROLE_PERMISSIONS mirrors
        const list = customRolesByAdmin.get(a.adminId) ?? [];
        list.push(a.role.name);
        customRolesByAdmin.set(a.adminId, list);
      }

      for (const r of baseItems) {
        const admin = adminById.get(r.actorId);
        if (admin) {
          r.displayName = admin.name;
          r.email = admin.email;
          // Prefer the live `admins.role` over the access-log snapshot
          // since a role change after the row was written would otherwise
          // show stale data.
          r.actorRole = r.actorRole ?? admin.role;
          r.customRoles = customRolesByAdmin.get(admin.id) ?? [];
        } else if (r.actorId.includes('@')) {
          // Failed-login pseudo-actor: attribute by the email itself.
          r.email = r.actorId;
        }
      }
    } else if (args.actorType === 'SELLER') {
      // Surface shop name + owner name + email so the recent-actors
      // cards identify which store an event came from. Sellers have no
      // admin-style RBAC layered on top, so customRoles stays null.
      const ids = baseItems.map((r) => r.actorId);
      const sellers = await this.prisma.seller.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sellerName: true,
          sellerShopName: true,
          email: true,
        },
      });
      const sellerById = new Map(sellers.map((s) => [s.id, s]));
      for (const r of baseItems) {
        const seller = sellerById.get(r.actorId);
        if (seller) {
          // Shop name reads more naturally as the title ("Sportsmart Goa")
          // than the legal-name field which is often the owner's name.
          // Fall back to legal name if the shop name was never set.
          r.displayName = seller.sellerShopName || seller.sellerName;
          r.email = seller.email;
        } else if (r.actorId.includes('@')) {
          r.email = r.actorId;
        }
      }
    }

    return {
      actorType: args.actorType,
      since: since.toISOString(),
      hours,
      items: baseItems,
    };
  }

  /**
   * Phase 4 (PR 3.2) — raw LOGIN_FAILURE event stream. Complements the
   * spike summary (which is aggregated and only fires above a threshold)
   * by giving the operator a continuous view of individual failed-login
   * events. Lets you see one-off typos, expired-token failures, or
   * low-volume reconnaissance that would never trip the spike detector.
   */
  async recentFailures(args: {
    actorType?: AccessActorType;
    hours?: number;
    limit?: number;
  }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 30));
    const limit = Math.min(args.limit ?? 50, 200);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where: Prisma.AccessLogWhereInput = {
      kind: 'LOGIN_FAILURE',
      createdAt: { gte: since },
    };
    if (args.actorType) where.actorType = args.actorType;

    const items = await this.prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { since: since.toISOString(), hours, items };
  }

  /**
   * Failed-login spike summary. Returns actors with N+ LOGIN_FAILURE
   * rows in the last `hours` hours, sorted by failure count desc. Used
   * by the ops console to spot brute-force attempts before they escalate.
   */
  async failedLoginSpike(args: {
    minFailures?: number;
    hours?: number;
  }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 7));
    const minFailures = Math.max(2, args.minFailures ?? 5);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.prisma.accessLog.groupBy({
      by: ['actorType', 'actorId', 'ipAddress'],
      where: {
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: since },
      },
      _count: { _all: true },
      _max: { createdAt: true },
      having: { id: { _count: { gte: minFailures } } },
      orderBy: { _count: { id: 'desc' } },
      take: 100,
    });

    return {
      since: since.toISOString(),
      hours,
      minFailures,
      items: rows.map((r) => ({
        actorType: r.actorType,
        actorId: r.actorId,
        ipAddress: r.ipAddress,
        failureCount: r._count._all,
        lastFailureAt: r._max.createdAt,
      })),
    };
  }
}
