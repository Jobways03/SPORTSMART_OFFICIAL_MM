import 'reflect-metadata';
import {
  canTransition,
  assertTransitionAllowed,
  InvalidTaxDocumentTransitionError,
  isTerminalStatus,
  isIssuedStatus,
  ALLOWED_TRANSITIONS,
} from '../../src/modules/tax/domain/tax-document-state-machine';
import type { TaxDocumentStatus } from '@prisma/client';

// Phase 10 GST — tax-document FSM tests.

const ALL_STATUSES: TaxDocumentStatus[] = [
  'DRAFT',
  'GENERATED',
  'PDF_PENDING',
  'PDF_GENERATED',
  'PDF_FAILED',
  'PARTIALLY_REVERSED',
  'FULLY_REVERSED',
  'SUPERSEDED',
  'VOIDED_DRAFT',
];

describe('canTransition', () => {
  it('idempotent self-transitions are always allowed', () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it('DRAFT → GENERATED is allowed (number allocated)', () => {
    expect(canTransition('DRAFT', 'GENERATED')).toBe(true);
  });

  it('DRAFT → VOIDED_DRAFT is allowed (the only legal void path)', () => {
    expect(canTransition('DRAFT', 'VOIDED_DRAFT')).toBe(true);
  });

  it('GENERATED → VOIDED_DRAFT is FORBIDDEN — must use credit note', () => {
    expect(canTransition('GENERATED', 'VOIDED_DRAFT')).toBe(false);
  });

  it('GENERATED → DRAFT is FORBIDDEN — no going back', () => {
    expect(canTransition('GENERATED', 'DRAFT')).toBe(false);
  });

  it('GENERATED → PARTIALLY_REVERSED is allowed (partial credit note)', () => {
    expect(canTransition('GENERATED', 'PARTIALLY_REVERSED')).toBe(true);
  });

  it('GENERATED → FULLY_REVERSED is allowed (full credit note)', () => {
    expect(canTransition('GENERATED', 'FULLY_REVERSED')).toBe(true);
  });

  it('GENERATED → SUPERSEDED is allowed (forceNew regeneration)', () => {
    expect(canTransition('GENERATED', 'SUPERSEDED')).toBe(true);
  });

  it('PDF_PENDING → PDF_GENERATED is allowed', () => {
    expect(canTransition('PDF_PENDING', 'PDF_GENERATED')).toBe(true);
  });

  it('PDF_FAILED → PDF_PENDING is allowed (retry)', () => {
    expect(canTransition('PDF_FAILED', 'PDF_PENDING')).toBe(true);
  });

  it('PDF_GENERATED → PDF_PENDING is allowed (re-render after template fix)', () => {
    expect(canTransition('PDF_GENERATED', 'PDF_PENDING')).toBe(true);
  });

  it('PARTIALLY_REVERSED → FULLY_REVERSED is allowed (cumulative reversals)', () => {
    expect(canTransition('PARTIALLY_REVERSED', 'FULLY_REVERSED')).toBe(true);
  });

  it('terminal states have no outgoing transitions (except self)', () => {
    for (const terminal of ['VOIDED_DRAFT', 'SUPERSEDED', 'FULLY_REVERSED'] as TaxDocumentStatus[]) {
      for (const other of ALL_STATUSES) {
        if (other === terminal) continue;
        expect(canTransition(terminal, other)).toBe(false);
      }
    }
  });

  it('VOIDED_DRAFT is terminal — cannot revive', () => {
    expect(canTransition('VOIDED_DRAFT', 'DRAFT')).toBe(false);
    expect(canTransition('VOIDED_DRAFT', 'GENERATED')).toBe(false);
  });

  it('SUPERSEDED is terminal — cannot resurrect', () => {
    expect(canTransition('SUPERSEDED', 'GENERATED')).toBe(false);
  });

  it('FULLY_REVERSED is terminal — additional credit notes can be issued against the new state, but the original document stays', () => {
    expect(canTransition('FULLY_REVERSED', 'PARTIALLY_REVERSED')).toBe(false);
    expect(canTransition('FULLY_REVERSED', 'GENERATED')).toBe(false);
  });
});

describe('assertTransitionAllowed', () => {
  it('returns void on allowed transitions', () => {
    expect(() => assertTransitionAllowed('DRAFT', 'GENERATED')).not.toThrow();
    expect(() => assertTransitionAllowed('GENERATED', 'PDF_PENDING')).not.toThrow();
    expect(() => assertTransitionAllowed('PDF_FAILED', 'PDF_PENDING')).not.toThrow();
  });

  it('throws InvalidTaxDocumentTransitionError with hint on forbidden voids', () => {
    try {
      assertTransitionAllowed('GENERATED', 'VOIDED_DRAFT');
      fail('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTaxDocumentTransitionError);
      const err = e as InvalidTaxDocumentTransitionError;
      expect(err.from).toBe('GENERATED');
      expect(err.to).toBe('VOIDED_DRAFT');
      expect(err.message).toMatch(/CREDIT_NOTE/);
    }
  });

  it('throws on backwards transitions', () => {
    expect(() => assertTransitionAllowed('GENERATED', 'DRAFT')).toThrow(InvalidTaxDocumentTransitionError);
  });

  it('throws on transitions out of terminal states', () => {
    expect(() => assertTransitionAllowed('SUPERSEDED', 'GENERATED')).toThrow(InvalidTaxDocumentTransitionError);
    expect(() => assertTransitionAllowed('FULLY_REVERSED', 'PARTIALLY_REVERSED')).toThrow(InvalidTaxDocumentTransitionError);
    expect(() => assertTransitionAllowed('VOIDED_DRAFT', 'DRAFT')).toThrow(InvalidTaxDocumentTransitionError);
  });
});

describe('isTerminalStatus', () => {
  it('correctly identifies terminal states', () => {
    expect(isTerminalStatus('VOIDED_DRAFT')).toBe(true);
    expect(isTerminalStatus('SUPERSEDED')).toBe(true);
    expect(isTerminalStatus('FULLY_REVERSED')).toBe(true);
  });
  it('non-terminal states are not terminal', () => {
    expect(isTerminalStatus('DRAFT')).toBe(false);
    expect(isTerminalStatus('GENERATED')).toBe(false);
    expect(isTerminalStatus('PARTIALLY_REVERSED')).toBe(false);
  });
});

describe('isIssuedStatus', () => {
  it('GENERATED and all PDF_* statuses count as issued', () => {
    expect(isIssuedStatus('GENERATED')).toBe(true);
    expect(isIssuedStatus('PDF_PENDING')).toBe(true);
    expect(isIssuedStatus('PDF_GENERATED')).toBe(true);
    expect(isIssuedStatus('PDF_FAILED')).toBe(true);
  });
  it('PARTIALLY_REVERSED / FULLY_REVERSED / SUPERSEDED count as issued (they had a number)', () => {
    expect(isIssuedStatus('PARTIALLY_REVERSED')).toBe(true);
    expect(isIssuedStatus('FULLY_REVERSED')).toBe(true);
    expect(isIssuedStatus('SUPERSEDED')).toBe(true);
  });
  it('DRAFT and VOIDED_DRAFT are not issued', () => {
    expect(isIssuedStatus('DRAFT')).toBe(false);
    expect(isIssuedStatus('VOIDED_DRAFT')).toBe(false);
  });
});

describe('ALLOWED_TRANSITIONS sanity', () => {
  it('every status is a key', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s);
    }
  });
  it('every target referenced is a real status', () => {
    for (const [, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const t of targets) {
        expect(ALL_STATUSES).toContain(t as TaxDocumentStatus);
      }
    }
  });
});
