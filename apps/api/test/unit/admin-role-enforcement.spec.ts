import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../src/core/decorators/roles.decorator';
import { RolesGuard } from '../../src/core/guards/roles.guard';

import { AdminSettlementController } from '../../src/modules/settlements/admin-settlement.controller';
import { AdminFranchiseSettlementsController } from '../../src/modules/franchise/presentation/controllers/admin-franchise-settlements.controller';
import { AdminCommissionController } from '../../src/modules/commission/presentation/controllers/admin-commission.controller';
import { AdminSellersController } from '../../src/modules/admin/presentation/controllers/admin-sellers.controller';
import { AdminFranchiseController } from '../../src/modules/franchise/presentation/controllers/admin-franchise.controller';

/**
 * Regression tests for admin role granularity — narrow slice.
 *
 * Status quo before the fix: AdminAuthGuard only verified that the JWT role
 * was in {SUPER_ADMIN, SELLER_ADMIN, SELLER_SUPPORT, SELLER_OPERATIONS}.
 * Every admin endpoint treated all four equally, so a compromised
 * SELLER_SUPPORT account could mark settlements paid, delete accounts, or
 * impersonate a seller.
 *
 * This slice:
 *   - AdminAuthGuard populates request.user = { id, roles: [role] } so the
 *     existing RolesGuard can check the @Roles() metadata.
 *   - Money operations (settlement approve/pay, commission adjust) are
 *     restricted to SUPER_ADMIN.
 *   - Account-mutation operations (impersonate, delete) are restricted to
 *     SUPER_ADMIN + SELLER_ADMIN.
 *
 * Other admin endpoints (list, read, status toggles) stay as-is — any admin
 * role still reaches them, same as before.
 */

const expectRoles = (ctor: any, method: string, allowed: string[]) => {
  const target = ctor.prototype[method];
  const roles = Reflect.getMetadata(ROLES_KEY, target);
  expect({ method, roles }).toEqual({ method, roles: allowed });
};

describe('Admin money operations — SUPER_ADMIN only', () => {
  it('AdminSettlementController.approveCycle', () =>
    expectRoles(AdminSettlementController, 'approveCycle', ['SUPER_ADMIN']));

  it('AdminSettlementController.markPaid', () =>
    expectRoles(AdminSettlementController, 'markPaid', ['SUPER_ADMIN']));

  it('AdminFranchiseSettlementsController.approveSettlement', () =>
    expectRoles(AdminFranchiseSettlementsController, 'approveSettlement', [
      'SUPER_ADMIN',
    ]));

  it('AdminFranchiseSettlementsController.markSettlementFailed', () =>
    expectRoles(AdminFranchiseSettlementsController, 'markSettlementFailed', [
      'SUPER_ADMIN',
    ]));

  it('AdminFranchiseSettlementsController.markSettlementPaid', () =>
    expectRoles(AdminFranchiseSettlementsController, 'markSettlementPaid', [
      'SUPER_ADMIN',
    ]));
});

describe('Admin commission adjustment — SUPER_ADMIN + SELLER_ADMIN', () => {
  it('AdminCommissionController.adjustCommission', () =>
    expectRoles(AdminCommissionController, 'adjustCommission', [
      'SUPER_ADMIN',
      'SELLER_ADMIN',
    ]));
});

describe('Admin account mutations — SUPER_ADMIN + SELLER_ADMIN', () => {
  it('AdminSellersController.impersonate', () =>
    expectRoles(AdminSellersController, 'impersonate', [
      'SUPER_ADMIN',
      'SELLER_ADMIN',
    ]));

  it('AdminSellersController.deleteSeller', () =>
    expectRoles(AdminSellersController, 'deleteSeller', [
      'SUPER_ADMIN',
      'SELLER_ADMIN',
    ]));

  it('AdminFranchiseController.impersonate', () =>
    expectRoles(AdminFranchiseController, 'impersonate', [
      'SUPER_ADMIN',
      'SELLER_ADMIN',
    ]));

  it('AdminFranchiseController.deleteFranchise', () =>
    expectRoles(AdminFranchiseController, 'deleteFranchise', [
      'SUPER_ADMIN',
      'SELLER_ADMIN',
    ]));
});

describe('RolesGuard — end-to-end enforcement', () => {
  const buildContext = (roles: string[] | null, requiredRoles: string[]) => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);
    const request = {
      user: roles ? { roles } : null,
    };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard: new RolesGuard(reflector), ctx };
  };

  it('allows when user has a required role', () => {
    const { guard, ctx } = buildContext(['SUPER_ADMIN'], ['SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when user has one of many required roles', () => {
    const { guard, ctx } = buildContext(
      ['SELLER_ADMIN'],
      ['SUPER_ADMIN', 'SELLER_ADMIN'],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies when user lacks the required role', () => {
    const { guard, ctx } = buildContext(['SELLER_SUPPORT'], ['SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies when request.user is missing entirely', () => {
    const { guard, ctx } = buildContext(null, ['SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('is a no-op when no @Roles metadata is set', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: null }) }),
    } as unknown as ExecutionContext;
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });
});
