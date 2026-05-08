import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../../core/decorators/permissions.decorator';
import { AdminReturnsController } from './admin-returns.controller';

/**
 * Phase 13 — authorization configuration tests for every sensitive
 * admin returns / refunds route.
 *
 * Why a *configuration* test instead of an HTTP-level integration
 * test:
 *   - The PermissionsGuard logic itself is already covered (it
 *     reads the decorator + asserts the actor's permission set).
 *   - The risk we want to catch here is "someone removed the
 *     `@Permissions(...)` decorator and shipped it" — a config drift
 *     that an HTTP test would only catch when the right user happens
 *     to hit the route. Reading the decorators directly catches it
 *     deterministically, in milliseconds, without DB/HTTP setup.
 *
 * Each `it` block reads the metadata that `@Permissions(...)` writes
 * (via Nest's SetMetadata helper) and asserts the route has the
 * expected permission slug. Bonus: this test fails fast if a route
 * is removed/renamed but the spec table here isn't updated.
 */

interface RouteAssertion {
  method: string;
  permission: string;
}

const ROUTE_PERMISSIONS: RouteAssertion[] = [
  // Read paths — covered for completeness even though they don't move money.
  { method: 'listReturns', permission: 'returns.read' },
  { method: 'getReturn', permission: 'returns.read' },
  { method: 'getAnalyticsSummary', permission: 'returns.read' },
  { method: 'getReturnsTrend', permission: 'returns.read' },
  { method: 'getTopReasons', permission: 'returns.read' },
  { method: 'getCustomerHistory', permission: 'returns.read' },
  { method: 'exportReturns', permission: 'returns.read' },
  // Mutating paths — the high-risk surface from the spec.
  { method: 'approveReturn', permission: 'returns.approve' },
  { method: 'rejectReturn', permission: 'returns.reject' },
  { method: 'schedulePickup', permission: 'returns.schedulePickup' },
  { method: 'markInTransit', permission: 'returns.schedulePickup' },
  { method: 'markReceived', permission: 'returns.receive' },
  { method: 'uploadQcEvidence', permission: 'returns.uploadQcEvidence' },
  { method: 'submitQc', permission: 'returns.qcDecide' },
  { method: 'initiateRefund', permission: 'refunds.initiate' },
  { method: 'confirmRefund', permission: 'refunds.confirm' },
  { method: 'markRefundFailed', permission: 'refunds.retry' },
  { method: 'retryRefund', permission: 'refunds.retry' },
  { method: 'closeReturn', permission: 'returns.close' },
  { method: 'bulkApprove', permission: 'returns.approve' },
  { method: 'bulkClose', permission: 'returns.close' },
];

describe('AdminReturnsController — authorization config', () => {
  it.each(ROUTE_PERMISSIONS)(
    '$method requires permission $permission',
    ({ method, permission }) => {
      const handler = (AdminReturnsController.prototype as any)[method];
      expect(handler).toBeDefined();
      const required = Reflect.getMetadata(PERMISSIONS_KEY, handler);
      expect(required).toEqual(expect.arrayContaining([permission]));
    },
  );

  it('every method declared in the spec table has the expected permission', () => {
    // Sanity check: surface a clear failure if a method got renamed.
    for (const { method } of ROUTE_PERMISSIONS) {
      expect(typeof (AdminReturnsController.prototype as any)[method]).toBe(
        'function',
      );
    }
  });

  // Spec'd permissions that should exist somewhere on the controller.
  // If any of these slugs isn't bound to at least one route, the
  // RBAC story is incomplete — the spec lists 11 permissions and
  // they should all surface here.
  it.each([
    'returns.approve',
    'returns.reject',
    'returns.schedulePickup',
    'returns.receive',
    'returns.uploadQcEvidence',
    'returns.qcDecide',
    'refunds.initiate',
    'refunds.confirm',
    'refunds.retry',
    'returns.close',
  ])(
    'permission slug %s is bound to at least one controller method',
    (slug) => {
      const proto = AdminReturnsController.prototype as any;
      const allBoundSlugs = Object.getOwnPropertyNames(proto)
        .map((m) => Reflect.getMetadata(PERMISSIONS_KEY, proto[m]) as string[] | undefined)
        .filter((arr): arr is string[] => Array.isArray(arr))
        .flat();
      expect(allBoundSlugs).toContain(slug);
    },
  );
});
