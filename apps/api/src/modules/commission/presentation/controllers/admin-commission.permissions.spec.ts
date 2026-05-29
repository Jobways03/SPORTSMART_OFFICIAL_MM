import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../../core/decorators/permissions.decorator';
import { ROLES_KEY } from '../../../../core/decorators/roles.decorator';
import { AdminCommissionController } from './admin-commission.controller';

/**
 * Phase 137 — authorization config for the admin commission controller.
 * Locks in that Hold/Resume require the dedicated `settlements.hold`
 * permission (separate from `settlements.approve`, so finance can delegate
 * fraud-hold without granting cycle approval) + SUPER_ADMIN/SELLER_ADMIN.
 */
const ROUTE_PERMISSIONS: Array<{ method: string; permission: string }> = [
  { method: 'listCommissions', permission: 'settlements.read' },
  { method: 'exportCommissions', permission: 'settlements.read' },
  // Phase 139 — history split off settlements.read (exposes internal notes).
  { method: 'getHistory', permission: 'settlements.history.read' },
  // Phase 138 — adjust moved off the shared settlements.approve to its own grant.
  { method: 'adjustCommission', permission: 'settlements.adjustRecord' },
  { method: 'holdCommission', permission: 'settlements.hold' },
  { method: 'resumeCommission', permission: 'settlements.hold' },
];

describe('AdminCommissionController — authorization config', () => {
  it.each(ROUTE_PERMISSIONS)(
    '$method requires permission $permission',
    ({ method, permission }) => {
      const handler = (AdminCommissionController.prototype as any)[method];
      expect(handler).toBeDefined();
      const required = Reflect.getMetadata(PERMISSIONS_KEY, handler);
      expect(required).toEqual(expect.arrayContaining([permission]));
    },
  );

  it.each(['holdCommission', 'resumeCommission'])(
    '%s is restricted to SUPER_ADMIN / SELLER_ADMIN',
    (method) => {
      const handler = (AdminCommissionController.prototype as any)[method];
      const roles = Reflect.getMetadata(ROLES_KEY, handler);
      expect(roles).toEqual(
        expect.arrayContaining(['SUPER_ADMIN', 'SELLER_ADMIN']),
      );
    },
  );
});
