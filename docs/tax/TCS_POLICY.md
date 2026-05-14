# TCS_POLICY.md

**Purpose:** Define Tax Collection at Source (Section 52, CGST Act) behaviour for Sportsmart marketplace operator.

---

## 1. What TCS is

Section 52 requires an e-commerce operator (Sportsmart) to **collect TCS on the net value of taxable supplies** made by other suppliers (marketplace sellers, franchises) **at the time of crediting their account**. The operator remits TCS to the government via **GSTR-8**, monthly.

TCS is **NOT** charged to the customer. It is **deducted from the seller's payable amount** at settlement.

## 2. Scope (who is in / out)

| Supplier type | TCS applies? | Reason |
|---|---|---|
| `MARKETPLACE_SELLER` | YES | Third-party seller; Sportsmart collects on their behalf |
| `FRANCHISE` | YES | Same — franchise is a third party for TCS purposes |
| `OWN_BRAND` | NO | Sportsmart is itself the supplier; not collecting from a third party |
| `SPORTSMART` (platform direct) | NO | Same as own-brand |

**CA must confirm** the OWN_BRAND/SPORTSMART exclusion — depends on legal entity structure.

## 3. Rate

Per current Section 52 notification:
- Intra-state supply: **0.5% CGST + 0.5% SGST = 1% total** (100 bps)
- Inter-state supply: **1% IGST** (100 bps)

Rate is stored historically per ledger row (`gst_tcs_settlement_ledger.tcsRateBps`) so future rate changes don't rewrite history.

## 4. Computation timing

```
Customer places order
    ↓
Invoice issued — `gst_collection_ledger` row written (accrual; not TCS yet)
    ↓
If return: credit note adjusts the collection ledger
    ↓
Settlement run computes net taxable supplies for the filing period
    ↓
At settlement run AND seller's net payable > 0:
    `gst_tcs_settlement_ledger` row written with status = COMPUTED
    ↓
Settlement deducts TCS amount from seller's payout
    Status → COLLECTED
    ↓
GSTR-8 export aggregates rows by filing period
    Status → FILED
    ↓
After GST remittance to govt:
    Status → PAID_TO_GOVT
```

**The critical rule:** TCS is computed at the **settlement run**, not at invoice issuance. Two reasons:
1. Section 52 specifies "at the time of crediting the amount in the account of the supplier" — that's settlement, not invoice.
2. Returns during the same filing period must reduce the TCS base; pre-computing at invoice over-collects.

## 5. Net taxable supplies formula

For seller `S` in filing period `P`:

```
gross_taxable_supply = sum of gst_collection_ledger.taxableSupplyValueInPaise where
                        supplierId = S AND
                        filingPeriod = P AND
                        documentType IN (TAX_INVOICE, INVOICE_CUM_BILL_OF_SUPPLY)

credit_note_taxable_reversal = sum of gst_collection_ledger.creditNoteTaxableReversalInPaise where
                                 supplierId = S AND
                                 filingPeriod = P AND
                                 documentType = CREDIT_NOTE

net_taxable_supply = gross_taxable_supply − credit_note_taxable_reversal
                    (clamped at zero — never negative TCS)
```

Then TCS:
```
if intra_state:
  cgst_tcs = floor(net_taxable_supply × 50 / 10000)
  sgst_tcs = floor(net_taxable_supply × 50 / 10000)
  igst_tcs = 0
else:
  cgst_tcs = 0
  sgst_tcs = 0
  igst_tcs = floor(net_taxable_supply × 100 / 10000)

total_tcs = cgst_tcs + sgst_tcs + igst_tcs
```

## 6. Cross-filing-period handling

A return in one filing period that reverses an invoice from an earlier period:
- Adjusts the **return's filing period** TCS, not the original invoice's filing period.
- If the return reversal exceeds gross taxable supply in the return's filing period → result is **negative net taxable supply**, but TCS clamps at zero. The excess is **carried forward** to the next filing period via `gst_tcs_settlement_ledger.adjustmentCarriedForwardInPaise`.

**CA must confirm** this carry-forward approach matches their preferred GSTR-8 filing convention.

## 7. GSTR-8 export format

CSV columns (matches CBIC GSTR-8 schema):
- GSTIN of supplier
- Trade name
- Gross supply value
- Returns / credit note adjustments
- Net taxable supply
- CGST TCS
- SGST TCS
- IGST TCS
- Total TCS
- Filing period (YYYY-MM)

JSON export (NIC portal upload) — schema fields ready; conversion service stub at `apps/api/src/integrations/gstn-portal/gstr8-payload.builder.ts`.

## 8. Refund of TCS to seller (rare)

If a seller's GSTR-2A shows TCS credit from Sportsmart that they cannot fully utilise, they may apply for refund directly with the government. Sportsmart's responsibility ends at correct GSTR-8 filing.

The seller settlement UI surfaces "TCS collected this cycle: ₹X" so sellers can reconcile against their GSTR-2A.

## 9. Audit trail

Every TCS ledger write generates:
- `tax.tcs_ledger.created` audit event
- `gst_tcs_settlement_ledger.computedAt + computedBy + computedReason`

Adjustments after filing (rare — typically only via finance correction):
- `tax.tcs_ledger.adjusted` audit event
- Original row never deleted; correction is a new row with `correctionOfId` pointing to the original

## 10. Permissions

- `tax.tcs.read` — view TCS ledger + GSTR-8 reports
- `tax.tcs.compute` — manually trigger TCS computation (normally automatic at settlement)
- `tax.tcs.export` — generate GSTR-8 CSV/JSON
- `tax.tcs.mark-filed` — mark TCS rows as FILED (post GSTR-8 submission)
- `tax.tcs.mark-paid-to-govt` — mark TCS rows as PAID_TO_GOVT (post remittance)

## 11. CA actions required

1. Confirm OWN_BRAND/SPORTSMART exclusion is correct for Sportsmart's legal entity structure.
2. Confirm 1% rate is current at the time of strict-mode flip.
3. Confirm cross-period carry-forward approach for net-negative supply situations.
4. Confirm GSTR-8 due date (10th of next month by default).
5. Confirm CSV column ordering against CBIC current template.
6. Confirm whether Sportsmart needs to file GSTR-8 even in months with zero TCS (NIL filing typically required).

---

**Related:** `GST_ASSUMPTIONS.md` §7; `CA.md` §3 item 11, §6.3.
