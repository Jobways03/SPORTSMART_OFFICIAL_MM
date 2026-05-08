import { BadRequestAppException } from '../../../../core/exceptions';

export type ReturnLiabilityParty =
  | 'NONE'
  | 'SELLER'
  | 'LOGISTICS'
  | 'PLATFORM'
  | 'CUSTOMER'
  // Phase 13 completion — additional fault attributions for returns.
  | 'FRANCHISE'
  | 'BRAND'
  | 'INCONCLUSIVE';

export type ReturnCustomerRemedy =
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'NO_REFUND'
  | 'GOODWILL_CREDIT'
  // Phase 13 (P1.14) — return-only outcomes. REPLACEMENT ships the
  // same SKU again at ₹0 (no money to customer). EXCHANGE ships a
  // different SKU; the price-diff path is decided separately by
  // classifyExchangePriceDiff and may emit a partial refund OR
  // require customer top-up.
  | 'REPLACEMENT'
  | 'EXCHANGE';

/**
 * Phase 13 — pure-function gatekeeper for the (newStatus × liabilityParty
 * × customerRemedy) combination at QC-decide time. Mirrors ADR-016's
 * dispute matrix so the same combinations are valid in both modules.
 *
 * Invalid combos throw BadRequestAppException with a message the admin
 * UI surfaces verbatim. Pure function so unit tests can exercise every
 * branch without spinning up the service.
 *
 * Allowed combinations (newStatus matters only when an item is approved):
 *   QC_APPROVED        + FULL_REFUND       + (SELLER | LOGISTICS | PLATFORM | NONE)
 *   QC_APPROVED        + GOODWILL_CREDIT   + PLATFORM (only)
 *   PARTIALLY_APPROVED + PARTIAL_REFUND    + (SELLER | LOGISTICS | PLATFORM | NONE)
 *
 * Forbidden combinations:
 *   - GOODWILL_CREDIT  + non-PLATFORM (goodwill is non-recoverable)
 *   - QC_APPROVED      + PARTIAL_REFUND (no items partially approved)
 *   - PARTIALLY_APPROVED + FULL_REFUND   (some items rejected)
 *   - NO_REFUND        + any approved (use QC_REJECTED instead)
 */
export function assertReturnDecisionMatrix(args: {
  newStatus: 'QC_APPROVED' | 'PARTIALLY_APPROVED' | string;
  liabilityParty: ReturnLiabilityParty | null;
  customerRemedy: ReturnCustomerRemedy | null;
}): void {
  const { newStatus, liabilityParty, customerRemedy } = args;

  if (!liabilityParty) {
    throw new BadRequestAppException(
      'liabilityParty is required when any item is approved/partial. ' +
        'Pick SELLER / LOGISTICS / PLATFORM / CUSTOMER / NONE based on ' +
        'who bears the cost of this refund.',
    );
  }
  if (!customerRemedy) {
    throw new BadRequestAppException(
      'customerRemedy is required when any item is approved/partial. ' +
        'Pick FULL_REFUND / PARTIAL_REFUND / GOODWILL_CREDIT.',
    );
  }
  if (newStatus === 'QC_APPROVED' && customerRemedy === 'PARTIAL_REFUND') {
    throw new BadRequestAppException(
      'PARTIAL_REFUND is only valid when the QC outcome is partial. ' +
        'For a fully approved return, use FULL_REFUND or GOODWILL_CREDIT.',
    );
  }
  if (newStatus === 'PARTIALLY_APPROVED' && customerRemedy === 'FULL_REFUND') {
    throw new BadRequestAppException(
      'FULL_REFUND is not valid for a partial QC outcome. Use PARTIAL_REFUND.',
    );
  }
  if (
    customerRemedy === 'GOODWILL_CREDIT' &&
    liabilityParty !== 'PLATFORM'
  ) {
    throw new BadRequestAppException(
      'GOODWILL_CREDIT must be paid by PLATFORM (it is non-recoverable ' +
        'by definition). Pick liabilityParty=PLATFORM or change the remedy.',
    );
  }
  if (customerRemedy === 'NO_REFUND') {
    throw new BadRequestAppException(
      'NO_REFUND is not valid when items are approved. Use QC_REJECTED ' +
        '(reject every item) for a no-refund outcome.',
    );
  }
  // Phase 13 (P1.14) — REPLACEMENT and EXCHANGE are only valid when
  // the QC outcome is fully approved. Partial-approval can't ship a
  // replacement of "some quantity" — the customer either gets the
  // remaining items refunded (PARTIAL_REFUND) or all items replaced.
  if (
    (customerRemedy === 'REPLACEMENT' || customerRemedy === 'EXCHANGE') &&
    newStatus !== 'QC_APPROVED'
  ) {
    throw new BadRequestAppException(
      `${customerRemedy} requires QC_APPROVED (all items approved). ` +
        'For partial-approval cases use PARTIAL_REFUND instead.',
    );
  }
  // REPLACEMENT / EXCHANGE always land on the seller (same product
  // catalog, same SKU or sibling SKU). PLATFORM / LOGISTICS can be
  // overridden but must be deliberate — admin sets liabilityParty
  // explicitly. We don't gate that here.
}

