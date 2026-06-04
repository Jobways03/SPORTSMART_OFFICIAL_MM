import { PERMISSION_RISK, PERMISSIONS } from './permission-registry';

/**
 * Phase 173 (Recon audit #4) — pin the corrected reconciliation risk tiers.
 *
 * The registry previously carried TWO risk entries for the recon keys (an old
 * LOW/MEDIUM/MEDIUM block that sat AFTER the intended one), and last-write-wins
 * on the object literal silently reverted recon.transition to MEDIUM. tsc does
 * NOT flag duplicate keys in this Record literal, so this test is the guard
 * against a silent regression.
 */
describe('reconciliation permission risk tiers (#4)', () => {
  it('recon.read is MEDIUM (bulk financial data exposure)', () => {
    expect(PERMISSION_RISK['recon.read']).toBe('MEDIUM');
  });
  it('recon.run is HIGH (platform-wide money-state scan)', () => {
    expect(PERMISSION_RISK['recon.run']).toBe('HIGH');
  });
  it('recon.transition is HIGH (irreversible financial-investigation closure)', () => {
    expect(PERMISSION_RISK['recon.transition']).toBe('HIGH');
  });
  it('every recon permission is declared in the catalog', () => {
    // NB: keys are dotted strings — use Object.keys, not toHaveProperty (which
    // would treat the dot as a nested path).
    const keys = Object.keys(PERMISSIONS);
    for (const key of ['recon.read', 'recon.run', 'recon.transition']) {
      expect(keys).toContain(key);
    }
  });
});
