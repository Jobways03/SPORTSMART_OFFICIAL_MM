import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

// Cross-table session representation. The five session tables (admins,
// users, sellers, franchises, affiliates) all have the same essential
// shape but different foreign-key columns, so we project them into one
// row type before returning so the FE doesn't need 5 separate fetches.
// Phase 27 (2026-05-21) — AFFILIATE added. Pre-Phase-27 the surface
// covered 4 actors only, leaving affiliate sessions unrevocable from
// the admin UI despite the table being fully populated by login + the
// guard validating revokedAt (Phase 22). Affiliates handle commission
// payouts so out-of-band session compromise is real.
export interface ActiveSessionRow {
  id: string;
  actorType: 'ADMIN' | 'USER' | 'SELLER' | 'FRANCHISE' | 'AFFILIATE';
  actorId: string;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  // Phase 209 (#4) — the session tables already carry lastUsedAt (Phase
  // 27, bumped on every refresh-rotation) + deviceLabel, but the admin
  // cross-actor list never projected them. Surfacing lastUsedAt lets an
  // operator tell a live session ("used 2 min ago") from a stale one
  // ("created 20 days ago, never refreshed") — the single most useful
  // signal when deciding which of an actor's sessions to revoke.
  lastUsedAt: Date | null;
  deviceLabel: string | null;
}

export type ActorType = ActiveSessionRow['actorType'];

interface ListFilters {
  actorType?: ActorType;
  actorId?: string;
  ipAddress?: string;
  limit?: number;
}

/**
 * Story 6.3 — admin session revocation surface.
 *
 * Lists active (`revokedAt IS NULL AND expiresAt > now`) refresh-token
 * sessions across all four actor tables and supports force-logout by
 * setting `revokedAt = now()`. Revocation is soft — the row stays for
 * audit replay. The next refresh-token call from the revoked session
 * lands in the rejection path because the guard checks `revokedAt`.
 *
 * Each revocation writes an AuditLog row (module=`security`,
 * resource=`session`) so the action is hash-chained alongside other
 * security events.
 */
