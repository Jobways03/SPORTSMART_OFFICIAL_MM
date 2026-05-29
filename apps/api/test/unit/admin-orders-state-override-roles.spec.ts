import 'reflect-metadata';
import { ROLES_KEY } from '../../src/core/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../src/core/decorators/permissions.decorator';
import { AdminOrdersController } from '../../src/modules/orders/presentation/controllers/admin-orders.controller';

/**
 * Regression test for admin order state-machine override protection.
 *
 * The sub-order state-machine overrides (accept/reject/fulfill) don't run the
 * normal side-effects (commission, stock), so a lower-tier admin forcing e.g.
 * DELIVERED → UNFULFILLED would detach the ledger from reality. They stay
 * SUPER_ADMIN-only.
 *
 * `rejectOrder` (cancel + refund prepaid) and `deliverSubOrder` (manual
 * delivery override) were migrated from @Roles('SUPER_ADMIN') to granular
 * @Permissions (orders.reject / orders.deliver) so the SELLER_OPERATIONS ops
 * role can run them as part of day-to-day order operations. Those keys are
 * HIGH / MEDIUM risk and granted only to SUPER_ADMIN + SELLER_OPERATIONS — so
 * every override route remains gated; none is open to an arbitrary admin.
 */
const rolesOf = (method: string) =>
  Reflect.getMetadata(
    ROLES_KEY,
    AdminOrdersController.prototype[method as keyof AdminOrdersController] as any,
  );
const permsOf = (method: string) =>
  Reflect.getMetadata(
    PERMISSIONS_KEY,
    AdminOrdersController.prototype[method as keyof AdminOrdersController] as any,
  );

describe('AdminOrdersController — state-machine overrides are gated', () => {
  it.each(['acceptSubOrder', 'rejectSubOrder', 'fulfillSubOrder'])(
    '%s stays SUPER_ADMIN only',
    (method) => {
      expect(rolesOf(method)).toEqual(['SUPER_ADMIN']);
    },
  );

  it.each([
    ['rejectOrder', 'orders.reject'],
    ['deliverSubOrder', 'orders.deliver'],
  ])('%s is gated by the granular permission %s', (method, permission) => {
    expect(permsOf(method)).toEqual(expect.arrayContaining([permission]));
  });
});
