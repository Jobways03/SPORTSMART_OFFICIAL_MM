import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { AdminAuthGuard } from './admin-auth.guard';
import { UnauthorizedAppException } from '../exceptions';
import { ALL_PERMISSION_KEYS } from '../authorization/permission-registry';

/**
 * Phase 4 (PR 4.6) — guard-level wiring test. Asserts the exact bug
 * we observed in prod (actorPermissionCount=0 for SUPER_ADMIN) can
 * no longer recur: AdminAuthGuard MUST populate req.user.permissions.
 *
 * We don't spin up Nest — the guard is a plain class. We hand-build
 * the dependencies, invoke canActivate, and inspect the request the
 * guard mutates. This is fast (no DB, no Nest module compile) and
 * directly verifies the contract PermissionsGuard / PolicyGuard rely on.
 */
describe('AdminAuthGuard — permission wiring', () => {
  const SECRET = 'test-admin-secret-must-be-at-least-32-chars-long';

  function makeContext(token: string) {
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
      } as any,
    };
  }

  function makeGuard(opts: {
    adminRow: { id: string; status: string; email: string; role: string } | null;
    sessionRow: { id: string; revokedAt: Date | null; expiresAt: Date; adminId: string } | null;
    resolved: {
      permissions: string[];
      customRoles: string[];
      fullyResolved: boolean;
    };
  }) {
    const env = {
      getString: (k: string) => {
        if (k === 'JWT_ADMIN_SECRET') return SECRET;
        throw new Error(`unexpected env key ${k}`);
      },
    } as any;
    const prisma = {
      adminSession: { findUnique: jest.fn().mockResolvedValue(opts.sessionRow) },
      admin: { findUnique: jest.fn().mockResolvedValue(opts.adminRow) },
    } as any;
    const resolver = {
      resolve: jest.fn().mockResolvedValue(opts.resolved),
    } as any;
    return new AdminAuthGuard(env, prisma, resolver);
  }

  function mintToken(sub: string, role: string, sessionId: string) {
    return jwt.sign({ sub, email: 'a@x.com', role, sessionId }, SECRET);
  }

  it('populates req.user.permissions for SUPER_ADMIN (regression)', async () => {
    const guard = makeGuard({
      adminRow: { id: 'admin-1', status: 'ACTIVE', email: 'a@x.com', role: 'SUPER_ADMIN' },
      sessionRow: {
        id: 's1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-1',
      },
      resolved: {
        permissions: [...ALL_PERMISSION_KEYS],
        customRoles: [],
        fullyResolved: true,
      },
    });

    const { ctx, req } = makeContext(mintToken('admin-1', 'SUPER_ADMIN', 's1'));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    // The exact failure we observed: actorPermissionCount=0 for SUPER_ADMIN.
    expect(req.user).toBeDefined();
    expect(req.user.permissions).toBeDefined();
    expect(Array.isArray(req.user.permissions)).toBe(true);
    expect(req.user.permissions.length).toBeGreaterThan(0);
    expect(req.user.permissions.length).toBe(ALL_PERMISSION_KEYS.length);

    // Shape contract that PermissionsGuard / PolicyGuard rely on.
    expect(req.user.id).toBe('admin-1');
    expect(req.user.type).toBe('ADMIN');
    expect(req.user.roles).toEqual(['SUPER_ADMIN']);
    expect(req.user.customRoles).toEqual([]);
    expect(req.adminId).toBe('admin-1');
    expect(req.adminRole).toBe('SUPER_ADMIN');
  });

  it('attaches resolved custom-role names', async () => {
    const guard = makeGuard({
      adminRow: { id: 'admin-2', status: 'ACTIVE', email: 'b@x.com', role: 'SELLER_SUPPORT' },
      sessionRow: {
        id: 's2',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-2',
      },
      resolved: {
        permissions: ['wallets.read', 'refunds.confirm'],
        customRoles: ['finance-tier-2'],
        fullyResolved: true,
      },
    });

    const { ctx, req } = makeContext(mintToken('admin-2', 'SELLER_SUPPORT', 's2'));
    await guard.canActivate(ctx);

    expect(req.user.permissions).toEqual(['wallets.read', 'refunds.confirm']);
    expect(req.user.customRoles).toEqual(['finance-tier-2']);
  });

  it('still allows the request when the resolver degrades (fullyResolved=false)', async () => {
    // Custom-role lookup failed; we should NOT 403 a SUPER_ADMIN —
    // role-default perms cover every route they legitimately access.
    const guard = makeGuard({
      adminRow: { id: 'admin-3', status: 'ACTIVE', email: 'c@x.com', role: 'SUPER_ADMIN' },
      sessionRow: {
        id: 's3',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-3',
      },
      resolved: {
        permissions: [...ALL_PERMISSION_KEYS],
        customRoles: [],
        fullyResolved: false,
      },
    });

    const { ctx } = makeContext(mintToken('admin-3', 'SUPER_ADMIN', 's3'));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects on revoked session before resolver is called', async () => {
    const guard = makeGuard({
      adminRow: { id: 'admin-4', status: 'ACTIVE', email: 'd@x.com', role: 'SUPER_ADMIN' },
      sessionRow: {
        id: 's4',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-4',
      },
      resolved: { permissions: [], customRoles: [], fullyResolved: true },
    });

    const { ctx } = makeContext(mintToken('admin-4', 'SUPER_ADMIN', 's4'));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects on inactive admin before resolver is called', async () => {
    const guard = makeGuard({
      adminRow: { id: 'admin-5', status: 'SUSPENDED', email: 'e@x.com', role: 'SUPER_ADMIN' },
      sessionRow: {
        id: 's5',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-5',
      },
      resolved: { permissions: [], customRoles: [], fullyResolved: true },
    });

    const { ctx } = makeContext(mintToken('admin-5', 'SUPER_ADMIN', 's5'));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects when DB role has changed since token issuance', async () => {
    // Token claims SUPER_ADMIN, but the row was downgraded to SELLER_SUPPORT.
    // Force a re-login rather than silently degrading privileges mid-session.
    const guard = makeGuard({
      adminRow: { id: 'admin-6', status: 'ACTIVE', email: 'f@x.com', role: 'SELLER_SUPPORT' },
      sessionRow: {
        id: 's6',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        adminId: 'admin-6',
      },
      resolved: { permissions: [], customRoles: [], fullyResolved: true },
    });

    const { ctx } = makeContext(mintToken('admin-6', 'SUPER_ADMIN', 's6'));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedAppException);
  });
});
