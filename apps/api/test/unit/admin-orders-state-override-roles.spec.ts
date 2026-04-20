import 'reflect-metadata';
import { ROLES_KEY } from '../../src/core/decorators/roles.decorator';
import { AdminOrdersController } from '../../src/modules/orders/presentation/controllers/admin-orders.controller';

/**
 * Regression test for admin order state-machine override permissions.
 *
 * Before: the /admin/orders/* mutation endpoints accepted any admin
 * role (SUPER_ADMIN, SELLER_ADMIN, SELLER_SUPPORT, SELLER_OPERATIONS).
 * The sub-order state-machine overrides (accept/reject/fulfill/deliver)
 * don't run the normal side-effects (commission, stock, audit), so a
 * lower-tier admin could force e.g. DELIVERED → UNFULFILLED while the
 * goods are physically with the customer — detaching the ledger from
 * reality. Same principle as the money/account ops locked down in
 * earlier areas.
 *
 * After: all mutation routes carry @Roles('SUPER_ADMIN') metadata, so
 * RolesGuard rejects anything lower than SUPER_ADMIN with 403.
 */

const expectRoles = (method: string, allowed: string[]) => {
  const target = AdminOrdersController.prototype[method as keyof AdminOrdersController];
  const roles = Reflect.getMetadata(ROLES_KEY, target as any);
  expect({ method, roles }).toEqual({ method, roles: allowed });
};

describe('AdminOrdersController — @Roles SUPER_ADMIN on state-machine overrides', () => {
  it.each([
    'rejectOrder',
    'acceptSubOrder',
    'rejectSubOrder',
    'fulfillSubOrder',
    'deliverSubOrder',
  ])('%s is SUPER_ADMIN only', (method) => {
    expectRoles(method, ['SUPER_ADMIN']);
  });
});
