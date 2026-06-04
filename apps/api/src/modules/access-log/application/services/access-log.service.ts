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
  // Phase 207 (#16) / Phase 208 (#12) — per-request correlation id so an
  // access-log row can be tied back to the full request in the unified
  // audit/observability trail. Optional: callers thread it where they
  // have it; existing call sites are unaffected.
  requestId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Phase 201 (#1) — the ONLY shape the customer access-history surface
 * is allowed to emit. Deliberately omits deviceHash, reason, actorRole,
 * metadata, country and city. `newDevice` is a derived boolean (from the
 * success row's metadata) so the UI can badge a new-device sign-in
 * without ever seeing the raw metadata blob.
 */
export interface CustomerAccessHistoryItem {
  id: string;
  kind: AccessEventKind;
  ipAddress: string | null;
  userAgent: string | null;
  succeeded: boolean;
  createdAt: Date;
  newDevice: boolean;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  /**
   * Stable hash for "device" — combines UA + a coarse network prefix.
   *
   * Phase 201 (#5) — the prefix derivation is now IP-family aware. The
   * old code split on '.' and took the first three octets, which is an
   * IPv4-only assumption: an IPv6 client (where there is no '.') hashed
   * its WHOLE address, so every refresh from a rotating IPv6 suffix
   * (the norm on mobile / dual-stack networks) looked like a brand-new
   * device and spammed NEW_DEVICE_DETECTED alerts.
   *
   * Now:
   *   • IPv4  → first 3 octets   (a /24, e.g. 203.0.113.x)
   *   • IPv6  → first 4 hextets  (a /64, the standard subnet boundary)
   * Both keep enough entropy to notice a real network change while
   * tolerating the last-segment churn an ISP/CGNAT introduces.
   */
  static networkPrefix(ip?: string | null): string {
    const raw = (ip ?? '').trim();
    if (!raw) return '';
    // Strip an IPv6 zone id (fe80::1%eth0) if present.
    const addr = raw.split('%')[0] ?? raw;
    if (addr.includes(':')) {
      // IPv6 — truncate to the /64 network (first 4 hextets).
      // Phase 201 review fix: a naive split(':').slice(0,4) on a COMPRESSED
      // address (fe80::1 → ['fe80','','1']) yields 'fe80::1', so two hosts in
      // the SAME /64 (fe80::1, fe80::2) would get DIFFERENT prefixes — exactly
      // the spurious-new-device bug #5 set out to kill. Handle '::' explicitly:
      // the groups before '::' are the leading (routable) hextets; '::' elides
      // zeros, so the /64 prefix is those leading groups (≤4) followed by '::'.
      const lower = addr.toLowerCase();
      if (lower.includes('::')) {
        const lead = (lower.split('::')[0] ?? '')
          .split(':')
          .filter(Boolean)
          .slice(0, 4);
        return `${lead.join(':')}::`;
      }
      return lower.split(':').slice(0, 4).join(':');
    }
    // IPv4 — first 3 octets (/24).
    return addr.split('.').slice(0, 3).join('.');
  }

  static deviceHash(ua?: string | null, ip?: string | null): string {
    const ipPrefix = AccessLogService.networkPrefix(ip);
    return createHash('sha256').update(`${ua ?? ''}|${ipPrefix}`).digest('hex').slice(0, 32);
  }

  async record(input: RecordAccessInput): Promise<void> {
    const deviceHash = AccessLogService.deviceHash(input.userAgent, input.ipAddress);

    // Phase 201 (#9) — failed-login rows arrive with actorId = the
    // attacker-supplied email, NOT a userId. That means a customer can
    // never see their OWN failed sign-ins (their history is keyed by
    // their userId). Resolve the email to a real user; when it matches,
    // store actorId = user.id (so the row joins the customer's history)
    // and keep the raw attempted email in metadata.attemptedEmail for
    // the admin brute-force tooling. When it doesn't match a user we
    // fall back to the email so reconnaissance against unknown accounts
    // is still attributable in the admin spike detector.
    let actorId = input.actorId;
    let resolvedUserId: string | null = null;
    let metadata = input.metadata;
    if (
      input.kind === 'LOGIN_FAILURE' &&
      input.actorType === 'CUSTOMER' &&
      typeof input.actorId === 'string' &&
      input.actorId.includes('@')
    ) {
      const matched = await this.prisma.user
        .findUnique({ where: { email: input.actorId }, select: { id: true } })
        .catch(() => null);
      if (matched) {
        resolvedUserId = matched.id;
        actorId = matched.id;
        // Preserve the attempted email for forensics without leaking it
        // to the customer surface (listForCustomer never selects metadata).
        metadata = {
          ...(typeof input.metadata === 'object' && input.metadata
            ? (input.metadata as Record<string, unknown>)
            : {}),
          attemptedEmail: input.actorId,
        } as Prisma.InputJsonValue;
      }
    }

    // Phase 201 (#10) — for a successful login from a not-seen-before
    // device we used to write TWO rows at the same instant
    // (LOGIN_SUCCESS + NEW_DEVICE_DETECTED), which read as a confusing
    // duplicate in the customer's history. Decide newness BEFORE the
    // insert and fold the signal into the success row's metadata; the
    // standalone NEW_DEVICE_DETECTED row is no longer written.
    let isNewDevice = false;
    if (input.kind === 'LOGIN_SUCCESS' && input.actorType === 'CUSTOMER') {
      const seenBefore = await this.prisma.accessLog.count({
        where: {
          actorType: input.actorType,
          actorId,
          deviceHash,
          kind: 'LOGIN_SUCCESS',
        },
      });
      isNewDevice = seenBefore === 0;
      if (isNewDevice) {
        metadata = {
          ...(typeof metadata === 'object' && metadata
            ? (metadata as Record<string, unknown>)
            : {}),
          newDevice: true,
        } as Prisma.InputJsonValue;
      }
    }

    await this.prisma.accessLog.create({
      data: {
        actorType: input.actorType,
        actorId,
        actorRole: input.actorRole ?? null,
        kind: input.kind,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash,
        succeeded: input.succeeded ?? true,
        reason: input.reason,
        // Phase 207 (#16) / Phase 208 (#12) — correlation id passthrough.
        requestId: input.requestId ?? null,
        metadata,
      },
    });

    // Lock-only safety net for credential stuffing. The authoritative
    // per-account lockout lives in LoginUserUseCase
    // (recordFailedLoginAtomic — atomic increment of failedLoginAttempts
    // keyed on the resolved user.id, stamps lockUntil at the threshold,
    // cleared on success). We deliberately DO NOT touch
    // failedLoginAttempts here anymore: the previous code re-incremented
    // it on every failure, racing the use-case's counter ~2× ahead and
    // tripping the lock at ~3 real attempts (Phase 201 #7/#14). This
    // path now only STAMPS lockUntil when a per-(user, IP) burst of
    // AccessLog failure rows crosses the threshold — a coarse,
    // IP-scoped backstop that never corrupts the canonical counter.
    if (
      input.kind === 'LOGIN_FAILURE' &&
      input.actorType === 'CUSTOMER' &&
      resolvedUserId
    ) {
      await this.maybeLockCustomer(resolvedUserId, input.ipAddress).catch(
        (e) =>
          this.logger.warn(
            `maybeLockCustomer failed for ${resolvedUserId}: ${(e as Error).message}`,
          ),
      );
    }

    // Phase 201 (#14) — a clean successful sign-in must zero out the
    // failed-attempt counter so a user who nearly hit the lock doesn't
    // carry stale state. The login use-case already does this on its
    // happy path, but record() is the single funnel every auth surface
    // calls, so we make the reset idempotent + best-effort here too.
    if (input.kind === 'LOGIN_SUCCESS' && input.actorType === 'CUSTOMER') {
      await this.prisma.user
        .updateMany({
          where: {
            id: actorId,
            OR: [{ failedLoginAttempts: { gt: 0 } }, { lockUntil: { not: null } }],
          },
          data: { failedLoginAttempts: 0, lockUntil: null },
        })
        .catch(() => undefined);

      if (isNewDevice) {
        await this.notifyNewDevice(input);
      }
    }
  }

  /**
   * Lock-only backstop. NEVER mutates failedLoginAttempts (that counter
   * is owned atomically by LoginUserUseCase). Counts recent AccessLog
   * LOGIN_FAILURE rows for this user from the SAME IP and, past the
   * threshold, stamps lockUntil. IP-scoping (Phase 201 #7) means a
   * distributed attacker can't trivially lock a victim out from many
   * source IPs via this path; the per-IP @Throttle + per-email Redis
   * soft-lock cover the rotating-IP case.
   */
  private async maybeLockCustomer(
    userId: string,
    ipAddress?: string | null,
  ): Promise<void> {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentFails = await this.prisma.accessLog.count({
      where: {
        actorType: 'CUSTOMER',
        actorId: userId,
        ipAddress: ipAddress ?? undefined,
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: fifteenMinAgo },
      },
    });

    if (recentFails >= 5) {
      const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      // Lock-only: do not increment the counter. Guard on the user
      // still existing via updateMany so a deleted user is a no-op.
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: { lockUntil },
      });
      this.logger.warn(
        `User ${userId} locked until ${lockUntil.toISOString()} after ${recentFails} failed logins from ${ipAddress ?? 'unknown IP'}`,
      );
    }
  }

  /**
   * Phase 201 (#10) — notification-only. The standalone
   * NEW_DEVICE_DETECTED row is no longer inserted (it was a confusing
   * same-timestamp duplicate of the LOGIN_SUCCESS row, which now carries
   * metadata.newDevice = true). The customer-facing security email is
   * still sent here.
   */
  private async notifyNewDevice(input: RecordAccessInput): Promise<void> {
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
   * Phase 201 (#1) — customer-safe access-history projection.
   *
   * The customer surface MUST NOT receive the raw AccessLog row. The
   * full row leaks:
   *   • deviceHash   — a stable cross-account fingerprint;
   *   • reason       — the raw exception text of a failed login, which
   *                    is a username-/state-enumeration oracle;
   *   • actorRole    — an internal RBAC label;
   *   • metadata     — attemptedEmail + free-form internal context;
   *   • full ip/ua   — kept, but only the masked subset is shown in UI.
   *
   * This method hard-whitelists the customer-safe columns via a Prisma
   * `select` (projection happens at the DB, the unsafe columns never
   * leave Postgres) and derives a single boolean `newDevice` flag from
   * metadata WITHOUT returning the metadata blob itself. listForActor
   * is intentionally left returning the full row for the admin/forensic
   * surface (admin-access-log.controller), which is gated by AdminAuthGuard.
   */
  async listForCustomer(args: {
    actorId: string;
    limit?: number;
  }): Promise<CustomerAccessHistoryItem[]> {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 500);
    const rows = await this.prisma.accessLog.findMany({
      where: { actorType: 'CUSTOMER', actorId: args.actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      // Explicit whitelist — deviceHash / reason / actorRole / metadata
      // / country / city are deliberately excluded. metadata is selected
      // ONLY to derive the newDevice flag and is dropped before return.
      select: {
        id: true,
        kind: true,
        ipAddress: true,
        userAgent: true,
        succeeded: true,
        createdAt: true,
        metadata: true,
      },
    });

    return rows.map((r) => {
      const meta =
        r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
          ? (r.metadata as Record<string, unknown>)
          : {};
      return {
        id: r.id,
        kind: r.kind,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        succeeded: r.succeeded,
        createdAt: r.createdAt,
        newDevice: meta.newDevice === true,
      };
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

  /**
   * Phase 207 (#6) — IP-level (distributed) brute-force detection.
   *
   * The (actorType, actorId, ipAddress) spike above and the per-(user,
   * IP) lockout backstop both miss CREDENTIAL STUFFING / PASSWORD SPRAY
   * from a single host against MANY different accounts: each (account, IP)
   * pair stays under the per-account threshold, so nothing fires, yet the
   * source IP is generating hundreds of failures. This groups failures by
   * source IP ONLY and surfaces IPs past a (deliberately higher) threshold,
   * with a distinct-account count so an operator can tell "1 account, 50
   * tries" (a forgetful user) from "50 accounts, 1 try each" (spray).
   *
   * distinctAccounts is computed with a second grouped query (Prisma
   * groupBy can't COUNT(DISTINCT actorId) in one pass); N is bounded by
   * the take(100) on the IP list so this stays cheap.
   */
  async failedLoginSpikeByIp(args: { minFailures?: number; hours?: number }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 7));
    const minFailures = Math.max(2, args.minFailures ?? 20);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.prisma.accessLog.groupBy({
      by: ['ipAddress'],
      where: {
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: since },
        // A null IP can't be attributed to a source host; excluding it
        // keeps the "one noisy IP" signal clean (those rows still show
        // in the per-account view).
        ipAddress: { not: null },
      },
      _count: { _all: true },
      _max: { createdAt: true },
      having: { id: { _count: { gte: minFailures } } },
      orderBy: { _count: { id: 'desc' } },
      take: 100,
    });

    // Distinct-account count per flagged IP. Second pass over the same
    // window, scoped to the flagged IPs only.
    const flaggedIps = rows
      .map((r) => r.ipAddress)
      .filter((ip): ip is string => ip !== null);
    const distinctByIp = new Map<string, Set<string>>();
    if (flaggedIps.length > 0) {
      const pairs = await this.prisma.accessLog.groupBy({
        by: ['ipAddress', 'actorId'],
        where: {
          kind: 'LOGIN_FAILURE',
          createdAt: { gte: since },
          ipAddress: { in: flaggedIps },
        },
      });
      for (const p of pairs) {
        if (!p.ipAddress) continue;
        const set = distinctByIp.get(p.ipAddress) ?? new Set<string>();
        set.add(p.actorId);
        distinctByIp.set(p.ipAddress, set);
      }
    }

    return {
      since: since.toISOString(),
      hours,
      minFailures,
      items: rows.map((r) => ({
        ipAddress: r.ipAddress,
        failureCount: r._count._all,
        distinctAccounts: r.ipAddress
          ? (distinctByIp.get(r.ipAddress)?.size ?? 0)
          : 0,
        lastFailureAt: r._max.createdAt,
      })),
    };
  }

  /**
   * Phase 207 (#6) — account-level (cross-IP) brute-force detection.
   *
   * The mirror of the IP view: a BOTNET hammering ONE victim account from
   * many rotating source IPs keeps each (account, IP) pair under the
   * per-(user, IP) lockout backstop, so the victim is targeted relentlessly
   * without ever tripping it. This groups failures by account ONLY across
   * all source IPs and surfaces accounts past the threshold, with a
   * distinct-IP count so spray-from-one-host (low distinctIps) reads
   * differently from a distributed botnet (high distinctIps).
   */
  async failedLoginSpikeByAccount(args: {
    minFailures?: number;
    hours?: number;
  }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 7));
    const minFailures = Math.max(2, args.minFailures ?? 10);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.prisma.accessLog.groupBy({
      by: ['actorType', 'actorId'],
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

    const flaggedActors = rows.map((r) => r.actorId);
    const distinctByActor = new Map<string, Set<string>>();
    if (flaggedActors.length > 0) {
      const pairs = await this.prisma.accessLog.groupBy({
        by: ['actorId', 'ipAddress'],
        where: {
          kind: 'LOGIN_FAILURE',
          createdAt: { gte: since },
          actorId: { in: flaggedActors },
        },
      });
      for (const p of pairs) {
        const set = distinctByActor.get(p.actorId) ?? new Set<string>();
        if (p.ipAddress) set.add(p.ipAddress);
        distinctByActor.set(p.actorId, set);
      }
    }

    return {
      since: since.toISOString(),
      hours,
      minFailures,
      items: rows.map((r) => ({
        actorType: r.actorType,
        actorId: r.actorId,
        failureCount: r._count._all,
        distinctIps: distinctByActor.get(r.actorId)?.size ?? 0,
        lastFailureAt: r._max.createdAt,
      })),
    };
  }
}
