// Phase 89 (2026-05-23) — HSN inter-state-at-any-value rule.

import {
  hsnRequiresInterStateEwb,
  anyLineRequiresInterStateEwb,
} from './eway-bill-hsn-policy';

describe('hsnRequiresInterStateEwb', () => {
  it('matches handicraft HSN 9701 (paintings)', () => {
    expect(hsnRequiresInterStateEwb('9701')).toBe(true);
  });

  it('matches 6-digit narrowing under same prefix (9701.10)', () => {
    expect(hsnRequiresInterStateEwb('970110')).toBe(true);
  });

  it('matches 8-digit narrowing (9701.10.10)', () => {
    expect(hsnRequiresInterStateEwb('97011010')).toBe(true);
  });

  it('matches imitation jewellery 7117', () => {
    expect(hsnRequiresInterStateEwb('7117')).toBe(true);
  });

  it('matches cotton woven fabrics 5208', () => {
    expect(hsnRequiresInterStateEwb('5208')).toBe(true);
  });

  it('rejects mundane HSN 6204 (women apparel)', () => {
    expect(hsnRequiresInterStateEwb('6204')).toBe(false);
  });

  it('rejects empty / null / short input', () => {
    expect(hsnRequiresInterStateEwb('')).toBe(false);
    expect(hsnRequiresInterStateEwb(null)).toBe(false);
    expect(hsnRequiresInterStateEwb('97')).toBe(false);
  });
});

describe('anyLineRequiresInterStateEwb', () => {
  it('returns true when any line matches', () => {
    expect(anyLineRequiresInterStateEwb(['6204', '9701'])).toBe(true);
  });

  it('returns false when no line matches', () => {
    expect(anyLineRequiresInterStateEwb(['6204', '6203'])).toBe(false);
  });

  it('returns false for empty list', () => {
    expect(anyLineRequiresInterStateEwb([])).toBe(false);
  });
});
