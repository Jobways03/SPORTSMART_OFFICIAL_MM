# Test Sheet — Franchise Operator (POS)

**App:** `web-franchise`  **Port:** 4004  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Franchise registration + email OTP verification | `/register` | Register returns a uniform 'requiresVerification' response (same on duplicate email/phone — no account-existence leak). Verify-email succeeds and shows 'Email verified! Sending you to sign in'. | ☐ | |
| 02 | Login (verified + approval gating) | `/login` | Approved+verified account: tokens stored in sessionStorage and redirect to /dashboard. Unverified: 403 EMAIL_NOT_VERIFIED with an inline resend hint. | ☐ | |
| 03 | Catalog mapping (which products this franchise can sell — the POS gate) ⚠ | `/dashboard/catalog` | Adding a mapping creates it in PENDING. Already-mapped variants are pre-disabled in the add modal. Only after admin sets approvalStatus=APPROVED and isActive=true does the product become usable in POS and procurement. | ☐ | |
| 04 | POS sale (add items, payment method, complete sale -> atomic stock deduct + receipt) ⚠ | `/dashboard/pos` | POST /franchise/pos/sales records the sale and deducts onHandQty ATOMICALLY in one DB transaction (under FOR UPDATE lock — no oversell). Net = subtotal - line discounts, clamped >= 0. | ☐ | |
| 05 | POS return (cumulative-guarded, refund, saleable vs damaged routing) | `/dashboard/pos` | POST /franchise/pos/sales/{id}/return refunds net-per-unit (lineTotal/qty, GST-inclusive) and restocks: SALEABLE -> onHandQty, DAMAGED -> damagedQty. Sale becomes PARTIALLY_RETURNED or RETURNED. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | KYC onboarding (GSTIN/PAN submission + admin decision) | `/dashboard/onboarding` | POST /franchise/onboarding/submit cross-validates GSTIN[0:2]==state code and GSTIN[2:12]==PAN. Success shows 'KYC submitted, we will email you'; profile flips to UNDER_REVIEW (form becomes read-only). | ☐ | |
| 12 | Staff management (add staff, assign role, deactivate) | `/dashboard/staff` | New staff appears in the table; KPI counters (Active Staff / Managers / POS Operators / Warehouse) increment. Deactivate flips status to Inactive and the member can no longer access the dashboard. | ☐ | |
| 13 | POS void (full reversal within void window -> restock) | `/dashboard/pos` | POST /franchise/pos/sales/{id}/void flips status to VOIDED and restores every line's outstanding qty (quantity - alreadyReturned) back to onHandQty in one transaction. A POS_VOID inventory movement is written. | ☐ | |
| 14 | POS daily report + cash reconciliation / day-closure | `/dashboard/pos` | GET /franchise/pos/reconciliation returns net-of-refunds revenue (netAmount - refunded), void/return counts, GST breakdown, and a server-computed expectedCashInPaise. | ☐ | |
| 15 | Inventory: stock view, adjustments, low-stock, damage | `/dashboard/inventory` | POST /franchise/inventory/adjust changes the relevant quantity bucket (DAMAGE moves to damagedQty) and writes an immutable inventory ledger entry with beforeQty/afterQty, movementType, actor, and reason. | ☐ | |
| 16 | Inventory ledger (audit trail / cross-screen reflection) | `/dashboard/ledger` | GET /franchise/inventory/ledger returns one row per stock movement (SALE, POS_VOID, RETURN_RESTOCK, DAMAGE, PROCUREMENT_RECEIPT, ADJUSTMENT) with quantityDelta and before/after snapshots. | ☐ | |
| 17 | Procurement REQUEST flow (draft -> submit -> track approval -> receive) ⚠ | `/dashboard/procurement/new` | Submit moves the request through the 11-state FSM. Admin sets approved qty + landed cost + procurement fee at approval (these are em-dash/null until then). | ☐ | |
| 18 | Earnings summary + settlement statement (nets returns) | `/dashboard/earnings` | Settlement net = grossFranchiseEarning - reversalAmount + adjustmentAmount; gross counts sales rows only (POS + online), and RETURN_REVERSAL rows subtract — returns are NOT double-counted. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Commission view | `/dashboard/commission` | Commission screen reflects the configured commission rate and the platform/online-commission split that the earnings ledger and settlements are derived from. | ☐ | |
| 22 | Tax invoices | `/dashboard/tax/invoices` | Each invoice shows the Section 31 CGST Act required breakdown (HSN per line, CGST/SGST for intra-state, IGST=0), taxable value, and total GST consistent with the originating POS/online sale. | ☐ | |
| 23 | Profile / accounts / support / forgot-reset password (config + ancillary) | `/dashboard/profile` | Profile reflects KYC/verification status. Support ticket creation persists and is viewable in the thread. Forgot-password issues an OTP, verify-reset-otp returns a resetToken, and reset-password sets the new password. | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **03 Catalog mapping (which products this franchise can sell — the POS gate)** — Mapping approval is an ADMIN action — a fresh franchise self-mapping stays PENDING and is unsellable until the admin side approves it. Seed at least one APPROVED+active mapping before testing POS/procurement.
- **04 POS sale (add items, payment method, complete sale -> atomic stock deduct + receipt)** — Requires an APPROVED + active catalog mapping (backend findApprovedActiveByFranchiseAndProduct gate) AND non-zero on-hand stock — seed stock via procurement-receive or an inventory adjustment first. Staff attribution currently uses the franchise principal until a per-cashier staff JWT lands.
- **17 Procurement REQUEST flow (draft -> submit -> track approval -> receive)** — Approval, landed-cost entry, and dispatch are ADMIN actions — without the admin side advancing the request, the franchise can only reach SUBMITTED and cannot test receive. Quantities are capped (10000/item, 100 items) to mirror backend DTO.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 5 | | | | |
| P1 | 8 | | | | |
| P2 | 3 | | | | |
| **All** | **16** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
