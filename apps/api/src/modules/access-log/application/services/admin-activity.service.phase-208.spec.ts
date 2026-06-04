import { AdminActivityService } from './admin-activity.service';

/**
 * Phase 208 — Admin Activity timeline hardening (AUDIT #208).
 *
 * Locks in the genuine fixes:
 *   #1  audit_logs (business) is merged into the timeline as a third
 *       stream, keyed off existing columns only.
 *   #4  admin_action_audit_logs rows use the snapshotted actor_role and
 *       fall back to the request filter only when it's null.
 *   #8  admin_impersonation_logs produce IMPERSONATION_STARTED / ENDED
 *       events.
 *   #9  the response carries a truncated flag when a source fills its page.
 */
describe('AdminActivityService — Phase 208', () => {
  function build(overrides: Record<string, any> = {}) {
    const prisma: any = {
      accessLog: { findMany: jest.fn().mockResolvedValue([]) },
      adminActionAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      adminImpersonationLog: { findMany: jest.fn().mockResolvedValue([]) },
      admin: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    return { service: new AdminActivityService(prisma), prisma };
  }

  // ── #1 — business audit stream is merged ──────────────────────────
  it('merges audit_logs (business) rows into the timeline (#1)', async () => {
    const { service } = build({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'b1',
            actorId: 'admin-9',
            actorRole: 'SUPER_ADMIN',
            action: 'revoke',
            module: 'security',
            resource: 'session',
            resourceId: 'sess-x',
            metadata: { foo: 'bar' },
            ipAddress: '1.1.1.1',
            userAgent: 'UA',
            createdAt: new Date('2026-06-01T12:00:00Z'),
          },
        ]),
      },
    });
    const res = await service.timeline({ source: 'BUSINESS' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      source: 'BUSINESS',
      id: 'biz:b1',
      actorId: 'admin-9',
      actorRole: 'SUPER_ADMIN',
      kind: 'security.revoke',
    });
    // resource/resourceId folded into metadata for drill-down.
    expect((res.items[0]!.metadata as any).resourceId).toBe('sess-x');
  });

  // ── #4 — snapshotted role wins over the request filter ────────────
  it('prefers the snapshotted actor_role on admin_action rows (#4)', async () => {
    const { service } = build({
      adminActionAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            adminId: 'admin-1',
            actorRole: 'SELLER_OPERATIONS', // snapshot
            actionType: 'role.assigned',
            metadata: {},
            ipAddress: null,
            userAgent: null,
            reason: null,
            createdAt: new Date('2026-06-01T00:00:00Z'),
          },
        ]),
      },
    });
    // Request asks for SUPER_ADMIN, but the row was written by a
    // SELLER_OPERATIONS admin — the snapshot must win.
    const res = await service.timeline({
      source: 'ADMIN_ACTION',
      actorRole: 'SUPER_ADMIN',
      actorId: 'admin-1',
    });
    expect(res.items[0]!.actorRole).toBe('SELLER_OPERATIONS');
  });

  // ── #8 — impersonation produces start/end events ──────────────────
  it('emits IMPERSONATION_STARTED and ENDED events (#8)', async () => {
    // Relative to "now" so both events fall inside the timeline's lookback
    // window — the service filters startedAt/endedAt >= (now − hours), so
    // fixed calendar dates silently fall out of range as real time advances.
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const ended = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    const { service } = build({
      adminImpersonationLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'imp1',
            adminId: 'admin-3',
            targetActorType: 'SELLER',
            targetActorId: 'seller-5',
            startedAt: started,
            endedAt: ended,
            revokedAt: null,
            reason: 'support',
            revokedReason: null,
            ipAddress: null,
            userAgent: null,
          },
        ]),
      },
    });
    const res = await service.timeline({ source: 'IMPERSONATION', hours: 24 });
    const kinds = res.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(['IMPERSONATION_ENDED', 'IMPERSONATION_STARTED']);
  });

  // ── #9 — truncation flag ──────────────────────────────────────────
  it('sets truncated when a source fills its page (#9)', async () => {
    // limit=2 → perSourceLimit=4; return exactly 4 access rows.
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `r${i}`,
      actorId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      kind: 'LOGIN_SUCCESS',
      ipAddress: null,
      userAgent: null,
      metadata: null,
      succeeded: true,
      reason: null,
      createdAt: new Date(2026, 5, 1, 0, i),
    }));
    const { service } = build({
      accessLog: { findMany: jest.fn().mockResolvedValue(rows) },
    });
    const res = await service.timeline({ source: 'AUTH', limit: 2 });
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(2); // sliced to the requested limit
  });

  it('does not set truncated for an under-full page (#9)', async () => {
    const { service } = build({
      accessLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r0',
            actorId: 'admin-1',
            actorRole: 'SUPER_ADMIN',
            kind: 'LOGIN_SUCCESS',
            ipAddress: null,
            userAgent: null,
            metadata: null,
            succeeded: true,
            reason: null,
            createdAt: new Date('2026-06-01T00:00:00Z'),
          },
        ]),
      },
    });
    const res = await service.timeline({ source: 'AUTH', limit: 200 });
    expect(res.truncated).toBe(false);
  });
});
