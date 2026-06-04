import 'reflect-metadata';
import {
  PERMISSION_RISK,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from '../../src/core/authorization/permission-registry';

// Phase 168 (COD Mark-Paid audit #6) — the COD mark-paid action moves money-
// state (PAID flip → commission/affiliate settlement). It must have its own
// dedicated permission at CRITICAL tier (was the semantically-wrong, untiered
// orders.cancel). Pin all three facets so a refactor can't silently regress.
describe('payments.cod.markPaid permission (Phase 168 #6)', () => {
  it('exists in the permission catalog', () => {
    // Use `in` (not toHaveProperty, which would treat the dots as a nested path).
    expect('payments.cod.markPaid' in PERMISSIONS).toBe(true);
  });

  it('is classified CRITICAL (same tier as settlements.markPaid)', () => {
    expect(PERMISSION_RISK['payments.cod.markPaid']).toBe('CRITICAL');
    expect(PERMISSION_RISK['settlements.markPaid']).toBe('CRITICAL');
  });

  it('is granted to the money-ops role (SELLER_OPERATIONS), not just SUPER_ADMIN', () => {
    expect(SYSTEM_ROLE_PERMISSIONS['SELLER_OPERATIONS']).toContain('payments.cod.markPaid');
  });
});
