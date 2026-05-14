// Phase 10 GST — TaxDocument state machine.
//
// Enforces the "no casual cancel" rule from
// docs/tax/INVOICE_CANCELLATION_POLICY.md (and CBIC Section 31 /
// Section 34 doctrine):
//
//   - DRAFT may be VOIDED_DRAFT (the only legal void path; the
//     document number isn't yet allocated, or if allocated, must
//     be tracked in DocumentSequence.skippedNumbers).
//   - Once GENERATED, a document can NEVER go back to DRAFT,
//     and can NEVER be VOIDED_DRAFT. Value reductions go via a
//     CREDIT_NOTE; value increases via a DEBIT_NOTE.
//   - Replacing an issued document for legitimate reasons (e.g.
//     forceNew regeneration) flips it to SUPERSEDED — the prior
//     document is preserved in the audit trail with its original
//     number; the new document has a fresh number.
//   - PARTIALLY_REVERSED ⇄ FULLY_REVERSED: cumulative credit-note
//     reversals can escalate from partial to full.
//   - Terminal states (VOIDED_DRAFT, SUPERSEDED, FULLY_REVERSED)
//     have no outgoing transitions.
//
// Pure function — no I/O. Service-layer code calls
// `assertTransitionAllowed` before any UPDATE on
// `tax_documents.status`.

import type { TaxDocumentStatus } from '@prisma/client';

/** Map of allowed `from → to` transitions. Implicit: any state may
 *  remain itself (idempotent retry). */
export const ALLOWED_TRANSITIONS: Record<TaxDocumentStatus, readonly TaxDocumentStatus[]> = {
  DRAFT: ['GENERATED', 'VOIDED_DRAFT'],
  GENERATED: [
    'PDF_PENDING',
    'PDF_GENERATED',
    'PDF_FAILED',
    'PARTIALLY_REVERSED',
    'FULLY_REVERSED',
    'SUPERSEDED',
  ],
  PDF_PENDING: [
    'PDF_GENERATED',
    'PDF_FAILED',
    'PARTIALLY_REVERSED',
    'FULLY_REVERSED',
    'SUPERSEDED',
  ],
  PDF_GENERATED: [
    'PARTIALLY_REVERSED',
    'FULLY_REVERSED',
    'SUPERSEDED',
    // Re-render allowed (e.g. template fix) — drops back into PDF_PENDING.
    'PDF_PENDING',
  ],
  PDF_FAILED: [
    // Retry path
    'PDF_PENDING',
    'PDF_GENERATED',
    'PARTIALLY_REVERSED',
    'FULLY_REVERSED',
    'SUPERSEDED',
  ],
  PARTIALLY_REVERSED: ['FULLY_REVERSED', 'SUPERSEDED'],
  // Terminal states
  FULLY_REVERSED: [],
  VOIDED_DRAFT: [],
  SUPERSEDED: [],
};

export class InvalidTaxDocumentTransitionError extends Error {
  constructor(
    public readonly from: TaxDocumentStatus,
    public readonly to: TaxDocumentStatus,
    public readonly hint?: string,
  ) {
    super(
      `Tax-document status transition ${from} → ${to} is not allowed.` +
        (hint ? ` Hint: ${hint}` : ''),
    );
    this.name = 'InvalidTaxDocumentTransitionError';
  }
}

/**
 * Returns true if the transition is allowed. Self-transitions
 * (from === to) are always allowed (idempotency).
 */
export function canTransition(
  from: TaxDocumentStatus,
  to: TaxDocumentStatus,
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Throws `InvalidTaxDocumentTransitionError` if the transition is
 * forbidden. Returns void on success. Service-layer wrapper.
 */
export function assertTransitionAllowed(
  from: TaxDocumentStatus,
  to: TaxDocumentStatus,
): void {
  if (!canTransition(from, to)) {
    let hint: string | undefined;
    if (to === 'VOIDED_DRAFT' && from !== 'DRAFT') {
      hint = 'Issued documents cannot be voided. Issue a CREDIT_NOTE for the full value to legally reverse it.';
    } else if (to === 'DRAFT') {
      hint = 'Documents cannot return to DRAFT once advanced past it. Issue a CREDIT_NOTE or SUPERSEDE to a new document.';
    } else if (ALLOWED_TRANSITIONS[from].length === 0) {
      hint = `Source status ${from} is terminal; create a new document instead.`;
    }
    throw new InvalidTaxDocumentTransitionError(from, to, hint);
  }
}

/** Convenience: is this status terminal (no outgoing transitions)? */
export function isTerminalStatus(status: TaxDocumentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Convenience: is this status one where the document has been legally
 *  issued (a number was assigned + customer/seller may have seen it)? */
export function isIssuedStatus(status: TaxDocumentStatus): boolean {
  return (
    status === 'GENERATED' ||
    status === 'PDF_PENDING' ||
    status === 'PDF_GENERATED' ||
    status === 'PDF_FAILED' ||
    status === 'PARTIALLY_REVERSED' ||
    status === 'FULLY_REVERSED' ||
    status === 'SUPERSEDED'
  );
}
