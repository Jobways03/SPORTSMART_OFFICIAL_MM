import 'reflect-metadata';
import {
  PERMISSION_RISK,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from '../../src/core/authorization/permission-registry';

// Phase 169 (Payment Ops audit #8) — resolving a money-impact mismatch +
// contesting a chargeback are HIGH-tier actions. Pin them so a refactor can't
// silently downgrade.
describe('payment-ops permission tiers (Phase 169 #8)', () => {
  it('paymentOps.transition is promoted to HIGH (was untiered)', () => {
    expect(PERMISSION_RISK['paymentOps.transition']).toBe('HIGH');
  });

  it('paymentOps.chargeback.respond exists and is HIGH', () => {
    expect('paymentOps.chargeback.respond' in PERMISSIONS).toBe(true);
    expect(PERMISSION_RISK['paymentOps.chargeback.respond']).toBe('HIGH');
  });

  it('the chargeback-respond perm is granted to the money-ops role', () => {
    expect(SYSTEM_ROLE_PERMISSIONS['SELLER_OPERATIONS']).toContain('paymentOps.chargeback.respond');
  });
});