@Injectable()
export class AdminSessionsService {
  private readonly logger = new Logger(AdminSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    // Phase 209 (#8) — emit security.session_revoked_by_admin so a
    // downstream handler can notify the booted actor ("an administrator
    // ended your session"). EventBusService is @Global, no module wiring.
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Phase 209 (#13) — reject a missing / literal-'unknown' revoker id.
   * The controller already fails closed when the guard didn't populate
   * adminId, but the service is the last line: a caller that passes
   * 'unknown' (the old controller fallback) would poison the audit log +
   * the self-protection check (an admin id of 'unknown' can never equal a
   * real session's adminId, silently defeating "can't revoke your own").
   */
  private assertRealRevoker(revokedByAdminId: string | undefined | null): string {
    if (!revokedByAdminId || revokedByAdminId === 'unknown') {
      throw new BadRequestException(
        'Revoking admin identity is missing or unresolved — refusing to revoke.',
      );
    }
    return revokedByAdminId;
  }

  async list(filters: ListFilters = {}): Promise<{
    items: ActiveSessionRow[];
    total: number;
  }> {
    const limit = Math.min(filters.limit ?? 200, 500);
    const now = new Date();
    const ipFilter = filters.ipAddress
      ? { ipAddress: filters.ipAddress }
      : {};

    const activeWhere = (idCol: Record<string, string | undefined>) => ({
      revokedAt: null,
      expiresAt: { gt: now },
      ...idCol,
      ...ipFilter,
    });

    // Fan out only to the actor tables the caller is interested in.
    // Without a filter, hit all four — uncommon but fine since the
    // result is already sorted+limited per-source.
    const want = (t: ActorType) => !filters.actorType || filters.actorType === t;

    const [adminRows, userRows, sellerRows, franchiseRows, affiliateRows] = await Promise.all([
      want('ADMIN')
        ? this.prisma.adminSession.findMany({
            where: activeWhere(filters.actorId ? { adminId: filters.actorId } : {}),
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              admin: {
                select: { id: true, email: true, name: true, role: true },
              },
            },
          })
        : Promise.resolve([]),
      want('USER')
        ? this.prisma.session.findMany({
            where: activeWhere(filters.actorId ? { userId: filters.actorId } : {}),
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              user: {
                select: { id: true, email: true, firstName: true, lastName: true },
              },
            },
          })
        : Promise.resolve([]),
      want('SELLER')
        ? this.prisma.sellerSession.findMany({
            where: activeWhere(filters.actorId ? { sellerId: filters.actorId } : {}),
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              seller: {
                select: { id: true, email: true, sellerName: true, sellerShopName: true },
              },
            },
          })
        : Promise.resolve([]),
      want('FRANCHISE')
        ? this.prisma.franchiseSession.findMany({
            where: activeWhere(filters.actorId ? { franchisePartnerId: filters.actorId } : {}),
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              franchisePartner: {
                select: { id: true, email: true, businessName: true },
              },
            },
          })
        : Promise.resolve([]),
      // Phase 27 (2026-05-21) — affiliate fan-out, parity with the
      // other 4 actor tables.
      want('AFFILIATE')
        ? this.prisma.affiliateSession.findMany({
            where: activeWhere(filters.actorId ? { affiliateId: filters.actorId } : {}),
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              affiliate: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const rows: ActiveSessionRow[] = [
      ...adminRows.map((s: any) => ({
        id: s.id,
        actorType: 'ADMIN' as const,
        actorId: s.adminId,
        actorEmail: s.admin?.email ?? null,
        actorName: s.admin?.name ?? null,
        actorRole: s.admin?.role ?? null,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
        deviceLabel: s.deviceLabel ?? null,
      })),
      ...userRows.map((s: any) => ({
        id: s.id,
        actorType: 'USER' as const,
        actorId: s.userId,
        actorEmail: s.user?.email ?? null,
        actorName: [s.user?.firstName, s.user?.lastName].filter(Boolean).join(' ') || null,
        actorRole: null,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
        deviceLabel: s.deviceLabel ?? null,
      })),
      ...sellerRows.map((s: any) => ({
        id: s.id,
        actorType: 'SELLER' as const,
        actorId: s.sellerId,
        actorEmail: s.seller?.email ?? null,
        actorName: s.seller?.sellerShopName ?? s.seller?.sellerName ?? null,
        actorRole: null,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
        deviceLabel: s.deviceLabel ?? null,
      })),
      ...franchiseRows.map((s: any) => ({
        id: s.id,
        actorType: 'FRANCHISE' as const,
        actorId: s.franchisePartnerId,
        actorEmail: s.franchisePartner?.email ?? null,
        actorName: s.franchisePartner?.businessName ?? null,
        actorRole: null,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
        // FranchiseSession also carries deviceLabel (Phase 27).
        deviceLabel: s.deviceLabel ?? null,
      })),
      ...affiliateRows.map((s: any) => ({
        id: s.id,
        actorType: 'AFFILIATE' as const,
        actorId: s.affiliateId,
        actorEmail: s.affiliate?.email ?? null,
        actorName:
          [s.affiliate?.firstName, s.affiliate?.lastName]
            .filter(Boolean)
            .join(' ') || null,
        actorRole: null,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
        deviceLabel: s.deviceLabel ?? null,
      })),
    ];

    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const sliced = rows.slice(0, limit);
    return { items: sliced, total: rows.length };
  }

  /**
   * Revoke a single session. Returns the actor type so the caller can
   * narrate the audit log entry. Throws NotFoundException if no active
   * session matches the id across any of the four tables.
   *
   * Safety: an admin cannot revoke their own session through this
   * surface — without that guard, an admin who suspects a takeover
   * could lock themselves out mid-investigation. They should sign out
   * via the regular logout path instead, which is intentional and
   * recovers cleanly.
   */
  async revokeOne(args: {
    sessionId: string;
    actorType: ActorType;
    revokedByAdminId: string;
    revokedByAdminRole?: string;
    reason?: string;
  }): Promise<{
    revoked: true;
    sessionId: string;
    actorType: ActorType;
    actorId: string;
    // Phase 209 (#12) — true when the session was ALREADY revoked, so the
    // caller can render "already signed out" instead of a misleading
    // "revoked just now." The operation stays idempotent (still 200).
    alreadyRevoked: boolean;
  }> {
    // Phase 209 (#13) — never trust a missing / 'unknown' revoker id.
    const revokedByAdminId = this.assertRealRevoker(args.revokedByAdminId);
    const now = new Date();
    let actorId: string | null = null;

    // Phase 27 (2026-05-21) — stamp revoker + reason directly on the
    // session row in addition to the AuditLog write below. The audit
    // log remains the canonical record (hash-chained, tamper-evident);
    // the row-level columns make "who killed this session and why?"
    // answerable via a single SELECT without joining audit_logs.
    const revokeData = {
      revokedAt: now,
      revokedBy: revokedByAdminId,
      revocationReason: args.reason ?? null,
    } as const;

    switch (args.actorType) {
      case 'ADMIN': {
        const row = await this.prisma.adminSession.findUnique({
          where: { id: args.sessionId },
          select: { adminId: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Session not found');
        if (row.adminId === revokedByAdminId) {
          throw new BadRequestException(
            'Cannot revoke your own admin session. Use the logout flow to end your own session.',
          );
        }
        if (row.revokedAt) {
          // Idempotent — already revoked, treat as success without
          // re-stamping (audit chain should record the first revoke).
          return { revoked: true, sessionId: args.sessionId, actorType: 'ADMIN', actorId: row.adminId, alreadyRevoked: true };
        }
        await this.prisma.adminSession.update({
          where: { id: args.sessionId },
          data: { ...revokeData, stepUpVerifiedAt: null },
        });
        actorId = row.adminId;
        break;
      }
      case 'USER': {
        const row = await this.prisma.session.findUnique({
          where: { id: args.sessionId },
          select: { userId: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Session not found');
        if (row.revokedAt) {
          return { revoked: true, sessionId: args.sessionId, actorType: 'USER', actorId: row.userId, alreadyRevoked: true };
        }
        await this.prisma.session.update({
          where: { id: args.sessionId },
          data: revokeData,
        });
        actorId = row.userId;
        break;
      }
      case 'SELLER': {
        const row = await this.prisma.sellerSession.findUnique({
          where: { id: args.sessionId },
          select: { sellerId: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Session not found');
        if (row.revokedAt) {
          return { revoked: true, sessionId: args.sessionId, actorType: 'SELLER', actorId: row.sellerId, alreadyRevoked: true };
        }
        await this.prisma.sellerSession.update({
          where: { id: args.sessionId },
          data: revokeData,
        });
        actorId = row.sellerId;
        break;
      }
      case 'FRANCHISE': {
        const row = await this.prisma.franchiseSession.findUnique({
          where: { id: args.sessionId },
          select: { franchisePartnerId: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Session not found');
        if (row.revokedAt) {
          return { revoked: true, sessionId: args.sessionId, actorType: 'FRANCHISE', actorId: row.franchisePartnerId, alreadyRevoked: true };
        }
        await this.prisma.franchiseSession.update({
          where: { id: args.sessionId },
          data: revokeData,
        });
        actorId = row.franchisePartnerId;
        break;
      }
      // Phase 27 (2026-05-21) — affiliate single-session revoke.
      case 'AFFILIATE': {
        const row = await this.prisma.affiliateSession.findUnique({
          where: { id: args.sessionId },
          select: { affiliateId: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Session not found');
        if (row.revokedAt) {
          return { revoked: true, sessionId: args.sessionId, actorType: 'AFFILIATE', actorId: row.affiliateId, alreadyRevoked: true };
        }
        await this.prisma.affiliateSession.update({
          where: { id: args.sessionId },
          data: revokeData,
        });
        actorId = row.affiliateId;
        break;
      }
    }

    await this.audit.writeAuditLog({
      actorId: revokedByAdminId,
      actorRole: args.revokedByAdminRole,
      action: 'session.revoke',
      module: 'security',
      resource: 'session',
      resourceId: args.sessionId,
      metadata: {
        targetActorType: args.actorType,
        targetActorId: actorId,
        reason: args.reason ?? null,
      },
    });

    // Phase 209 (#8) — notify the booted actor out-of-band. Best-effort:
    // a publish failure must not fail the revoke (the session is already
    // revoked at this point). A handler in the notifications module
    // (or the per-actor notification surface) consumes this.
    this.eventBus
      .publish({
        eventName: 'security.session_revoked_by_admin',
        aggregate: 'session',
        aggregateId: args.sessionId,
        occurredAt: new Date(),
        payload: {
          actorType: args.actorType,
          actorId: actorId,
          revokedByAdminId,
          reason: args.reason ?? null,
          scope: 'single_session',
        },
      })
      .catch((e) =>
        this.logger.warn(
          `Failed to publish session_revoked_by_admin: ${(e as Error).message}`,
        ),
      );

    this.logger.log(
      `Session revoked: ${args.actorType} session ${args.sessionId} by admin ${revokedByAdminId}`,
    );

    return { revoked: true, sessionId: args.sessionId, actorType: args.actorType, actorId: actorId!, alreadyRevoked: false };
  }

  /**
   * Revoke every active session for one actor. Useful when an admin
   * confirms account takeover suspicion. Audit log records the count
   * for later forensic review.
   */
  async revokeAllForActor(args: {
    actorType: ActorType;
    actorId: string;
    revokedByAdminId: string;
    revokedByAdminRole?: string;
    reason?: string;
  }): Promise<{ revoked: number; actorType: ActorType; actorId: string }> {
    // Phase 209 (#13) — reject a missing / 'unknown' revoker BEFORE the
    // self-protection check (an 'unknown' id would never match the target
    // admin id, silently bypassing "can't bulk-revoke your own").
    const revokedByAdminId = this.assertRealRevoker(args.revokedByAdminId);
    const now = new Date();
    let count = 0;

    // Same self-protection as revokeOne — never let an admin nuke
    // their own session set in bulk. They'd lock themselves out and
    // the only recovery is a DB-level reset.
    if (args.actorType === 'ADMIN' && args.actorId === revokedByAdminId) {
      throw new BadRequestException(
        'Cannot revoke your own admin sessions. Use the logout flow to end your own session.',
      );
    }

    // Phase 27 (2026-05-21) — same revoker + reason stamp as revokeOne.
    const bulkRevokeData = {
      revokedAt: now,
      revokedBy: revokedByAdminId,
      revocationReason: args.reason ?? null,
    } as const;

    switch (args.actorType) {
      case 'ADMIN': {
        const r = await this.prisma.adminSession.updateMany({
          where: { adminId: args.actorId, revokedAt: null },
          data: { ...bulkRevokeData, stepUpVerifiedAt: null },
        });
        count = r.count;
        break;
      }
      case 'USER': {
        const r = await this.prisma.session.updateMany({
          where: { userId: args.actorId, revokedAt: null },
          data: bulkRevokeData,
        });
        count = r.count;
        break;
      }
      case 'SELLER': {
        const r = await this.prisma.sellerSession.updateMany({
          where: { sellerId: args.actorId, revokedAt: null },
          data: bulkRevokeData,
        });
        count = r.count;
        break;
      }
      case 'FRANCHISE': {
        const r = await this.prisma.franchiseSession.updateMany({
          where: { franchisePartnerId: args.actorId, revokedAt: null },
          data: bulkRevokeData,
        });
        count = r.count;
        break;
      }
      case 'AFFILIATE': {
        const r = await this.prisma.affiliateSession.updateMany({
          where: { affiliateId: args.actorId, revokedAt: null },
          data: bulkRevokeData,
        });
        count = r.count;
        break;
      }
    }

    await this.audit.writeAuditLog({
      actorId: revokedByAdminId,
      actorRole: args.revokedByAdminRole,
      action: 'session.revoke_all',
      module: 'security',
      resource: 'session',
      resourceId: args.actorId,
      metadata: {
        targetActorType: args.actorType,
        revokedCount: count,
        reason: args.reason ?? null,
      },
    });

    // Phase 209 (#8) — notify the actor that ALL their sessions were
    // ended by an admin. Only fire when something was actually revoked
    // (a no-op bulk revoke shouldn't alarm the user). Best-effort.
    if (count > 0) {
      this.eventBus
        .publish({
          eventName: 'security.session_revoked_by_admin',
          aggregate: 'session',
          aggregateId: args.actorId,
          occurredAt: new Date(),
          payload: {
            actorType: args.actorType,
            actorId: args.actorId,
            revokedByAdminId,
            reason: args.reason ?? null,
            scope: 'all_sessions',
            revokedCount: count,
          },
        })
        .catch((e) =>
          this.logger.warn(
            `Failed to publish session_revoked_by_admin (bulk): ${(e as Error).message}`,
          ),
        );
    }

    this.logger.log(
      `Revoked ${count} session(s) for ${args.actorType} ${args.actorId} by admin ${revokedByAdminId}`,
    );

    return { revoked: count, actorType: args.actorType, actorId: args.actorId };
  }
}
