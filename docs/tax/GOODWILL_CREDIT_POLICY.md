# GOODWILL_CREDIT_POLICY.md

**Purpose:** Distinguish goodwill / non-tax customer compensation from formal credit notes, and keep goodwill credits out of GST returns.

---

## 1. The principle

Under Section 34, a credit note can only be issued when **taxable value or tax charged is reduced**. Pure goodwill — money returned to the customer with no change to the original supply's taxable value — is NOT a credit note. Treating goodwill as a credit note is **incorrect under GST law** and pollutes GSTR-1.

Sportsmart routes goodwill through a separate `wallet_adjustments` model that has no GST impact and never enters `tax_documents`.

## 2. When to use which

| Scenario | Document type | Reduces taxable value? | Appears in GSTR-1? |
|---|---|---|---|
| Customer returns goods, refund issued | CREDIT_NOTE (`tax_documents`) | Yes | Yes |
| Customer cancels order pre-shipment, refund issued | CREDIT_NOTE | Yes | Yes |
| Customer dispute resolved buyer-favour, full refund | CREDIT_NOTE | Yes | Yes |
| Customer dispute resolved buyer-favour, partial refund | CREDIT_NOTE (partial) | Yes (partial) | Yes |
| Order delivered fine; customer complains; admin gives ₹100 goodwill | wallet_adjustment (no credit note) | No | No |
| Promo credit ("first order ₹100 off, post-supply") | wallet_adjustment (POST_SUPPLY_UNLINKED) | No | No |
| Support agent grants ₹200 wallet credit for poor experience | wallet_adjustment | No | No |
| Time-barred return (past Sept 30 of next FY) | wallet_adjustment (with reason TIME_BARRED) | Effectively no (GST already filed) | No new GSTR-1 entry |

## 3. Decision UI for admin

When admin processes a customer dispute or grants a refund, the UI asks:

> **Is this reducing the taxable value of the original sale?**
>
> - **Yes** — Issue credit note (full or partial). GST will be reversed. Recipient may need to reverse ITC.
> - **No** — Goodwill wallet credit. No GST impact. Money refunded as wallet balance.

If "Yes" but the time-bar has lapsed, the UI auto-routes to "No" with an explanation that the credit note cannot be issued (see `CREDIT_NOTE_TIME_BAR_POLICY.md`).

## 4. `wallet_adjustments` schema

```
wallet_adjustments
├── id
├── customerId
├── sourceType GOODWILL | SUPPORT_ADJUSTMENT | DISPUTE_GOODWILL | TIME_BARRED_RETURN | PROMO_CREDIT | MANUAL
├── sourceId           (e.g. ticket id, dispute id, return id)
├── amountInPaise
├── currencyCode INR
├── reason             (free text)
├── glAccountCode      (CA-provided; e.g. "EXP-GOODWILL-001")
├── approvedBy
├── status PENDING | APPROVED | CREDITED | REJECTED
├── walletTransactionId
├── createdAt
└── updatedAt
```

Wallet transactions created from these rows are flagged on the existing `WalletTransaction` model with `referenceType = 'WALLET_ADJUSTMENT'`. The wallet idempotency `@@unique([referenceType, referenceId, type])` UNIQUE applies — a single goodwill adjustment can never create two wallet credits.

## 5. Audit + reporting

Every wallet adjustment writes:
- `wallet.adjustment.created` event
- `wallet.adjustment.approved` event (if approval required by amount threshold)

Monthly finance report: "Goodwill expense by GL code, by source type, by approver."

## 6. Permissions

- `wallet.adjustment.create` — create a wallet adjustment (low-value, single-tier)
- `wallet.adjustment.approve` — approve adjustments above amount threshold (CA-configurable, default ₹5,000)
- `wallet.adjustment.read` — view list + reports

## 7. Threshold for approval gate

Default: any wallet adjustment > ₹5,000 requires a second admin to approve. Configurable in `tax_config.goodwill_approval_threshold_paise`.

The amount is total wallet adjustment per customer per 24-hour rolling window (to prevent layered small adjustments that bypass the gate).

## 8. Customer-facing message

- Credit note: "Credit note generated for your return. GST has been reversed. PDF available for download."
- Goodwill: "Goodwill credit of ₹X added to your wallet. Use on your next purchase."
- Time-barred (auto-routed to goodwill): "Refund processed. GST adjustment is not available for this return due to statutory reporting timelines."

## 9. CA actions required

1. Confirm GL account codes for each `sourceType` (engineering needs the chart-of-accounts mapping).
2. Confirm the ₹5,000 approval threshold (lower or higher).
3. Confirm reporting cadence (monthly default).
4. Confirm whether goodwill ever needs to be filed in GSTR-1 (typically no — but some interpretations require it under specific HSN codes).

---

**Related:** `GST_ASSUMPTIONS.md` §13 row "Goodwill GL code"; `CREDIT_NOTE_TIME_BAR_POLICY.md`; `CA.md` §3 item 4.
