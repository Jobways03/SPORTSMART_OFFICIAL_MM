// Phase 11 GST — Section 34 credit-note time-bar check.
//
// CGST Act Section 34(2): a credit note must be DECLARED in the
// supplier's outward-supply return (GSTR-1) no later than the GSTR-1
// for September of the financial year following the FY in which the
// original supply was made.
//
// In practice — credit notes for supplies in FY YYYY-(YY+1) must be
// issued by 30 September YYYY+1, end-of-day IST.
//
// After that date the supplier may still issue an internal "credit
// note" for accounting purposes, but GST output liability CANNOT be
// reduced — the GST cost is absorbed by the platform / seller.
//
// This module exposes:
//   - `isWithinSection34Window(originalInvoiceDate, now)` boolean
//   - `section34CutoffFor(originalInvoiceDate)` Date — the IST EOD
//     of 30 September of FY+1
//
// Pure function — no I/O. Service layer uses the result to decide
// between issuing a real CREDIT_NOTE vs. recording a `wallet_adjustment`
// + AdminTask `GST_CREDIT_NOTE_TIME_BARRED` (Phase 12 cron handles
// the latter).

/**
 * Compute the IST-EOD cutoff for issuing a credit note against a
 * supply made on `originalInvoiceDate`.
 *
 * 30 September YYYY+1 at 23:59:59.999 IST
 *  = 30 September YYYY+1 at 18:29:59.999 UTC.
 */
export function section34CutoffFor(originalInvoiceDate: Date): Date {
  const utc = originalInvoiceDate.getTime();
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth(); // 0 = Jan
  const y = ist.getUTCFullYear();
  // FY starts April (month 3). If the invoice was issued Apr-Dec of
  // year Y, FY ends in Y+1; cutoff is 30 Sept of Y+1.
  // If invoice was issued Jan-Mar of Y, FY ends in Y; cutoff is 30
  // Sept of Y.
  const fyEndYear = m >= 3 ? y + 1 : y;
  // 30 Sept FYEND at 23:59:59.999 IST = 30 Sept FYEND 18:29:59.999 UTC
  return new Date(Date.UTC(fyEndYear, 8, 30, 18, 29, 59, 999));
}

/**
 * Returns true if `now` is on or before the Section 34 cutoff for
 * the given invoice date.
 */
export function isWithinSection34Window(
  originalInvoiceDate: Date,
  now: Date = new Date(),
): boolean {
  const cutoff = section34CutoffFor(originalInvoiceDate);
  return now.getTime() <= cutoff.getTime();
}
