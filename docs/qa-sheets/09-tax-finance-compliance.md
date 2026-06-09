# Test Sheet — Tax / Finance-Compliance Ops

**App:** `web-admin-storefront`  **Port:** 4000 (api 8000)  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Tax mode toggle (OFF/AUDIT/STRICT) + history ⚠ | `/dashboard/tax/mode (also inline on /dashboard/tax)` | Mode persists across refresh; each change appends an audit row (action=TAX_MODE_CHANGED) visible in the history table; STRICT is rejected with a clear blocker message when readiness is not clear. | ☐ | |
| 02 | Audit-readiness dashboard scans + STRICT export gate ⚠ | `/dashboard/tax` | Dashboard shows real per-check counts with sample IDs; in STRICT mode a CSV/JSON export is BLOCKED (HTTP 422/403-style error) unless acknowledgeBlockers=true is sent and the operator holds tax.reports.overrideBlockers. | ☐ | |
| 03 | E-invoice (IRN) generate / view / cancel ⚠ | `/dashboard/tax/einvoices` | IRN mints instantly; GENERATED rows show IRN/ack/cancel-window; cancel within 24h succeeds; past 24h is correctly gated to a Credit Note path; the printed invoice shows the e-invoice/IRN block for GENERATED documents. | ☐ | |
| 04 | E-way-bill generate / view / cancel / override ⚠ | `/dashboard/tax/eway-bills` | EWB generates with a number + validity; cancel and admin-override both update the row and the ship-guard; overrides are audit-stamped with the admin id/reason. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | GSTR-1 export (per-seller §4 B2B + section CSV) ⚠ | `/dashboard/tax (Filings → GSTR-1 / GSTR-3B card)` | Per-section CSVs download with the correct official column headers and per-invoice/aggregated rows for the chosen seller+period; an invalid/empty seller or period disables the buttons. | ☐ | |
| 12 | GSTR-3B export (per-seller summary) ⚠ | `/dashboard/tax (Filings → GSTR-1 / GSTR-3B card)` | GSTR-3B CSV downloads with the consolidated §3.1 / §3.2 outward-supply summary for the seller+period; zero/negative values are clamped with a warning rather than producing garbage. | ☐ | |
| 13 | GSTR-8 / TCS lifecycle (load → file → pay → certify → reverse + CSV/JSON) ⚠ | `/dashboard/tax#gstr8 (Filings → GSTR-8 card)` | Status flows COMPUTED→FILED→PAID_TO_GOVT→CERTIFICATE_ISSUED; ARN required to file; CIN/UTR required to pay; skipped (wrong-state) rows are listed; CSV and JSON download with the official GSTR-8 columns; | ☐ | |
| 14 | Credit-note register + partial-coverage flags ⚠ | `/dashboard/tax/credit-notes` | All §34 credit notes for the filter are listed with correct money amounts and status; partial-coverage CNs are flagged; customer-notified state is visible. | ☐ | |
| 15 | Seller-GSTIN verification decision (+ 194-O exemption) ⚠ | `/dashboard/tax/seller-gstins` | Verify stamps isVerified + provider/status/notes (or flags a mismatch without marking verified); the dashboard's seller.missing_gstin / legal_name_mismatch blockers reflect the result; | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | §194-O TDS (Form 26Q deposit + Form 16A) lifecycle ⚠ | `/dashboard/tax/tds194o` | TDS rows progress withheld→deposited→certificate-issued; Form 26Q CSV and per-recipient Form 16A download; affiliate-facing Form 16A unlocks only after the certificate is issued. | ☐ | |
| 22 | HSN / UQC master management | `/dashboard/tax/hsn-master and /dashboard/tax/uqc-master` | HSN/UQC rows create/edit/activate with optimistic-concurrency (expectedVersion) and audit history; effective-dated rate changes apply at invoice time; masters drive the product attestation gate. | ☐ | |
| 23 | Platform-GST profile config (default + activate/deactivate) | `/dashboard/tax/platform-gst` | Set-default and deactivate both require a reason and are audited; the default profile cannot be deactivated; a single DB-enforced default remains; | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Tax mode toggle (OFF/AUDIT/STRICT) + history** — TAX_STRICT_MODE defaults to false; a fresh dev DB usually reads OFF or AUDIT. STRICT flip only succeeds when readiness shows zero blockers (or force) — in dev with seeded gaps a 409 is the correct, expected outcome, not a bug.
- **02 Audit-readiness dashboard scans + STRICT export gate** — Scanners read live seed data, so counts are nonzero in dev (missing HSN/UQC/GSTIN are normal). The STRICT-export gate only bites when mode is STRICT; in the default OFF/AUDIT dev posture exports always download — that is correct.
- **03 E-invoice (IRN) generate / view / cancel** — EINVOICE_PROVIDER defaults to stub: IRNs are DETERMINISTIC 64-char hex per (supplier, document, date), not real NIC IRP IRNs. A stub IRN/QR is the expected dev output — do not flag it as fake. Real NIC needs EINVOICE_PROVIDER=nic + adapter.
- **04 E-way-bill generate / view / cancel / override** — EWAY_BILL_PROVIDER defaults to stub: numbers are EWB-STUB-<uuid> placeholders, not real NIC e-Waybills. Stub EWBs are the expected dev output. Override is a deliberate break-glass path, not an error.
- **11 GSTR-1 export (per-seller §4 B2B + section CSV)** — IRN/IRN-date columns will be NULL/blank because EINVOICE_PROVIDER=stub. §6 Exports / §8 Nil-rated sections may be empty where supplyTaxability isn't populated on older seed data.
- **12 GSTR-3B export (per-seller summary)** — GSTR-3B is outward-only by design; §4 ITC / §5 / §6.x inward sections are intentionally blank with a disclaimer (no seller purchase data on the platform). Same stub-IRN caveat as GSTR-1.
- **13 GSTR-8 / TCS lifecycle (load → file → pay → certify → reverse + CSV/JSON)** — ARN/CIN are operator-entered free text in dev (no NIC validation). The operator GSTIN on the JSON is resolved server-side from the default PlatformGstProfile — if none is set, expect a readiness blocker (platform.gst_profile_missing).
- **14 Credit-note register + partial-coverage flags** — Credit notes are GENERATED by the return/QC + STRICT-snapshot flow, not minted from this register page (read-only). Legacy orders missing a tax snapshot show PARTIAL coverage by design.
- **15 Seller-GSTIN verification decision (+ 194-O exemption)** — GSTN_PROVIDER defaults to stub: verification is a local Mod-36 checksum (well-formed GSTIN passes), NOT a real GSTN-portal lookup. A 'verified' stub result is expected dev behavior; legal-name match is fuzzy. STRICT mode hard-gates checkout on unverified seller GSTINs.
- **21 §194-O TDS (Form 26Q deposit + Form 16A) lifecycle** — §194-O determination + historical 10% correction are pending finance/legal sign-off (config-default section). Challan refs are operator-entered; no real TIN-Protean submission in dev.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 4 | | | | |
| P1 | 5 | | | | |
| P2 | 3 | | | | |
| **All** | **12** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
