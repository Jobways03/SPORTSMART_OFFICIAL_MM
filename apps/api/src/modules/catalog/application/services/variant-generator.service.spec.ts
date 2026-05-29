/**
 * Phase 41 (2026-05-21) — locks the deterministic-fingerprint contract
 * and the Cartesian cap helpers. These are the safety rails that
 * close audit gaps #3 (combination uniqueness) and #6 (size cap).
 */

import { VariantGeneratorService } from './variant-generator.service';
import {
  VARIANT_GENERATE_MAX_COMBINATIONS,
  assertGenerateGroupsShape,
  computeCartesianSize,
} from '../../presentation/dtos/generate-variants.dto';

describe('VariantGeneratorService.computeOptionFingerprint', () => {
  it('produces stable output regardless of input order', () => {
    const a = VariantGeneratorService.computeOptionFingerprint(['red-id', 'large-id']);
    const b = VariantGeneratorService.computeOptionFingerprint(['large-id', 'red-id']);
    expect(a).toEqual(b);
  });

  it('differs between distinct combinations', () => {
    const a = VariantGeneratorService.computeOptionFingerprint(['red-id', 'large-id']);
    const b = VariantGeneratorService.computeOptionFingerprint(['red-id', 'medium-id']);
    expect(a).not.toEqual(b);
  });

  it('returns a 64-char hex sha256 digest', () => {
    const fp = VariantGeneratorService.computeOptionFingerprint(['a', 'b', 'c']);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles single-axis combos', () => {
    const fp = VariantGeneratorService.computeOptionFingerprint(['only-id']);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles empty input deterministically', () => {
    const a = VariantGeneratorService.computeOptionFingerprint([]);
    const b = VariantGeneratorService.computeOptionFingerprint([]);
    expect(a).toEqual(b);
  });
});

describe('computeCartesianSize', () => {
  it('returns 0 for empty groups', () => {
    expect(computeCartesianSize([])).toBe(0);
  });

  it('returns 1 for single value', () => {
    expect(computeCartesianSize([['x']])).toBe(1);
  });

  it('returns product of axis sizes', () => {
    expect(computeCartesianSize([['a', 'b'], ['c', 'd', 'e']])).toBe(6);
    expect(computeCartesianSize([['a'], ['b'], ['c']])).toBe(1);
  });

  it('matches the audit-cited DoS shape', () => {
    const fifty: string[] = Array.from({ length: 50 }, (_, i) => `v${i}`);
    expect(computeCartesianSize([fifty, fifty, fifty])).toBe(125_000);
    expect(125_000).toBeGreaterThan(VARIANT_GENERATE_MAX_COMBINATIONS);
  });
});

describe('assertGenerateGroupsShape', () => {
  it('passes well-formed groups', () => {
    expect(() => assertGenerateGroupsShape([['a', 'b'], ['c']])).not.toThrow();
  });

  it('rejects empty axis', () => {
    expect(() => assertGenerateGroupsShape([[]])).toThrow(/non-empty/);
  });

  it('rejects > 100 values per axis', () => {
    const big: string[] = Array.from({ length: 101 }, (_, i) => `v${i}`);
    expect(() => assertGenerateGroupsShape([big])).toThrow(/max 100/);
  });

  it('rejects duplicate ids within an axis', () => {
    expect(() => assertGenerateGroupsShape([['a', 'a']])).toThrow(/duplicate/);
  });

  it('rejects blank id', () => {
    expect(() => assertGenerateGroupsShape([['a', '']])).toThrow(/empty value/);
  });
});
