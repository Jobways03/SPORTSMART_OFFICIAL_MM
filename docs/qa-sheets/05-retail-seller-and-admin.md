# Test Sheet — Retail Seller + Retail Seller-Admin

**App:** `web-retail-seller (portal), web-retail-seller-admin (admin)`  **Port:** 4009 (seller portal), 4008 (seller-admin)  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Seller register + email-OTP verify (RETAIL parity with D2C) ⚠ | `http://localhost:4009/register` | Account is created as a RETAIL seller (X-Seller-Type:RETAIL on every request, SELLER_TYPE in body); verify page accepts the OTP and marks email verified. | ☐ | |
| 02 | Seller KYC onboarding wizard (email -> KYC submit -> await admin) ⚠ | `http://localhost:4009/dashboard/onboarding` | Client-side validation blocks bad GSTIN/PAN/pincode; on submit verificationStatus -> UNDER_REVIEW and the blue banner warns GST fields are admin-verified before invoices use them (DRAFT-not-for-ITC until verified). | ☐ | |
| 03 | Seller catalog mapping + product create/submit (parity with D2C) ⚠ | `http://localhost:4009/dashboard/catalog` | A new seller catalog mapping is created in PENDING state; a submitted product moves to SUBMITTED/PENDING moderation. Neither is sellable until the RETAIL admin approves. | ☐ | |
| 04 | Seller accept/ship sub-orders + reject (parity) | `http://localhost:4009/dashboard/orders` | Accept transitions the sub-order and persists after the refetch (no 'click didn't take' regression); Reject releases the line for reallocation to another node. | ☐ | |
| 05 | ADMIN: RETAIL scope isolation (must NOT see D2C sellers) ⚠ | `http://localhost:4008/dashboard/sellers` | The list contains zero D2C sellers; directly navigating to a D2C seller/order/return returns 404 (Seller not found) — never a 403 and never the D2C record — so the RETAIL admin cannot even confirm a D2C entity exists. | ☐ | |
| 06 | ADMIN: seller management — status, KYC decision, message, impersonate ⚠ | `http://localhost:4008/dashboard/sellers/[sellerId]` | Verification -> VERIFIED + status ACTIVE unblocks the seller (onboarding redirects to first-listing); REJECTED surfaces the reason in the seller's onboarding wizard. | ☐ | |
| 07 | ADMIN: product approval + seller-mapping approve/stop + tax-config verify | `http://localhost:4008/dashboard/products` | Approve flips product status to APPROVED/ACTIVE and the mapping to APPROVED (sellable). Reject/Request-changes returns it to the seller with the reason. Tax verify clears the 'Tax: unverified' pill. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Seller returns handling (respond / mark-received / QC evidence) | `http://localhost:4009/dashboard/returns` | Seller can move the return through its seller-side states and attach QC evidence; QC_REJECTED is a visible terminal-ish state. | ☐ | |
| 12 | Seller finances / payouts (read-only parity) | `http://localhost:4009/dashboard/accounts` | KPIs render: gross revenue, commission deducted, statutory deductions (TCS/TDS), pending/overdue payable, and a paged settlement list. | ☐ | |
| 13 | ADMIN: order risk-verification queue (claim -> approve/reject) | `http://localhost:4008/dashboard/verification` | Approve releases the order to seller routing; Reject cancels and restocks. Orders that fail allocation post-approval (e.g. unserviceable address) are auto-released back to the queue and listed under the action. | ☐ | |
| 14 | ADMIN: returns oversight + refund lifecycle ⚠ | `http://localhost:4008/dashboard/returns` | Each transition advances the return FSM; Initiate+Confirm refund moves money back to the customer (online) or queues a wallet/COD remedy; Mark-failed -> Retry path works. | ☐ | |
| 15 | ADMIN: commission config + settlement cycles (mark-paid) ⚠ | `http://localhost:4008/dashboard/commission` | Adjustments are audited with history; a cycle previews seller-breakdown totals; mark-paid records the UTR and flips the settlement to PAID atomically (CAS, no double-pay). | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | ADMIN: inventory oversight (overview / low-stock / out-of-stock / reservations) | `http://localhost:4008/dashboard/inventory` | Aggregated stock/available/reserved counts render; low/out lists match the threshold logic; reservations show order-linked holds. | ☐ | |
| 22 | ADMIN: routing diagnostics (health snapshot + dry-run preview) | `http://localhost:4008/dashboard/routing` | Health KPIs render and auto-refresh; preview returns per-item serviceable/unserviceable/error with a primary node + ranked alternates (score, distance, available stock, reasons) WITHOUT committing any order. | ☐ | |
| 23 | ADMIN: accounts dashboards + settlement preview/reports | `http://localhost:4008/dashboard/accounts` | Outstanding payables, top performers, and per-seller balances render; settlement preview shows what each seller is owed for the cycle; reconciliation report balances. | ☐ | |
| 24 | ADMIN: storefront curation (feature/arrange catalog products) | `http://localhost:4008/dashboard/storefront` | Featured/arranged products persist and surface on the customer storefront. | ☐ | |
| 25 | ADMIN: Delhivery ops tools (serviceability / cost / TAT / label / RTO) ⚠ | `http://localhost:4008/dashboard/delhivery-tools` | Read-only checks (serviceability/cost/TAT) return live-shaped quotes; mutating actions (label, e-waybill, RTO) change the carrier shipment + sub-order shipping status. | ☐ | |
| 26 | ADMIN: franchise linkage oversight (catalog/orders/finance/settlements) ⚠ | `http://localhost:4008/dashboard/franchises` | Franchise mappings/orders/finance are visible and actionable; settlement approve->pay records the disbursal; ledger and inventory tie out. | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Seller register + email-OTP verify (RETAIL parity with D2C)** — Email OTP delivery is a dev stub — read the code from API logs, not a real inbox. Captcha defaults to disabled in dev.
- **02 Seller KYC onboarding wizard (email -> KYC submit -> await admin)** — GSTIN is validated by regex/PAN-cross-check only; live GSTN portal verification is a stub. No KYC document upload sub-system exists (deferred).
- **03 Seller catalog mapping + product create/submit (parity with D2C)** — RETAIL admin only sees this seller's mappings because it is a RETAIL seller — a D2C admin would not see it.
- **05 ADMIN: RETAIL scope isolation (must NOT see D2C sellers)** — Scope only bites when the admin role actually holds `sellers.scope.retail`. A default/unscoped admin sees all seller types — pick the right role to exercise the boundary.
- **06 ADMIN: seller management — status, KYC decision, message, impersonate** — Outbound notification email/SMS on status/message is a dev stub. Impersonation token is real.
- **14 ADMIN: returns oversight + refund lifecycle** — Razorpay refund execution is gateway-stubbed in dev; 'Confirm refund' may rely on a simulated gateway callback rather than a live webhook.
- **15 ADMIN: commission config + settlement cycles (mark-paid)** — Bank/payout disbursal keys are stubbed in dev — mark-paid records the UTR but does not move real money.
- **25 ADMIN: Delhivery ops tools (serviceability / cost / TAT / label / RTO)** — Delhivery is the carrier skeleton with SELF_DELIVERY as the only live DeliveryMethod (iThink removed). Delhivery webhook callbacks are stubbed in dev — status transitions may need manual triggering rather than real carrier pushes.
- **26 ADMIN: franchise linkage oversight (catalog/orders/finance/settlements)** — Franchises are a separate node type from RETAIL sellers; not in the primary sidebar nav (reached via context). Payout disbursal stubbed.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 7 | | | | |
| P1 | 5 | | | | |
| P2 | 6 | | | | |
| **All** | **18** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
