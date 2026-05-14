# CREDIT_NOTE_TIME_BAR_POLICY.md

**Purpose:** Section 34 time-bar enforcement for credit notes.

---

## 1. The rule

Per CGST Act Section 34(2), a credit note must be **declared in the return for the month not later than September following the end of the financial year in which the supply was made**.

In practice:
- Supply made in FY 2026-27 (April 2026 – March 2027)
- Credit note must be issued and declared in GSTR-1 **by 30 September 2027**
- After 30 September 2027, a credit note can still be issued for accounting purposes, but **GST liability cannot be reduced** — i.e. Sportsmart absorbs the GST loss.

## 2. Implementation

### 2.1 Eligibility check at credit-note creation

```typescript
function isWithinSection34Window(originalInvoiceDate: Date, now: Date): boolean {
  const invoiceFy = financialYearOf(originalInvoiceDate);   // e.g. "2026-27"
  const fyEndYear = parseInt(invoiceFy.split('-')[1]);      // 27
  const cutoffDate = new Date(Date.UTC(2000 + fyEndYear, 8, 30, 23, 59, 59));
  // September 30 of next FY, 23:59:59 IST
  return now <= cutoffDate;
}
```

When `ReturnService.submitQcDecision()` triggers credit-note creation:
- If within window → `CreditNoteService.generateForReturn()` produces real credit note; GST reversed.
- If outside window → no GST credit note created; `wallet_adjustments` row issued for refund; AdminTask `GST_CREDIT_NOTE_TIME_BARRED` raised.

### 2.2 Daily cron

`tax_credit_note_timebar_checker` runs daily at 02:30 IST:
- Finds approved returns within 7 days of expiring (`window − 7 days <= now < window`)
- Raises early-warning AdminTask `GST_CREDIT_NOTE_TIME_BAR_APPROACHING` for finance to prioritise
- Finds approved returns outside window with no credit note → reconciliation alert

### 2.3 Strict mode

`TAX_STRICT_MODE=true`:
- Time-bar hard-enforced.
- AdminTask raised within seconds of QC approval if window has lapsed.
- Customer-facing message on return detail:
  > **Refund processed. GST adjustment is not available for this return due to statutory reporting timelines.**

`TAX_STRICT_MODE=false`:
- Engineering still creates the credit note (for testability).
- Logs warning + raises AdminTask in shadow mode.
- Customer sees normal credit-note download (test data, not production-safe).

## 3. Data captured

On every credit-note issuance attempt:
- `tax_documents.creditNoteEligibilityStatus`: `ELIGIBLE | TIME_BARRED | REQUIRES_FINANCE_REVIEW`
- `tax_documents.creditNoteTimeBarReason`: free text (e.g. "Original invoice 2026-04-15; window expired 2027-09-30")
- `tax_documents.financeReviewedBy + financeReviewedAt`: optional — for borderline cases

## 4. Finance workflow

Time-barred returns produce AdminTask `GST_CREDIT_NOTE_TIME_BARRED`. Finance workflow:

1. Review the return + original invoice.
2. Decide:
   - **Issue customer refund without GST reversal** → wallet_adjustment with reason `TIME_BARRED_GOODWILL`. Sportsmart absorbs GST as a business expense.
   - **Decline customer refund** (rare — only if return is also non-meritorious) → return marked QC_REJECTED.
3. Mark AdminTask resolved.
4. The GST loss is booked to a finance GL account (CA-provided code) for tax-expense reporting.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Return approved on 30 Sept 23:59 IST | Within window — credit note issued. |
| Return approved on 1 Oct 00:00 IST (return filed earlier, just approved late) | Outside window — time-barred. |
| Return approved in window, but credit note PDF generation fails | Credit note row exists with `status=PDF_FAILED`; not time-barred (window is for *issuance*, not PDF). Retry cron handles PDF. |
| Same return partially approved on multiple dates | Each approval generates a separate credit note (one per QC batch). Each evaluated independently for time-bar. |
| Customer requests cancellation of order on day 6 (pre-shipment, within FY) | Credit note for full amount — within window. |
| Customer requests cancellation of order in next-FY September | Standard window check. |

## 6. Audit + reporting

- Every time-bar evaluation logged: `tax.credit_note.timebar_check` audit event with `eligibilityStatus + invoiceDate + currentDate`.
- Monthly admin report: "Time-barred credit notes — financial impact." Sum of GST not reversed due to time-bar, per filing period.
- Annual report: included in CA's year-end review packet.

## 7. Permissions

- `tax.creditNote.read` — view eligibility status
- `tax.creditNote.timebar.override` — finance-only; manually approve credit note past window (rare; documented per case)
- `tax.creditNote.timebar.review` — finance review for `REQUIRES_FINANCE_REVIEW` status

## 8. CA actions required

1. Confirm 30 September of next FY is the right cutoff (matches CBIC interpretation).
2. Confirm timezone for the cutoff (engineering uses end-of-day IST).
3. Confirm whether `tax.creditNote.timebar.override` permission should exist at all (some CAs forbid override).
4. Provide GL account code for "GST expense — time-barred credit notes".
5. Confirm 7-day early-warning is enough (vs 14 / 30).
6. Confirm whether time-barred situations require notification to the buyer with explicit wording (default message in §2.3).

---

**Related:** `GST_ASSUMPTIONS.md` §6; `CA.md` §3 item 9, §6.2.
