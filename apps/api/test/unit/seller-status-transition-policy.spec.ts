import 'reflect-metadata';
import { SellerStatusTransitionPolicy } from '../../src/modules/seller/application/policies/seller-status-transition.policy';
import { BadRequestAppException } from '../../src/core/exceptions';

/**
 * Regression test for the seller status transition state machine.
 *
 * Before: transitions were an inline const in the use case. Moving
 * to a policy exposes the state machine for direct unit-testing and
 * locks in the allowed edges. A future change to the rules is now a
 * test-failure-first exercise.
 */
describe('SellerStatusTransitionPolicy', () => {
  const policy = new SellerStatusTransitionPolicy();

  const allowed: Array<[string, string]> = [
    ['PENDING_APPROVAL', 'ACTIVE'],
    ['PENDING_APPROVAL', 'DEACTIVATED'],
    ['ACTIVE', 'INACTIVE'],
    ['ACTIVE', 'SUSPENDED'],
    ['ACTIVE', 'DEACTIVATED'],
    ['INACTIVE', 'ACTIVE'],
    ['INACTIVE', 'DEACTIVATED'],
    ['SUSPENDED', 'ACTIVE'],
    ['SUSPENDED', 'DEACTIVATED'],
    ['DEACTIVATED', 'ACTIVE'],
  ];

  const forbidden: Array<[string, string]> = [
    ['PENDING_APPROVAL', 'SUSPENDED'], // must ACTIVATE first
    ['PENDING_APPROVAL', 'INACTIVE'],
    ['ACTIVE', 'PENDING_APPROVAL'],    // one-way
    ['DEACTIVATED', 'SUSPENDED'],      // only ACTIVE is inbound
    ['DEACTIVATED', 'INACTIVE'],
    ['SUSPENDED', 'INACTIVE'],
    ['NONSENSE', 'ACTIVE'],            // unknown source
  ];

  it.each(allowed)('allows %s → %s', (from, to) => {
    expect(policy.canTransition(from, to)).toBe(true);
    expect(() => policy.assertTransition(from, to)).not.toThrow();
  });

  it.each(forbidden)('forbids %s → %s', (from, to) => {
    expect(policy.canTransition(from, to)).toBe(false);
    expect(() => policy.assertTransition(from, to)).toThrow(BadRequestAppException);
  });

  it('rejects same-state transitions with a distinct "already" message', () => {
    // This message shape is what the admin UI surfaces inline. If the
    // wording changes, the e2e admin page should too — pinning here.
    expect(() => policy.assertTransition('ACTIVE', 'ACTIVE')).toThrow(/already ACTIVE/);
  });

  it('allowedFrom returns the full edge list for a known state', () => {
    expect(policy.allowedFrom('ACTIVE')).toEqual(
      expect.arrayContaining(['INACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    );
  });

  it('allowedFrom returns empty for an unknown state (no transitions exposed)', () => {
    expect(policy.allowedFrom('FROZEN')).toEqual([]);
  });
});
