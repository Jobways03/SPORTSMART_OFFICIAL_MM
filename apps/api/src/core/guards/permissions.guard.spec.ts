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

    const guard = new PermissionsGuard(reflector, env, audit, unifiedAudit);
    return { guard, reflector, audit, unifiedAudit };
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

  it('returns true when no @Permissions decorator is set (open route)', () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    const { ctx } = makeCtx({ id: 'a1', roles: ['SUPER_ADMIN'], permissions: [] }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when actor permissions include all required (strict mode)', () => {
    const { guard, reflector, audit } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['orders.read']);
    const { ctx } = makeCtx(
      { id: 'a1', roles: ['SUPER_ADMIN'], permissions: ['orders.read', 'orders.cancel'] },
      ['orders.read'],
    );
    expect(guard.canActivate(ctx)).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'ALLOW', wouldHaveBlocked: false }),
    );
  });

  it('throws ForbiddenAppException when permission missing and strict=true', () => {
    const { guard, reflector, audit, unifiedAudit } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['wallets.adjust']);
    const { ctx } = makeCtx(
      { id: 'a2', roles: ['SELLER_SUPPORT'], permissions: ['orders.read'] },
      ['wallets.adjust'],
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenAppException);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'DENY', wouldHaveBlocked: false }),
    );
    expect(unifiedAudit.writeAuditLog).toHaveBeenCalled();
  });

  it('allows but audits wouldHaveBlocked=true when strict=false (soak mode)', () => {
    const { guard, reflector, audit } = buildGuard({ strict: false });
    reflector.getAllAndOverride.mockReturnValueOnce(['wallets.adjust']);
    const { ctx } = makeCtx(
      { id: 'a3', roles: ['SELLER_SUPPORT'], permissions: ['orders.read'] },
      ['wallets.adjust'],
    );
    expect(guard.canActivate(ctx)).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'ALLOW', wouldHaveBlocked: true }),
    );
  });

  it('regression: req.user.permissions=[] (legacy bug) results in 403 under strict', () => {
    // This is the exact prod failure mode: AdminAuthGuard used to leave
    // permissions undefined, so the guard saw an empty list and would
    // have denied every request once PERMISSIONS_GUARD_STRICT flipped.
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['orders.read']);
    const { ctx } = makeCtx(
      { id: 'a4', roles: ['SUPER_ADMIN'], permissions: [] },
      ['orders.read'],
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenAppException);
  });

  it('requires EVERY listed permission (AND semantics)', () => {
    const { guard, reflector } = buildGuard({ strict: true });
    reflector.getAllAndOverride.mockReturnValueOnce(['orders.read', 'orders.cancel']);
    const { ctx } = makeCtx(
      { id: 'a5', roles: ['SELLER_OPERATIONS'], permissions: ['orders.read'] }, // missing orders.cancel
      ['orders.read', 'orders.cancel'],
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenAppException);
  });
});