/**
 * Decides which ledger row to write based on (liabilityParty,
 * customerRemedy). Returns null for parties that don't produce a
 * ledger row (CUSTOMER, NONE) — caller skips the write.
 */
export type LedgerKind =
  | { kind: 'SELLER_DEBIT' }
  | { kind: 'LOGISTICS_CLAIM' }
  | { kind: 'PLATFORM_EXPENSE'; expenseType: 'PLATFORM_FAULT' | 'GOODWILL' }
  | null;

export function mapReturnDecisionToLedger(args: {
  liabilityParty: ReturnLiabilityParty;
  customerRemedy: ReturnCustomerRemedy;
}): LedgerKind {
  const { liabilityParty, customerRemedy } = args;
  // Phase 13 (P1.14) — REPLACEMENT / EXCHANGE keep the customer in
  // the same product (no wallet credit), so no money flow → no
  // ledger row at QC time. Any partial refund triggered by an
  // EXCHANGE price diff is recorded separately as a regular refund
  // path with its own (sourceType=RETURN, sourceId) ledger pair.
  if (customerRemedy === 'REPLACEMENT' || customerRemedy === 'EXCHANGE') {
    return null;
  }
  if (customerRemedy === 'GOODWILL_CREDIT') {
    return { kind: 'PLATFORM_EXPENSE', expenseType: 'GOODWILL' };
  }
  if (liabilityParty === 'SELLER') return { kind: 'SELLER_DEBIT' };
  if (liabilityParty === 'LOGISTICS') return { kind: 'LOGISTICS_CLAIM' };
  if (liabilityParty === 'PLATFORM') {
    return { kind: 'PLATFORM_EXPENSE', expenseType: 'PLATFORM_FAULT' };
  }
  // FRANCHISE / BRAND fault → recovery happens via the corresponding
  // settlement adjustment for that party. There's no dedicated ledger
  // table yet for either (would be franchise_debits / brand_debits in
  // a follow-up); for now we book the cost as a PlatformExpense so
  // finance has a paper trail and can manually reconcile against the
  // franchise / brand statement. Reason text on the row records the
  // attribution so it isn't lost.
  if (liabilityParty === 'FRANCHISE' || liabilityParty === 'BRAND') {
    return { kind: 'PLATFORM_EXPENSE', expenseType: 'PLATFORM_FAULT' };
  }
  // INCONCLUSIVE — QC couldn't determine who's at fault. Platform
  // absorbs the cost rather than wrongly attributing.
  if (liabilityParty === 'INCONCLUSIVE') {
    return { kind: 'PLATFORM_EXPENSE', expenseType: 'PLATFORM_FAULT' };
  }
  // CUSTOMER, NONE → no ledger row (refund either rejected or platform-absorbed
  // as a default; the matrix validator already rejected invalid combos).
  return null;
}
