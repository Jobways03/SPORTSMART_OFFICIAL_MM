import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../../core/decorators/permissions.decorator';
import { AdminRefundApprovalsController } from './admin-refund-approvals.controller';

/**
 * Phase 13 — authorization configuration test for the finance refund
 * approvals controller. Same pattern as
 * `admin-returns.permissions.spec.ts` — reads the metadata
 * `@Permissions(...)` writes via Nest's SetMetadata helper and
 * asserts each route has the expected slug.
 *
 * The risk we're hardening against: someone removes a
 * `@Permissions('refunds.approve')` decorator and ships an
 * unauthorized refund-approval route. Reading the metadata directly
 * catches the regression in milliseconds, no DB / HTTP setup.
 */

// Phase 132 — separation of duties: viewing, approving, and rejecting are
// now distinct permissions (was all `refunds.approve`).
const ROUTE_PERMISSIONS: Array<{ method: string; permission: string }> = [
  { method: 'list', permission: 'refunds.read' },
  { method: 'get', permission: 'refunds.read' },
  { method: 'approve', permission: 'refunds.approve' },
  { method: 'reject', permission: 'refunds.reject' },
];

describe('AdminRefundApprovalsController — authorization config', () => {
  it.each(ROUTE_PERMISSIONS)(
    '$method requires permission $permission',
    ({ method, permission }) => {
      const handler = (AdminRefundApprovalsController.prototype as any)[method];
      expect(handler).toBeDefined();
      const required = Reflect.getMetadata(PERMISSIONS_KEY, handler);
      expect(required).toEqual(expect.arrayContaining([permission]));
    },
  );

  it('every spec-table method exists on the controller (catches renames)', () => {
    for (const { method } of ROUTE_PERMISSIONS) {
      expect(typeof (AdminRefundApprovalsController.prototype as any)[method]).toBe(
        'function',
      );
    }
  });
});
