import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminSessionsService } from './admin-sessions.service';

/**
 * Story 6.3 — AdminSessionsService unit tests.
 *
 * The service spans four session tables and writes an AuditLog row
 * for every revocation. These tests lock the behavior in:
 *   - revokeOne flips `revokedAt` (and nulls `stepUpVerifiedAt` for
 *     admin) on the correct table,
 *   - idempotent re-revoke does not double-write nor throw,
 *   - revokeAllForActor returns the count Prisma's updateMany returned,
 *   - NotFoundException when the session id is unknown,
 *   - AuditPublicFacade.writeAuditLog is invoked with the right
 *     metadata (action, module, resource, target).
 *
 * We mock Prisma at the model.method level rather than via a deep
 * proxy so each test is explicit about which call it expects.
 */
describe('AdminSessionsService', () => {
  function buildService(prismaOverrides: Record<string, any> = {}) {
    // Default mocks: nothing exists, so every "find" returns null,
    // every "update" no-ops. Tests override what they care about.
    const prisma: any = {
      adminSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      session: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      sellerSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      franchiseSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...prismaOverrides,
    };

    const audit: any = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AdminSessionsService(prisma, audit);
    return { service, prisma, audit };
  }

  describe('revokeOne', () => {
    it('throws NotFound when admin session id does not exist', async () => {
      const { service } = buildService({
        adminSession: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });
      await expect(
        service.revokeOne({
          sessionId: 'missing',
          actorType: 'ADMIN',
          revokedByAdminId: 'admin-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('admin path flips revokedAt + nulls stepUpVerifiedAt', async () => {
      const update = jest.fn().mockResolvedValue({});
      const { service, prisma, audit } = buildService({
        adminSession: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ adminId: 'admin-7', revokedAt: null }),
          update,
        },
      });

      const res = await service.revokeOne({
        sessionId: 'sess-1',
        actorType: 'ADMIN',
        revokedByAdminId: 'admin-1',
        revokedByAdminRole: 'SUPER_ADMIN',
        reason: 'suspicious IP',
      });

      expect(res).toMatchObject({
        revoked: true,
        sessionId: 'sess-1',
        actorType: 'ADMIN',
        actorId: 'admin-7',
      });

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'sess-1' });
      expect(call.data.revokedAt).toBeInstanceOf(Date);
      // The MFA step-up reset is what forces a fresh challenge after
      // re-login. If this assertion ever fails, an admin re-login
      // could skip MFA.
      expect(call.data.stepUpVerifiedAt).toBeNull();

      // Other actor tables must not be touched.
      expect(prisma.session.update).not.toHaveBeenCalled();
      expect(prisma.sellerSession.update).not.toHaveBeenCalled();
      expect(prisma.franchiseSession.update).not.toHaveBeenCalled();

      expect(audit.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session.revoke',
          module: 'security',
          resource: 'session',
          resourceId: 'sess-1',
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
          metadata: expect.objectContaining({
            targetActorType: 'ADMIN',
            targetActorId: 'admin-7',
            reason: 'suspicious IP',
          }),
        }),
      );
    });

    it('user path flips only the session row', async () => {
      const update = jest.fn().mockResolvedValue({});
      const { service, prisma } = buildService({
        session: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-42', revokedAt: null }),
          update,
        },
      });

      await service.revokeOne({
        sessionId: 'sess-u',
        actorType: 'USER',
        revokedByAdminId: 'admin-1',
      });

      expect(update).toHaveBeenCalledTimes(1);
      // No stepUpVerifiedAt reset for customer sessions — they don't
      // have admin MFA.
      expect(update.mock.calls[0][0].data).toEqual({
        revokedAt: expect.any(Date),
      });
      expect(prisma.adminSession.update).not.toHaveBeenCalled();
    });

    it('franchise path uses franchisePartnerId column', async () => {
      const update = jest.fn().mockResolvedValue({});
      const { service } = buildService({
        franchiseSession: {
          findUnique: jest.fn().mockResolvedValue({
            franchisePartnerId: 'fp-1',
            revokedAt: null,
          }),
          update,
        },
      });

      const res = await service.revokeOne({
        sessionId: 'sess-f',
        actorType: 'FRANCHISE',
        revokedByAdminId: 'admin-1',
      });

      expect(res.actorId).toBe('fp-1');
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('refuses to let admin revoke their own session (lock-out guard)', async () => {
      const update = jest.fn();
      const writeAudit = jest.fn();
      const { service, audit } = buildService({
        adminSession: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ adminId: 'admin-1', revokedAt: null }),
          update,
        },
      });
      audit.writeAuditLog = writeAudit;

      await expect(
        service.revokeOne({
          sessionId: 'sess-self',
          actorType: 'ADMIN',
          revokedByAdminId: 'admin-1', // same as session's admin
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(update).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });

    it('idempotent: revoking an already-revoked session does not write again', async () => {
      const update = jest.fn();
      const { service, audit } = buildService({
        adminSession: {
          findUnique: jest.fn().mockResolvedValue({
            adminId: 'admin-7',
            revokedAt: new Date('2026-01-01'),
          }),
          update,
        },
      });

      const res = await service.revokeOne({
        sessionId: 'already-gone',
        actorType: 'ADMIN',
        revokedByAdminId: 'admin-1',
      });

      expect(res).toMatchObject({
        revoked: true,
        actorId: 'admin-7',
      });
      expect(update).not.toHaveBeenCalled();
      expect(audit.writeAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForActor', () => {
    it('admin path runs updateMany + nulls stepUpVerifiedAt + writes audit', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 3 });
      const { service, audit } = buildService({
        adminSession: { updateMany },
      });

      const res = await service.revokeAllForActor({
        actorType: 'ADMIN',
        actorId: 'admin-7',
        revokedByAdminId: 'admin-1',
        revokedByAdminRole: 'SUPER_ADMIN',
        reason: 'account takeover',
      });

      expect(res).toEqual({
        revoked: 3,
        actorType: 'ADMIN',
        actorId: 'admin-7',
      });
      const call = updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ adminId: 'admin-7', revokedAt: null });
      expect(call.data.revokedAt).toBeInstanceOf(Date);
      expect(call.data.stepUpVerifiedAt).toBeNull();

      expect(audit.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session.revoke_all',
          module: 'security',
          resource: 'session',
          resourceId: 'admin-7',
          metadata: expect.objectContaining({
            targetActorType: 'ADMIN',
            revokedCount: 3,
            reason: 'account takeover',
          }),
        }),
      );
    });

    it('returns 0 when no active sessions exist', async () => {
      const { service } = buildService({
        sellerSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      });

      const res = await service.revokeAllForActor({
        actorType: 'SELLER',
        actorId: 'seller-3',
        revokedByAdminId: 'admin-1',
      });

      expect(res.revoked).toBe(0);
    });

    it('refuses bulk self-revoke (lock-out guard)', async () => {
      const updateMany = jest.fn();
      const { service, audit } = buildService({
        adminSession: { updateMany },
      });

      await expect(
        service.revokeAllForActor({
          actorType: 'ADMIN',
          actorId: 'admin-1',
          revokedByAdminId: 'admin-1', // self
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(updateMany).not.toHaveBeenCalled();
      expect(audit.writeAuditLog).not.toHaveBeenCalled();
    });

    it('franchise path filters on franchisePartnerId', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const { service } = buildService({
        franchiseSession: { updateMany },
      });

      await service.revokeAllForActor({
        actorType: 'FRANCHISE',
        actorId: 'fp-1',
        revokedByAdminId: 'admin-1',
      });

      expect(updateMany.mock.calls[0][0].where).toEqual({
        franchisePartnerId: 'fp-1',
        revokedAt: null,
      });
    });
  });

  describe('list', () => {
    it('filters only the requested actor type', async () => {
      const adminFindMany = jest.fn().mockResolvedValue([
        {
          id: 's1',
          adminId: 'admin-1',
          ipAddress: '10.0.0.1',
          userAgent: 'curl/7',
          createdAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          admin: { email: 'a@x.com', name: 'Admin One', role: 'SUPER_ADMIN' },
        },
      ]);
      const { service, prisma } = buildService({
        adminSession: { findMany: adminFindMany },
      });

      const res = await service.list({ actorType: 'ADMIN' });

      expect(res.items.map((i) => i.actorType)).toEqual(['ADMIN']);
      expect(adminFindMany).toHaveBeenCalledTimes(1);
      // Other tables must not be queried when caller scoped to ADMIN.
      expect(prisma.session.findMany).not.toHaveBeenCalled();
      expect(prisma.sellerSession.findMany).not.toHaveBeenCalled();
      expect(prisma.franchiseSession.findMany).not.toHaveBeenCalled();
    });

    it('merges all four tables when no actorType filter is given', async () => {
      const { service, prisma } = buildService();
      await service.list({});
      expect(prisma.adminSession.findMany).toHaveBeenCalled();
      expect(prisma.session.findMany).toHaveBeenCalled();
      expect(prisma.sellerSession.findMany).toHaveBeenCalled();
      expect(prisma.franchiseSession.findMany).toHaveBeenCalled();
    });

    it('returns merged rows sorted newest first', async () => {
      const { service } = buildService({
        adminSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'old-admin',
              adminId: 'admin-1',
              ipAddress: null,
              userAgent: null,
              createdAt: new Date('2026-01-01'),
              expiresAt: new Date('2026-12-31'),
              admin: null,
            },
          ]),
        },
        session: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'new-user',
              userId: 'user-1',
              ipAddress: null,
              userAgent: null,
              createdAt: new Date('2026-05-01'),
              expiresAt: new Date('2026-12-31'),
              user: null,
            },
          ]),
        },
      });

      const res = await service.list({});
      // Two rows merged, newer first.
      expect(res.items.length).toBeGreaterThanOrEqual(2);
      const [first, second] = res.items;
      expect(new Date(first!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(second!.createdAt).getTime(),
      );
    });
  });
});
