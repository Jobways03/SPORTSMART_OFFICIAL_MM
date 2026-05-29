import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { FranchiseAccessGuard } from '../../src/core/guards/franchise-access.guard';
import { ForbiddenAppException } from '../../src/core/exceptions';
import { FranchiseStaffAuthService } from '../../src/modules/franchise/application/auth/franchise-staff-auth.service';
import {
  resolveStaffPermissions,
  STAFF_PERMISSIONS,
} from '../../src/modules/franchise/application/auth/franchise-staff-permissions';
import { hashToken } from '../../src/modules/franchise/application/auth/franchise-staff-token.util';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../src/core/exceptions';

describe('resolveStaffPermissions (B2)', () => {
  it('POS_OPERATOR gets pos.sell + pos.return by default', () => {
    expect(resolveStaffPermissions('POS_OPERATOR').sort()).toEqual(
      [STAFF_PERMISSIONS.POS_SELL, STAFF_PERMISSIONS.POS_RETURN].sort(),
    );
  });
  it('MANAGER includes report.read + pos.void', () => {
    const p = resolveStaffPermissions('MANAGER');
    expect(p).toContain(STAFF_PERMISSIONS.REPORT_READ);
    expect(p).toContain(STAFF_PERMISSIONS.POS_VOID);
  });
  it('a per-staff override REPLACES the role defaults (invalid entries dropped)', () => {
    const p = resolveStaffPermissions('POS_OPERATOR', ['pos.void', 'bogus.perm']);
    expect(p).toEqual(['pos.void']);
  });
  it('falls back to role defaults when overrides are empty/non-array', () => {
    expect(resolveStaffPermissions('WAREHOUSE_STAFF', []).length).toBeGreaterThan(0);
    expect(resolveStaffPermissions('WAREHOUSE_STAFF', null)).toContain('inventory.adjust');
  });
});

const PASSWORD = 'Str0ngPass';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function build(over: { staff?: any; franchise?: any; session?: any } = {}) {
  const prisma: any = {
    franchisePartner: {
      findFirst: jest.fn().mockResolvedValue(
        over.franchise ?? { id: 'fr-1', status: 'ACTIVE', isDeleted: false },
      ),
    },
    franchiseStaff: {
      findFirst: jest.fn().mockResolvedValue(over.staff ?? null),
      findUnique: jest.fn().mockResolvedValue(over.staff ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    franchiseStaffSession: {
      create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      findFirst: jest.fn().mockResolvedValue(over.session ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const env: any = {
    getString: jest.fn((k: string, fb?: string) =>
      (({ JWT_FRANCHISE_SECRET: 'x'.repeat(40), JWT_REFRESH_TTL: '30d', JWT_ACCESS_TTL: '1h' } as any)[k] ?? fb ?? ''),
    ),
  };
  const logger: any = { setContext: jest.fn(), log: jest.fn() };
  return { service: new FranchiseStaffAuthService(prisma, env, logger), prisma };
}

const activeStaff = {
  id: 'staff-1', franchiseId: 'fr-1', email: 'asha@shop.in', name: 'Asha',
  role: 'POS_OPERATOR', status: 'ACTIVE', passwordHash: HASH, permissions: null,
};

describe('FranchiseStaffAuthService.login (B1)', () => {
  it('issues an access token + refresh + permissions on valid credentials', async () => {
    const { service, prisma } = build({ staff: activeStaff });
    const res = await service.login({ franchiseCode: 'SM-FR-1', email: 'asha@shop.in', password: PASSWORD });
    expect(res.accessToken).toEqual(expect.any(String));
    expect(res.refreshToken).toEqual(expect.any(String));
    expect(res.staff.permissions).toContain('pos.sell');
    expect(prisma.franchiseStaffSession.create).toHaveBeenCalled();
    expect(prisma.franchiseStaff.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );
  });

  it('rejects a wrong password', async () => {
    const { service } = build({ staff: activeStaff });
    await expect(
      service.login({ franchiseCode: 'SM-FR-1', email: 'asha@shop.in', password: 'WrongPass1' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects an INVITED (not yet activated) staff', async () => {
    const { service } = build({ staff: { ...activeStaff, status: 'INVITED', passwordHash: null } });
    await expect(
      service.login({ franchiseCode: 'SM-FR-1', email: 'asha@shop.in', password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects login when the franchise is suspended', async () => {
    const { service } = build({ staff: activeStaff, franchise: { id: 'fr-1', status: 'SUSPENDED', isDeleted: false } });
    await expect(
      service.login({ franchiseCode: 'SM-FR-1', email: 'asha@shop.in', password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });
});

describe('FranchiseStaffAuthService.activate (B4)', () => {
  it('activates an INVITED staff with a valid token', async () => {
    const staff = { id: 'staff-1', status: 'INVITED', inviteTokenHash: hashToken('tok'), inviteExpiresAt: new Date(Date.now() + 3600_000) };
    const { service, prisma } = build({ staff });
    await service.activate('tok', PASSWORD);
    expect(prisma.franchiseStaff.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', passwordHash: expect.any(String), inviteTokenHash: null }) }),
    );
  });

  it('rejects an expired invitation', async () => {
    const staff = { id: 'staff-1', status: 'INVITED', inviteTokenHash: hashToken('tok'), inviteExpiresAt: new Date(Date.now() - 1000) };
    const { service } = build({ staff });
    await expect(service.activate('tok', PASSWORD)).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('FranchiseStaffAuthService.revokeAllSessions', () => {
  it('revokes all active sessions for the staff', async () => {
    const { service, prisma } = build();
    const n = await service.revokeAllSessions('staff-1');
    expect(n).toBe(2);
    expect(prisma.franchiseStaffSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffId: 'staff-1', revokedAt: null } }),
    );
  });
});

describe('FranchiseAccessGuard — staff permission enforcement (B3)', () => {
  // Token only needs decodable roles; the staff guard is stubbed below.
  const staffToken = jwt.sign({ roles: ['FRANCHISE_STAFF'] }, 'x');
  function ctxFor(req: any) {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }
  function guardWith(grantedPerms: string[], required: string | undefined) {
    const reflector: any = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    const guard = new FranchiseAccessGuard(reflector, {} as any, {} as any, {} as any);
    // Stub the internal staff guard: pretend the token is valid + set perms.
    (guard as any).staffGuard = {
      canActivate: async (ctx: any) => {
        ctx.switchToHttp().getRequest().staffPermissions = grantedPerms;
        return true;
      },
    };
    return guard;
  }

  it('allows a staff member holding the required permission', async () => {
    const guard = guardWith(['pos.void'], 'pos.void');
    await expect(
      guard.canActivate(ctxFor({ headers: { authorization: `Bearer ${staffToken}` } })),
    ).resolves.toBe(true);
  });

  it('denies a staff member lacking the required permission', async () => {
    const guard = guardWith(['pos.sell'], 'pos.void');
    await expect(
      guard.canActivate(ctxFor({ headers: { authorization: `Bearer ${staffToken}` } })),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('denies staff on an owner-only (undecorated) route', async () => {
    const guard = guardWith(['pos.sell'], undefined);
    await expect(
      guard.canActivate(ctxFor({ headers: { authorization: `Bearer ${staffToken}` } })),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });
});
