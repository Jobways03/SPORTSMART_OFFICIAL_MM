import 'reflect-metadata';
import { PERMISSION_RISK } from '../../src/core/authorization/permission-registry';

/**
 * Phase 167 review guard (#20).
 *
 * Audit #167 reported "refund permissions are not tiered/CRITICAL". That was a
 * FALSE POSITIVE — they already are (permission-registry.ts:495-501). But the
 * CRITICAL classification was UNPINNED: enforcement (endpoints require the perm)
 * is tested, yet nothing asserted the *risk tier*, which drives step-up auth and
 * heightened audit logging. A future edit could silently downgrade one and no
 * test would catch it. This guard pins the money-mutating refund perms at
 * CRITICAL so a false-positive-today can't become a real gap tomorrow.
 */
describe('Refund permission risk tiers (Phase 167 guard #20)', () => {
  // The money-mutating refund actions named by the audit + their siblings that
  // also move money. Each grants persistent access to a money flow → CRITICAL.
  const MUST_BE_CRITICAL = [
    'refunds.initiate',
    'refunds.approve',
    'refunds.confirm',
    'refunds.manualConfirm',
    'refunds.reject',
    'refunds.markFailed',
  ] as const;

  it.each(MUST_BE_CRITICAL)('%s is classified CRITICAL', (perm) => {
    expect(PERMISSION_RISK[perm as keyof typeof PERMISSION_RISK]).toBe('CRITICAL');
  });

  it('refunds.retry stays HIGH (re-issues a gateway call but does not itself authorize new money)', () => {
    expect(PERMISSION_RISK['refunds.retry']).toBe('HIGH');
  });
});
