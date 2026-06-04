import { BadRequestException } from '@nestjs/common';
import { AdminSessionsService } from './admin-sessions.service';

/**
 * Phase 209 — Sessions view + force-revoke hardening (AUDIT #209).
 *
 * Locks in the genuine fixes:
 *   #4  list() surfaces lastUsedAt + deviceLabel from each session row.
 *   #8  a successful revoke publishes security.session_revoked_by_admin.
 *   #12 the revoke result carries alreadyRevoked.
 *   #13 a missing / literal-'unknown' revoker id is rejected (defeats the
 *       audit-poison + self-protection-bypass vector).
 */
describe('AdminSessionsService — Phase 209', () => {
  function build(prismaOverrides: Record<string, any> = {}) {
    const empty = () => ({
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    const prisma: any = {
      adminSession: empty(),
      session: empty(),
      sellerSession: empty(),
      franchiseSession: empty(),
      affiliateSession: empty(),
      ...prismaOverrides,
    };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminSessionsService(prisma, audit, eventBus);
    return { service, prisma, audit, eventBus };
  }

  // ── #13 — reject missing / 'unknown' revoker ──────────────────────
  it('rejects a literal "unknown" revoker id (#13)', async () => {
    const { service } = build();
    await expect(
      service.revokeOne({
        sessionId: 's1',
        actorType: 'ADMIN',
        revokedByAdminId: 'unknown',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty revoker id on bulk revoke (#13)', async () => {
    const { service } = build();
    await expect(
      service.revokeAllForActor({
        actorType: 'USER',
        actorId: 'u1',
        revokedByAdminId: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── #4 — list surfaces lastUsedAt + deviceLabel ───────────────────
  it('projects lastUsedAt + deviceLabel into the active-session row (#4)', async () => {
    const lastUsed = new Date('2026-06-01T10:00:00Z');
    const { service } = build({
      session: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sess-1',
            userId: 'u1',
            ipAddress: '1.1.1.1',
            userAgent: 'UA',
            createdAt: new Date('2026-05-01T00:00:00Z'),
            expiresAt: new Date('2026-07-01T00:00:00Z'),
            lastUsedAt: lastUsed,
            deviceLabel: 'Chrome on macOS',
            user: { id: 'u1', email: 'u@x.com', firstName: 'A', lastName: 'B' },
          },
        ]),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    const res = await service.list({ actorType: 'USER' });
    expect(res.items[0]).toMatchObject({
      id: 'sess-1',
      lastUsedAt: lastUsed,
      deviceLabel: 'Chrome on macOS',
    });
  });

  // ── #8 / #12 — event emit + alreadyRevoked ────────────────────────
  it('publishes session_revoked_by_admin on a fresh revoke and reports alreadyRevoked=false (#8/#12)', async () => {
    const { service, eventBus } = build({
      session: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ userId: 'u7', revokedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    const res = await service.revokeOne({
      sessionId: 'sess-1',
      actorType: 'USER',
      revokedByAdminId: 'admin-1',
      reason: 'takeover',
    });
    expect(res.alreadyRevoked).toBe(false);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const evt = eventBus.publish.mock.calls[0][0];
    expect(evt.eventName).toBe('security.session_revoked_by_admin');
    expect(evt.payload).toMatchObject({
      actorType: 'USER',
      actorId: 'u7',
      revokedByAdminId: 'admin-1',
      scope: 'single_session',
    });
  });

  it('does NOT publish + reports alreadyRevoked=true for an already-revoked session (#12)', async () => {
    const { service, eventBus, audit } = build({
      session: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ userId: 'u7', revokedAt: new Date() }),
        update: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    const res = await service.revokeOne({
      sessionId: 'sess-1',
      actorType: 'USER',
      revokedByAdminId: 'admin-1',
    });
    expect(res.alreadyRevoked).toBe(true);
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('bulk revoke only publishes when at least one session was revoked (#8)', async () => {
    const { service, eventBus } = build({
      sellerSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    });
    await service.revokeAllForActor({
      actorType: 'SELLER',
      actorId: 's1',
      revokedByAdminId: 'admin-1',
    });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
