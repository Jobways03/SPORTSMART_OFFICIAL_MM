# GST_ASSUMPTIONS.md — Running Decision Log

**Purpose:** Single, authoritative record of every CA-bound decision made (or pending) for the Sportsmart GST system. CA fills the **Decision** column on return; engineering treats this file as source-of-truth for behaviour.

**Convention:** Each row has — **Assumption** (what engineering picked) → **Decision** (CA's final answer, written here on review). Until **Decision** is filled, engineering treats **Assumption** as truth and may have built the corresponding code path against it.

---

## 1. Business / entity facts (CA fills before strict-mode flip)

| Item | Engineering assumption | CA decision (fill in) | Effective from |
|---|---|---|---|
| Sportsmart entity legal name | "Sportsmart Marketplace Pvt Ltd" (placeholder) | | |
| Sportsmart aggregate annual turnover (AATO) tier | Unknown — defaults to "between ₹5 cr and ₹10 cr" for HSN-tier purposes | | |
| Sportsmart entity PAN | (placeholder `AAAAA0000A`) | | |
| Sportsmart primary GSTIN | (placeholder `36AAAAA0000AZZZ`) — state code 36 = Telangana | | |
| Sportsmart additional state-wise GSTINs | None today | | |
| HSN length tier required on invoices | 6 digits (matches "₹5 cr – ₹10 cr" tier assumption) | | |
| Financial-year format | `YYYY-YY` (Apr–Mar) | | |
| Tax-display timezone | Asia/Kolkata (IST) | | |
| Currency on invoices | INR (always) | | |

---

## 2. Engine + tax rule decisions

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Default GST rate when product HSN/rate missing (TEST MODE ONLY) | 1800 bps (18%) | | |
| Default rate fallback in STRICT MODE | 0 bps — checkout blocks for `supplyTaxability=TAXABLE` | | |
| Rounding strategy | BigInt floor per component; SGST derived as `expectedTotalTax − CGST` to preserve invariant | | |
| Conservation invariants | `cgst+sgst+igst === totalTax`, `taxable+totalTax === lineTotal` | | |
| Discount-vs-GST order | Discount applied **before** GST (Section 15 — pre-supply transactional) | | |
| Discount tax treatment defaults | Customer-facing coupons → `PRE_SUPPLY_TRANSACTIONAL`; MRP slash → `DISPLAY_ONLY`; ad-hoc admin write-off → `POST_SUPPLY_UNLINKED` | | |
| GST-inclusive vs exclusive product pricing | **Inclusive** by default for B2C catalog (CBIC convention); admin can flip per product | | |
| Cess rate default | 0 bps (no cess on sports goods today) | | |

---

## 3. Place-of-supply decisions

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| B2C delivery — POS source | Customer shipping address state | | |
| B2B with customer GSTIN — POS source | Customer shipping address state (not GSTIN/billing state) | | |
| Seller-marketplace supplier state | Seller's primary GSTIN state | | |
| Franchise-fulfilled supplier state | Franchise's GSTIN state | | |
| OWN_BRAND supplier state | `platform_gst_profiles.gstStateCode` (default = Sportsmart primary state) | | |
| Customer state-resolution source | Pincode → state lookup from `PostOffice` table (165k entries) + manual override | | |
| Missing supplier/customer state | Test mode: warn, allow; Strict mode: block | | |

---

## 4. Shipping GST

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Shipping SAC code | `9968` (Postal and courier services) | | |
| Shipping GST rate | 1800 bps (18%) | | |
| Shipping price inclusive of GST? | No — shipping fee is exclusive; tax added on top | | |
| Shipping POS rule | Follows product line POS | | |
| Free shipping → taxable shipping value | 0 (taxable + tax both zero) | | |
| Shipping refund on customer-cancelled order (pre-ship) | Refunded with GST reversed | | |
| Shipping refund on return | NOT refunded by default; CA-configurable | | |
| Convenience / COD / gift-wrap fees | Separate tax lines; default SAC `9985` (other support services); 18% | | |

---

## 5. Document types + numbering

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Tax Invoice format | `SM-INV-{seq:06d}` per (gstin, FY) | | |
| Bill of Supply format | `SM-BOS-{seq:06d}` per (gstin, FY) | | |
| Credit Note format | `SM-CN-{seq:06d}` per (gstin, FY) | | |
| Debit Note format | `SM-DN-{seq:06d}` per (gstin, FY) | | |
| Legacy Receipt format | `SM-LR-{seq:06d}` per FY (no GSTIN, platform-wide) | | |
| Document number max length | 16 chars per GST rule | | |
| Document char set | `[A-Z0-9/-]` only | | |
| Sequence safety | Postgres serializable lock on `document_sequences` per (gstin, FY, documentType) | | |
| Number reuse on cancellation | Forbidden — cancelled numbers tracked in `document_sequences.skippedNumbers` | | |

---

## 6. Credit notes + Section 34

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Credit note time-bar | 30 September of FY following the FY of supply | | |
| Time-bar enforcement | Hard block in strict mode + AdminTask `GST_CREDIT_NOTE_TIME_BARRED` | | |
| Customer-facing message when time-barred | "Refund processed. GST adjustment is not available for this return due to statutory reporting timelines." | | |
| Cron cadence | `tax_credit_note_timebar_checker` — daily, 02:30 IST | | |
| Linked credit-note recipient ITC reversal notice | "Recipient may need to reverse input tax credit per Section 16(2)" | | |
| Goodwill credit (no taxable-value change) | NEVER goes through credit note — uses `wallet_adjustments` instead | | |
| Partial return conservation | Sum of credit-note reversals ≤ original invoice tax; enforced by service-level check | | |

---

## 7. TCS + GSTR-8

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| TCS rate | 100 bps (1%) per current Section 52 notification | | |
| TCS intra-state split | CGST TCS 50 bps + SGST TCS 50 bps | | |
| TCS inter-state | IGST TCS 100 bps | | |
| TCS computation timing | At settlement run (per Section 52 — at credit to seller's account) | | |
| TCS basis | Net taxable supplies = gross supplies − returns − exempt − non-GST, by filing period | | |
| TCS applicability — OWN_BRAND | Excluded (Sportsmart is itself the supplier) | | |
| TCS applicability — MARKETPLACE_SELLER | Included | | |
| TCS applicability — FRANCHISE | Included | | |
| Filing period | Calendar month | | |
| GSTR-8 export format | CSV first; JSON-for-NIC-portal later | | |
| GSTR-8 due date | 10th of next month (informational only — engineering doesn't auto-file) | | |

---

## 8. E-way bills

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Threshold | ₹50,000 single-national (most-states default) | | |
| Per-state override capability | Available in `tax_config.eway_bill_thresholds` JSON | | |
| Generation timing | Before dispatch | | |
| Adapter (current) | Stub — logs payload, returns placeholder EWB number `EWB-STUB-{uuid}` | | |
| Adapter (future) | NIC e-Waybill API; not yet integrated | | |
| Ship-block on missing | Strict mode: yes; Test mode: warning only | | |
| Validity (km → days) | Standard NIC slabs (≤100 km = 1 day, +200 km/day) | | |
| Failure handling | AdminTask `EWAY_BILL_GENERATION_FAILED` + retry cron | | |

---

## 9. E-invoicing (IRN / QR)

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Applicable to Sportsmart? | Pending CA — depends on AATO | | |
| Threshold (current CBIC notification) | ₹5 cr AATO for B2B invoices | | |
| Schema readiness | Fields ready: `irn`, `ackNo`, `ackDate`, `signedDocumentJson`, `qrCodeUrl`, `einvoiceStatus` | | |
| Integration status | Not started (`EINVOICE_ENABLED=false`) | | |
| IRP cancellation window | 24 hours from IRN generation (per CBIC) | | |
| Post-window correction | Credit note / Debit note (no in-place cancellation) | | |
| B2C invoices | Not subject to IRN (only B2B), but QR code may apply for B2C above future threshold | | |

---

## 10. Retention + erasure

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Retention period for tax documents | 72 months from end of FY (Section 36 minimum) | | |
| Retention period for PDFs | 72 months | | |
| Retention period for ledgers (collection + TCS) | 72 months | | |
| Retention period for e-way bills | 72 months | | |
| Retention period for wallet_adjustments (non-tax goodwill) | 24 months | | |
| Erasure-request behaviour | Tax records excluded from delete; anonymisation allowed only where legally permissible | | |
| Audit-trail retention | Tax-related audit-log entries retained 72 months | | |

---

## 11. Composition / unregistered sellers

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Composition sellers allowed on marketplace? | Yes; `gstRegistrationType = COMPOSITION` issues Bill of Supply, no GST collected | | |
| Composition footer text | "Composition Taxable Person, not eligible to collect tax on supplies" (per Rule 49 wording — verify) | | |
| Unregistered sellers allowed on marketplace? | No taxable supply allowed; admin override possible (audited) | | |
| Composition seller turnover monitoring | Out of scope — seller's own GST obligation | | |

---

## 12. Customer GSTIN handling

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Mandatory for any order class? | No — optional; B2C is default | | |
| Format verification | Regex + checksum (Mod 36) — automatic | | |
| Portal-API lookup verification | Available but not enabled by default (cost per call) | | |
| Admin manual verification | Available in admin UI; verifier identity audited | | |
| Customer-supplied wrong GSTIN | Format check rejects malformed; valid-format-but-wrong-business is admin manual escalation | | |
| Multi-GSTIN per customer? | One default; up to 5 stored per customer for B2B convenience | | |

---

## 13. Operational defaults

| Item | Engineering assumption | CA decision | Effective from |
|---|---|---|---|
| Invoice generated when (prepaid order) | After `paymentStatus=PAID` AND `subOrder.acceptStatus=ACCEPTED` | | |
| Invoice generated when (COD order) | At `subOrder.fulfillmentStatus=PACKED` (just before ship) | | |
| Legacy order cutoff | Currently `null` — set on strict-mode flip | | |
| PDF re-download watermark | "DUPLICATE COPY" on all renders after first download | | |
| PDF download URL TTL | 600s (10 min) per signed URL | | |
| Email-link TTL | 7 days; expired links → user logs in + downloads from order page | | |
| Tax-data-incomplete behaviour in strict mode | Block checkout with friendly message: "We're verifying tax details for this order — please try again in a few minutes." | | |

---

## 14. Items deferred to post-strict-mode

The following are acknowledged gaps that engineering will NOT block strict-mode flip on:

- Real NIC e-waybill / IRP / GST portal integration (stubs sufficient for now).
- GST input credit on platform's own purchases (out of scope — BAU CA work).
- Stock transfer / branch transfer flows (current OWN_BRAND single-warehouse model).
- Section 9(5) services (Sportsmart is goods-only).
- Compensation cess (no current sports HSN attracts cess).
- Reverse charge for unregistered suppliers buying from Sportsmart (rare; admin manual flag).

---

## 15. Sign-off

When CA has filled every "Decision" column above:

- [ ] CA reviewer: ______________
- [ ] Date: ______________
- [ ] Approved for `TAX_STRICT_MODE=true` flip in staging: YES / NO
- [ ] Approved for `TAX_STRICT_MODE=true` flip in production: YES / NO
- [ ] Engineering action item: update `CA.md` §A phase log with "Strict mode flipped on <date>"
