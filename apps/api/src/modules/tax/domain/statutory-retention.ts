// Phase 21 GST — Statutory retention math.
//
// Per CGST Act Section 36 (read with Rule 56 and the books-of-account
// rules): every registered person must preserve invoices, credit / debit
// notes, and the supporting records for **72 months from the due date of
// filing the annual return** for the year to which they relate. The
// practical floor used across CA practice — and the one engineering
// applies in code — is **8 years from invoice issuance**.
//
// We retain:
//   - tax_documents (TAX_INVOICE, BILL_OF_SUPPLY,
//     INVOICE_CUM_BILL_OF_SUPPLY, CREDIT_NOTE, DEBIT_NOTE,
//     LEGACY_RECEIPT)
//   - tax_document_download_audits (download forensic trail)
//   - tax_document_lines (line-level audit)
//   - gst_tcs_settlement_ledger (Section 52 evidence)
//   - e_way_bills (Rule 138 movement evidence)
//   - wallet_adjustments (GST-cost-absorbed audit)
//
// Customer-erasure (DPDPA Section 12 / GDPR Article 17) is satisfied
// by redacting the customer's PII on the `users` row only. Tax-document
// PII fields (buyer_legal_name, billing_address_json, shipping_address_json)
// were SNAPSHOTTED at issuance and are statutory records — they outlive
// the user's right to be forgotten.
//
// This module is pure: no DB / Prisma I/O. Date arithmetic only.

/** Default statutory retention window. CA can override via env. */
export const DEFAULT_STATUTORY_RETENTION_YEARS = 8;

/**
 * Compute the retention expiry date for a document issued at
 * `generatedAt`. Returns 8 years after issuance in absolute UTC.
 *
 * Year arithmetic uses JavaScript Date's setFullYear which handles
 * leap-day shifts (29 Feb 2024 + 8y → 28 Feb 2032 in non-leap years).
 */
export function computeRetentionExpiry(
  generatedAt: Date,
  retentionYears: number = DEFAULT_STATUTORY_RETENTION_YEARS,
): Date {
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
    throw new Error('computeRetentionExpiry: invalid generatedAt');
  }
  if (retentionYears < 0) {
    throw new Error(
      `computeRetentionExpiry: retentionYears must be non-negative, got ${retentionYears}`,
    );
  }
  const out = new Date(generatedAt.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + retentionYears);
  return out;
}

/**
 * True if a document issued at `generatedAt` is still within the
 * statutory retention window at `now`.
 */
export function isUnderStatutoryRetention(
  generatedAt: Date,
  now: Date = new Date(),
  retentionYears: number = DEFAULT_STATUTORY_RETENTION_YEARS,
): boolean {
  const expiry = computeRetentionExpiry(generatedAt, retentionYears);
  return now.getTime() < expiry.getTime();
}

/**
 * Whole-day count from `now` to retention expiry. Negative when the
 * document has already aged out of retention.
 */
export function daysUntilRetentionExpiry(
  generatedAt: Date,
  now: Date = new Date(),
  retentionYears: number = DEFAULT_STATUTORY_RETENTION_YEARS,
): number {
  const expiry = computeRetentionExpiry(generatedAt, retentionYears);
  return Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
