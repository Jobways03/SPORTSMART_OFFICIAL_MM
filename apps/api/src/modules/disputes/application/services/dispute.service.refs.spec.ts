/**
 * Phase 15 (2026-05-16) — first behavioural test for the disputes
 * module. Pre-Phase-15 the module had zero specs.
 *
 * `normalizeOrderRef` and `normalizeReturnRef` are the pure helpers
 * the dispute-file path uses to clean customer/admin-entered order
 * or return references before the DB lookup. Customers paste
 * "Order SM-2026-0001", admins paste "#sm-2026-0001"; both should
 * resolve. The functions are tiny but the resolver behaviour is
 * critical — a missed normalisation = "dispute not linked to order"
 * + a confused support agent.
 */
import 'reflect-metadata';
import {
  normalizeOrderRef,
  normalizeReturnRef,
} from './dispute.service';

describe('normalizeOrderRef / normalizeReturnRef (Phase 15)', () => {
  describe('normalizeOrderRef', () => {
    it('returns undefined for null / undefined / empty inputs', () => {
      expect(normalizeOrderRef(null)).toBeUndefined();
      expect(normalizeOrderRef(undefined)).toBeUndefined();
      expect(normalizeOrderRef('')).toBeUndefined();
      expect(normalizeOrderRef('   ')).toBeUndefined();
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeOrderRef('  SM-001  ')).toBe('SM-001');
    });

    it('strips a leading `#` (admin paste habit)', () => {
      expect(normalizeOrderRef('#SM-001')).toBe('SM-001');
      expect(normalizeOrderRef('##SM-001')).toBe('SM-001');
    });

    it('strips a leading "Order " / "ORDER " / "order " prefix', () => {
      expect(normalizeOrderRef('Order SM-001')).toBe('SM-001');
      expect(normalizeOrderRef('ORDER SM-001')).toBe('SM-001');
      expect(normalizeOrderRef('order SM-001')).toBe('SM-001');
    });

    it('returns the cleaned reference verbatim when no prefix is present', () => {
      expect(normalizeOrderRef('SM-2026-0001')).toBe('SM-2026-0001');
    });
  });

  describe('normalizeReturnRef', () => {
    it('returns undefined for null / undefined / empty inputs', () => {
      expect(normalizeReturnRef(null)).toBeUndefined();
      expect(normalizeReturnRef('')).toBeUndefined();
    });

    it('strips a leading "Return " prefix', () => {
      expect(normalizeReturnRef('Return RET-001')).toBe('RET-001');
      expect(normalizeReturnRef('return RET-001')).toBe('RET-001');
    });

    it('strips a leading `#`', () => {
      expect(normalizeReturnRef('#RET-001')).toBe('RET-001');
    });

    it('returns the cleaned reference verbatim when no prefix is present', () => {
      expect(normalizeReturnRef('RET-2026-0001')).toBe('RET-2026-0001');
    });
  });
});
