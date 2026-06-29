import 'reflect-metadata';
import { PermissionsGuard } from './permissions.guard';
import { ForbiddenAppException } from '../exceptions';

/**
 * Phase 4 (PR 4.6) — end-to-end behaviour of PermissionsGuard
 * against the new req.user shape AdminAuthGuard populates.
 *
 * Matrix:
 *  - No @Permissions decorator → allow.
 *  - Granted perm → allow (strict + soak).
 *  - Missing perm + strict=true → 403.
 *  - Missing perm + strict=false → allow, log wouldHaveBlocked=true.
 *  - Empty perms array on req.user (the legacy bug) + strict → 403.
 */
describe('PermissionsGuard', () => {
  function buildGuard(opts: { strict: boolean }) {
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    const env = {
      getBoolean: (key: string, fallback: boolean) =>
        key === 'PERMISSIONS_GUARD_STRICT' ? opts.strict : fallback,
    } as any;
    const audit = { record: jest.fn() } as any;
    const unifiedAudit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    // Phase 24 (2026-05-20) — PrismaService added for the CRITICAL
    // auto-step-up check. The test matrix doesn't exercise CRITICAL
    // permissions, so a stub-by-jest is sufficient.
    const prisma = {
      adminSession: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const authzMode = {
      isStrict: () => opts.strict,
      isAbacEnabled: () => false,
      isAuditEnabled: () => true,
    } as any;

    const guard = new PermissionsGuard(reflector, env, audit, unifiedAudit, prisma, authzMode);
    return { guard, reflector, audit, unifiedAudit, prisma };
  }

  function makeCtx(user: any, requiredPermissions: string[] | undefined) {
    const req: any = {
      user,
      method: 'GET',
      url: '/api/v1/admin/orders',
      originalUrl: '/api/v1/admin/orders',
      headers: { 'user-agent': 'jest' },
      ip: '127.0.0.1',
      adminId: user?.id ?? null,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({ name: 'listOrders' }) as any,
      getClass: () => ({ name: 'AdminOrdersController' }) as any,
    } as any;
    return { ctx, req, requiredPermissions };
  }

  // Phase 24 (2026-05-20) — `canActivate` is now async because of the
  // CRITICAL auto-step-up branch. Test assertions updated to await /
  // .rejects accordingly.

  it('returns true when no @Permissions decorator is set (open route)', async () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    const { ctx } = makeCtx({ id: 'a1', roles: ['SUPER_ADMIN'], permissions: [] }, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when actor permissions include all required (strict mode)', async () => {
    const { guard, reflector, audit } = buildGuard({ strict: true });
    reflector.getAllAndOverride
      .mockReturnValueOnce(['orders.read']) // PERMISSIONS_KEY
      .mockReturnValueOnce(undefined); // REQUIRES_STEP_UP_METADATA_KEY
    const { ctx } = makeCtx(
      { id: 'a1', roles: ['SUPER_ADMIN'], permissions: ['orders.read', 'orders.cancel'] },
      ['orders.read'],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'ALLOW', wouldHaveBlocked: false }),
    );
  });

  it('throws ForbiddenAppException when permission missing and strict=true', async () => {
    const { guard, reflector, audit, unifiedAudit } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['wallets.adjust']);
    const { ctx } = makeCtx(
      { id: 'a2', roles: ['SELLER_SUPPORT'], permissions: ['orders.read'] },
      ['wallets.adjust'],
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenAppException);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'DENY', wouldHaveBlocked: false }),
    );
    expect(unifiedAudit.writeAuditLog).toHaveBeenCalled();
  });

  it('allows but audits wouldHaveBlocked=true when strict=false (soak mode)', async () => {
    const { guard, reflector, audit } = buildGuard({ strict: false });
    reflector.getAllAndOverride.mockReturnValueOnce(['wallets.adjust']);
    const { ctx } = makeCtx(
      { id: 'a3', roles: ['SELLER_SUPPORT'], permissions: ['orders.read'] },
      ['wallets.adjust'],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'ALLOW', wouldHaveBlocked: true }),
    );
  });

  it('regression: req.user.permissions=[] (legacy bug) results in 403 under strict', async () => {
    // This is the exact prod failure mode: AdminAuthGuard used to leave
    // permissions undefined, so the guard saw an empty list and would
    // have denied every request once PERMISSIONS_GUARD_STRICT flipped.
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['orders.read']);
    const { ctx } = makeCtx(
      { id: 'a4', roles: ['SUPER_ADMIN'], permissions: [] },
      ['orders.read'],
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenAppException);
  });

  it('requires EVERY listed permission (AND semantics)', async () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['orders.read', 'orders.cancel']);
    const { ctx } = makeCtx(
      { id: 'a5', roles: ['SELLER_OPERATIONS'], permissions: ['orders.read'] }, // missing orders.cancel
      ['orders.read', 'orders.cancel'],
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenAppException);
  });

  // @AnyPermissions (OR semantics) — used for shared, low-sensitivity routes
  // (e.g. the logistics courier list both seller AND franchise admins read).
  it('@AnyPermissions allows when actor has ANY ONE of the listed perms', async () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined) // PERMISSIONS_KEY — no AND-gate
      .mockReturnValueOnce(['sellers.read', 'franchise.read']) // ANY_PERMISSIONS_KEY
      .mockReturnValueOnce(undefined); // REQUIRES_STEP_UP_METADATA_KEY
    const { ctx } = makeCtx(
      // Franchise admin lacks sellers.read but has franchise.read → allowed.
      { id: 'fa', roles: ['FRANCHISE_ADMIN'], permissions: ['franchise.read'] },
      undefined,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('@AnyPermissions denies when actor has NONE of the listed perms (strict)', async () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined) // PERMISSIONS_KEY
      .mockReturnValueOnce(['sellers.read', 'franchise.read']); // ANY_PERMISSIONS_KEY
    const { ctx } = makeCtx(
      { id: 'x', roles: ['SUPPORT'], permissions: ['orders.read'] },
      undefined,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenAppException);
  });
});
