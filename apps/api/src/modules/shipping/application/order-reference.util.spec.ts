import { buildOrderReference } from './order-reference.util';

describe('buildOrderReference', () => {
  it('forward: "<orderNumber>-<tag>" (last 6 of sub-order id, uppercased)', () => {
    expect(buildOrderReference('SM-1001', 'order-sub-123456')).toBe(
      'SM-1001-123456',
    );
  });

  it('defaults to forward when direction is omitted (label-generator path)', () => {
    expect(buildOrderReference('SM-1001', 'order-sub-123456')).toBe(
      buildOrderReference('SM-1001', 'order-sub-123456', 'forward'),
    );
  });

  // Regression (2026-06-16): the reverse pickup MUST get a distinct order id.
  // Pre-fix it reused the forward reference, so Delhivery (which dedupes on
  // (client, order)) treated every RVP as a duplicate of the original outbound
  // shipment and returned no reverse AWB — silently breaking auto-pickup.
  it('reverse: RVP-prefixed and DISTINCT from the forward reference', () => {
    const fwd = buildOrderReference('SM-1001', 'order-sub-123456', 'forward');
    const rev = buildOrderReference('SM-1001', 'order-sub-123456', 'reverse');
    expect(rev).toBe(`RVP-${fwd}`);
    expect(rev).not.toBe(fwd); // the bug: same id → Delhivery dedup collision
  });

  it('reverse stays distinct even on the no-orderNumber fallback', () => {
    expect(buildOrderReference(null, 'sub-xyz', 'reverse')).toBe('RVP-sub-xyz');
    expect(buildOrderReference(undefined, 'sub-xyz', 'forward')).toBe('sub-xyz');
  });

  it('is deterministic — same inputs reproduce the same reference (idempotent re-booking)', () => {
    expect(buildOrderReference('SM-9', 'abc-def-ABCDEF', 'reverse')).toBe(
      buildOrderReference('SM-9', 'abc-def-ABCDEF', 'reverse'),
    );
  });
});
