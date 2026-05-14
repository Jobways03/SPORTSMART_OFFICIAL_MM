# INVOICE_CANCELLATION_POLICY.md

**Purpose:** Define how invoices, bills of supply, credit notes, and debit notes are handled when an order or supply changes after document issuance. Indian GST law forbids casual cancellation of issued tax documents.

---

## 1. Core principle

Under GST law:

- A tax invoice once issued generally **cannot be "cancelled"**. It must be reversed via a **credit note**.
- An invoice number once issued **cannot be reused**.
- Pre-issue drafts can be deleted/voided (engineering term: `VOIDED_DRAFT`) only before they obtain a document number.
- IRN-generated e-invoices (when applicable) can be cancelled via NIC IRP **within 24 hours**; after that, credit note only.

## 2. Status machine

`tax_documents.status`:

```
DRAFT
  ↓ assign number
GENERATED
  ↓ (on partial credit note issued)
PARTIALLY_REVERSED
  ↓ (on enough credit notes to reverse fully)
FULLY_REVERSED
  ↓ (replaced by corrected invoice — rare; tracked as SUPERSEDED)
SUPERSEDED

VOIDED_DRAFT — only from DRAFT before number assignment
```

Forbidden transitions:
- `GENERATED → VOIDED_DRAFT` (must go through credit note)
- `GENERATED → DRAFT` (numbers can't be unassigned)
- Re-use of a `VOIDED_DRAFT` document number for a new document

## 3. Pre-issue (DRAFT → VOIDED_DRAFT)

A draft has no document number. Drafts exist for:
- Preview before issuance (rare — most issuance is synchronous)
- Failed sequence-acquisition retries

Drafts can be deleted/voided without GST implications. Engineering logs the void to audit but no GST event fires.

## 4. Post-issue corrections

After `GENERATED`, corrections happen through:

### 4.1 Order fully cancelled before delivery

- Customer cancels online order before dispatch, or admin cancels.
- Issue **full credit note** with `reason: ORDER_CANCELLED`.
- Original invoice status flips to `FULLY_REVERSED`.
- Refund processed.
- Both documents retained for retention period.

### 4.2 Partial return after delivery

- Customer returns 1 of 3 units.
- Issue **partial credit note** with `reason: PARTIAL_RETURN`.
- Original invoice status: `PARTIALLY_REVERSED` (cumulative tracking — see §4.3).
- Subsequent returns of same invoice continue to issue partial credit notes.

### 4.3 Conservation invariant

Sum of credit note `taxableReversalInPaise` across all credit notes for a single invoice **cannot exceed** the invoice's `taxableAmountInPaise`. Enforced by `CreditNoteService.computeReversalForLine()`:
```ts
if (cumulativeReversal + thisReversal > originalTaxable) {
  throw new Error('Cumulative credit note reversal would exceed original invoice taxable value');
}
```
Same for each GST component (CGST, SGST, IGST).

### 4.4 Price increase post-issue (rare in e-commerce)

- Issue **debit note** with `reason: PRICE_ADJUSTMENT`.
- Admin-only path; requires `tax.debitNote.create` permission.
- Recipient gets a debit note PDF — they may need to pay additional GST.

### 4.5 IRN cancellation (e-invoice case, when applicable)

If `EINVOICE_ENABLED=true` and the document has an IRN:
- Within 24 hours of IRN generation: call `IrpClient.cancel(irn)` with cancellation reason code.
- Document flips to `VOIDED_DRAFT` (allowed only here for IRN-cancellation within window). The invoice number is **NOT** reused.
- After 24 hours: credit note only.

## 5. Customer-cancelled COD orders pre-delivery

For COD orders, invoice is generated at `PACKED` (just before ship). If customer refuses delivery:
- Carrier returns goods to seller.
- Seller marks `RTO_DELIVERED` (return-to-origin completed).
- Triggers full credit note for invoice with `reason: ORDER_CANCELLED` (or `RTO` as a sub-reason).
- No money was collected (COD); no refund flow; just GST reversal.

## 6. Returns vs RTOs

- **Customer return** (post-delivery, customer initiated): full RMA flow, QC at warehouse, partial / full credit note based on QC outcome.
- **RTO** (return to origin — customer refused delivery, NDR exhausted, address invalid): credit note for full amount, fixed reason `RTO`. No QC required.

Both produce credit notes. The trigger is different (`return.service.ts` for customer return; `shipping.service.ts` for RTO).

## 7. Audit + reporting

Every status transition logs:
- `tax.document.status_changed` event with `oldStatus + newStatus + reason + actor`.
- Original document retained at 72-month retention; transitions preserved.

Monthly admin report: "Invoice corrections by reason" — count of credit/debit notes issued by reason code, financial impact.

## 8. Permissions

- `tax.invoice.read`
- `tax.invoice.void-draft` — allowed only on `DRAFT` status
- `tax.creditNote.create` — issue credit note (called by Return service automatically; admin manual path requires this)
- `tax.creditNote.read`
- `tax.debitNote.create` — admin-only manual path for upward price corrections
- `tax.einvoice.cancel-within-window` — call IRP cancel (only when EINVOICE_ENABLED)

## 9. Customer-facing messages

| Scenario | Customer sees |
|---|---|
| Order cancelled pre-dispatch | "Order cancelled. Refund of ₹X processed. Credit note PDF available in your account." |
| Partial return approved | "Return for X of Y items approved. Credit note PDF available." |
| Customer refused COD delivery | "Order returned to seller. No charge applied." |
| Full return + refund | "Return approved. Refund of ₹X processed. Credit note PDF available." |
| Time-barred (see CREDIT_NOTE_TIME_BAR_POLICY) | "Refund processed. GST adjustment is not available for this return due to statutory reporting timelines." |
| Debit note issued (rare) | Email-only: "Additional charge of ₹X applies to your earlier order. PDF attached." |

## 10. CA actions required

1. Confirm the "no cancellation, only credit note" policy matches CA's interpretation.
2. Confirm 24-hour IRN cancellation window is current per CBIC notification (some changes proposed for 2026).
3. Confirm allowed reason codes per CBIC GSTR-1 schema:
   - `01 — Sales return`
   - `02 — Post sale discount`
   - `03 — Deficiency in services`
   - `04 — Correction in invoice`
   - `05 — Change in POS`
   - `06 — Finalization of provisional assessment`
   - `07 — Others`
4. Confirm whether `tax.debitNote.create` should require dual-admin approval.
5. Confirm reason-code mapping from internal reasons (RETURN, PARTIAL_RETURN, ORDER_CANCELLED, etc.) to CBIC reason codes.

---

**Related:** `GST_ASSUMPTIONS.md` §5, §6; `CREDIT_NOTE_TIME_BAR_POLICY.md`; `CA.md` §6.2.
