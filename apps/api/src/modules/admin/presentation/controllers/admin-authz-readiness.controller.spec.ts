import { AdminAuthzReadinessController } from './admin-authz-readiness.controller';
import { ALL_PERMISSION_KEYS } from '../../../../core/authorization/permission-registry';

function makeController(opts?: { policyCount?: number }) {
  const env = {
    getBoolean: (_k: string, d: boolean) => d,
  } as any;
  const resolver = {
    // Resolve SUPER_ADMIN to every key so the count-mismatch warning stays quiet.
    resolve: jest.fn().mockResolvedValue({
      permissions: [...ALL_PERMISSION_KEYS],
      fullyResolved: true,
    }),
  } as any;
  const prisma = {
    resourcePolicy: { count: jest.fn().mockResolvedValue(opts?.policyCount ?? 0) },
    authorizationAudit: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn().mockResolvedValue({ id: 'd1', reviewStatus: 'FALSE_POSITIVE' }),
    },
  } as any;
  const routeInventory = { scan: jest.fn() } as any;
  const modeInfo = {
    strictMode: { env: false, override: null, effective: false },
    abacEnabled: { env: false, override: null, effective: false },
    auditEnabled: { env: true, override: null, effective: true },
    source: 'env',
    updatedAt: null,
    updatedByAdminId: null,
  };
  const authzMode = {
    getModeInfo: jest.fn().mockReturnValue(modeInfo),
    setOverride: jest.fn().mockResolvedValue({ strictMode: true }),
    isStrict: () => false,
    isAbacEnabled: () => false,
    isAuditEnabled: () => true,
  } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const ctrl = new AdminAuthzReadinessController(
    env,
    resolver,
    prisma,
    routeInventory,
    authzMode,
    audit,
  );
  return { ctrl, audit, prisma, authzMode };
}

const reqWith = (perms: string[], extra?: Record<string, unknown>) =>
  ({ adminId: 'admin-1', user: { permissions: perms }, ...extra }) as any;

describe('AdminAuthzReadinessController — tiering + audit', () => {
  it('roles.read (no full key): returns counts only, NO permission key lists', async () => {
    const { ctrl } = makeController();
    const res = await ctrl.readiness(reqWith(['roles.read']));
    expect(res.data.full).toBe(false);
    expect(res.data.registry.permissionsByTier).toBeUndefined();
    expect(res.data.registry.ungrantedKeys).toBeUndefined();
    expect(res.data.superAdmin.permissions).toBeUndefined();
    expect(res.data.roles.every((r) => r.permissions === undefined)).toBe(true);
    // counts still present
    expect(res.data.registry.totalPermissions).toBe(ALL_PERMISSION_KEYS.length);
    expect(typeof res.data.superAdmin.permissionCount).toBe('number');
  });

  it('authz.readiness.full: returns the full permission key lists', async () => {
    const { ctrl } = makeController();
    const res = await ctrl.readiness(reqWith(['roles.read', 'authz.readiness.full']));
    expect(res.data.full).toBe(true);
    expect(res.data.registry.permissionsByTier).toBeDefined();
    expect(Array.isArray(res.data.superAdmin.permissions)).toBe(true);
    expect(res.data.roles[0]?.permissions).toBeDefined();
  });

  it('audits every readiness read', async () => {
    const { ctrl, audit } = makeController();
    await ctrl.readiness(reqWith(['roles.read']));
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.readiness.viewed', resourceId: 'readiness' }),
    );
  });

  it('warns when CRITICAL permissions exist but no enabled ABAC policy', async () => {
    const { ctrl } = makeController({ policyCount: 0 });
    const res = await ctrl.readiness(reqWith(['roles.read']));
    expect(res.data.warnings.some((w) => /CRITICAL permissions.*no enabled ABAC/i.test(w))).toBe(true);
  });

  it('recent-denials applies the new permission/role/route filters', async () => {
    const { ctrl, prisma } = makeController();
    await ctrl.recentDenials(
      reqWith(['roles.read']),
      '10',
      'true',
      undefined,
      'refunds.approve',
      'SELLER_OPERATIONS',
      'Refund',
    );
    const callArg = prisma.authorizationAudit.findMany.mock.calls[0][0];
    expect(callArg.where.requiredPermissions).toEqual({ has: 'refunds.approve' });
    expect(callArg.where.actorRole).toBe('SELLER_OPERATIONS');
    expect(callArg.where.routeLabel).toEqual({ contains: 'Refund', mode: 'insensitive' });
    expect(callArg.select.actorRoles).toBe(true);
    expect(callArg.select.requestId).toBe(true);
  });

  it('recent-denials defaults to reviewStatus=UNREVIEWED', async () => {
    const { ctrl, prisma } = makeController();
    await ctrl.recentDenials(reqWith(['roles.read']));
    const where = prisma.authorizationAudit.findMany.mock.calls[0][0].where;
    expect(where.reviewStatus).toBe('UNREVIEWED');
  });

  it('setMode: rejects a non-SUPER_ADMIN', async () => {
    const { ctrl } = makeController();
    await expect(
      ctrl.setMode(reqWith(['roles.write'], { adminRole: 'SELLER_OPERATIONS' }), { strictMode: true }),
    ).rejects.toThrow();
  });

  it('setMode: SUPER_ADMIN persists the override + audits authz.mode.changed', async () => {
    const { ctrl, authzMode, audit } = makeController();
    const res = await ctrl.setMode(
      reqWith(['roles.write'], { adminRole: 'SUPER_ADMIN' }),
      { strictMode: true },
    );
    expect(authzMode.setOverride).toHaveBeenCalledWith(
      expect.objectContaining({ strictMode: true }),
      'admin-1',
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.mode.changed' }),
    );
    expect(res.success).toBe(true);
  });

  it('reviewDenial: updates the row + audits; 404 when missing', async () => {
    const { ctrl, prisma, audit } = makeController();
    const res = await ctrl.reviewDenial(reqWith(['roles.write']), 'd1', {
      reviewStatus: 'FALSE_POSITIVE' as never,
    });
    expect(prisma.authorizationAudit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ reviewStatus: 'FALSE_POSITIVE' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.denial.reviewed' }),
    );
    expect(res.success).toBe(true);

    prisma.authorizationAudit.findUnique.mockResolvedValueOnce(null);
    await expect(
      ctrl.reviewDenial(reqWith(['roles.write']), 'nope', { reviewStatus: 'FIXED' as never }),
    ).rejects.toThrow();
  });
});
