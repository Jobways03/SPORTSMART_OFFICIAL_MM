import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for settlement cycle cross-cycle contamination.
 *
 * Before: createCycle picked up all PENDING commission records in a
 * date range regardless of whether they were already attached to a
 * settlement. Two cycles with overlapping date ranges (or two
 * concurrent createCycle calls) both saw the same records, both
 * computed aggregate totals, both called updateMany to set
 * settlementId. The second updateMany silently overwrote the first's
 * link — records ended up attached to a different cycle than the
 * totals that had been computed, detaching seller-settlement
 * amounts from the underlying record set.
 *
 * After: both the initial findMany and the updateMany filter on
 * `settlementId: null`, so a record can only be claimed by one
 * cycle. The second createCycle's updateMany returns count 0 for
 * already-claimed rows and silently drops them.
 *
 * Assert via source scan — structural guard that survives refactors.
 */

describe('SettlementService.createCycle — idempotent record claim', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/modules/settlements/settlement.service.ts',
    ),
    'utf8',
  );

  // Helper: extract the body of the named method call (roughly) —
  // we only need enough to know the guard sits inside a where clause.
  const findCallBlock = (methodName: string): string => {
    const idx = source.indexOf(`${methodName}(`);
    expect(idx).toBeGreaterThan(-1);
    // Pull a generous window after the call to cover arg object bodies.
    return source.slice(idx, idx + 600);
  };

  it('initial findMany filters on settlementId: null', () => {
    const block = findCallBlock('findMany');
    expect(block).toMatch(/settlementId\s*:\s*null/);
  });

  it('updateMany that claims records also filters on settlementId: null', () => {
    // The critical write-side guard: updateMany must check settlementId=null
    // so a concurrent cycle doesn't steal records from another claim.
    const block = findCallBlock('updateMany');
    expect(block).toMatch(/settlementId\s*:\s*null/);
  });
});
