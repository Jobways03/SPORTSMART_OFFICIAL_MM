import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../../core/decorators/permissions.decorator';
import { AdminSupportController } from './admin-support.controller';

/**
 * Phase 133 — authorization config test for the admin support controller.
 * Same pattern as admin-refund-approvals.permissions.spec.ts: read the
 * metadata `@Permissions(...)` writes and assert each route's slug.
 *
 * Locks in the support.assign split — assignment, status changes, priority
 * changes, and category management are now distinct permissions. A regression
 * that collapses them back (or drops a decorator) fails here in milliseconds.
 */
const ROUTE_PERMISSIONS: Array<{ method: string; permission: string }> = [
  // Reads
  { method: 'listCategories', permission: 'support.read' },
  { method: 'listTickets', permission: 'support.read' },
  { method: 'getTicket', permission: 'support.read' },
  // Category management — its own permission (was support.assign)
  { method: 'createCategory', permission: 'support.categoriesManage' },
  { method: 'updateCategory', permission: 'support.categoriesManage' },
  { method: 'softDeleteCategory', permission: 'support.categoriesManage' },
  // Ticket triage — split out of the overloaded support.assign
  { method: 'assign', permission: 'support.assign' },
  { method: 'setStatus', permission: 'support.setStatus' },
  { method: 'setPriority', permission: 'support.setPriority' },
  // Unchanged
  { method: 'reply', permission: 'support.reply' },
  { method: 'promoteToDispute', permission: 'support.promoteToDispute' },
];

describe('AdminSupportController — authorization config', () => {
  it.each(ROUTE_PERMISSIONS)(
    '$method requires permission $permission',
    ({ method, permission }) => {
      const handler = (AdminSupportController.prototype as any)[method];
      expect(handler).toBeDefined();
      const required = Reflect.getMetadata(PERMISSIONS_KEY, handler);
      expect(required).toEqual(expect.arrayContaining([permission]));
    },
  );

  it('every spec-table method exists on the controller (catches renames)', () => {
    for (const { method } of ROUTE_PERMISSIONS) {
      expect(typeof (AdminSupportController.prototype as any)[method]).toBe(
        'function',
      );
    }
  });
});
