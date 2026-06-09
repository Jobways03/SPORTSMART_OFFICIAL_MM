# Test Sheet — Storefront Ops Admin

**App:** `web-admin-storefront`  **Port:** 4000  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Admin login with MFA (TOTP / email-OTP / backup code) ⚠ | `/login` | Correct credentials + valid MFA code lands on /dashboard; tokens stored in sessionStorage AND sm_access_admin/sm_refresh_admin httpOnly cookies are set. | ☐ | |
| 02 | COD mark-as-paid (cash collection) — COD-only guarded | `/dashboard/orders/[id]` | paymentStatus → PAID, a CashCollection ledger row records expected/collected/variance in paise (DB CHECK variance=collected-expected), paid* columns stamped, COD_MARK_PAID audited, captured-payment event fires once. | ☐ | |
| 03 | Dispute review + decision (resolve with liability + remedy) | `/dashboard/disputes/[id]` | Dispute moves to RESOLVED_* and, for refund/goodwill remedies, a RefundInstruction is minted (PENDING_APPROVAL) routed to the finance refund queue; liability attribution recorded per ADR-016. | ☐ | |
| 04 | Refund approve/reject — dual-approval queue + goodwill | `/dashboard/finance/refund-approvals` | Final approval runs the refund saga and credits the customer wallet (status → SUCCESS); first approval of a high-value refund only records firstApprovedBy and shows 'pending second approval'. | ☐ | |
| 05 | Seller / franchise settlement cycle — approve + mark-paid (UTR) | `/dashboard/finance/settlements` | Cycle moves PENDING→APPROVED→PAID per row; mark-paid is atomic + CAS (no double-pay) and records UTR; adjustments can be added/voided (void reverses the effect on settlement + cycle totals). | ☐ | |
| 06 | Commission view / hold / resume / adjust | `/dashboard/commission` | Hold/resume flips the commission's hold state; adjust changes adminEarning within the cap and flags the record as adjusted; every action recorded in the history timeline. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Order management — search, filter, open detail | `/dashboard/orders` | Filtered list reflects orderStatus; paging works; detail page loads full order with sub-orders, payment status, money breakdown. | ☐ | |
| 12 | Verify a PLACED order (route to seller) | `/dashboard/orders/[id]` | Order flips to verified=true and is routed (ROUTED_TO_SELLER); sub-orders appear for the chosen seller(s). | ☐ | |
| 13 | Cancel / reject an order or sub-order (triggers refund saga for prepaid) | `/dashboard/orders/[id]` | Sub-order/order moves to CANCELLED/REJECTED, stock holds release, and for prepaid orders the refund saga is triggered; reason is stored. | ☐ | |
| 14 | Chargeback ingest + respond (Razorpay disputes) ⚠ | `/dashboard/payment-ops/chargebacks` | Chargebacks ingested from payment.dispute.* webhooks are listed; marking evidence submitted advances evidenceStatus and is audited; won→RECOVERED, lost→LOST are terminal. | ☐ | |
| 15 | Payment-ops mismatch triage (alert transitions) | `/dashboard/payment-ops` | Alert status transitions via CAS (no last-write-wins); resolution notes persisted and transition audited. Metrics summarize gateway attempt success/failure. | ☐ | |
| 16 | Reconciliation run + discrepancy resolution | `/dashboard/reconciliation` | Run produces discrepancies; per-row and bulk status transitions persist with assignment + notes; reopen requires a reason; CSV downloads (bearer-gated). | ☐ | |
| 17 | Accounts overview — platform / seller / franchise payables | `/dashboard/accounts` | Money KPIs reconcile across tabs; pending payables match the count of pending settlements; drill links land on the matching filtered list. | ☐ | |
| 18 | Seller reversals (B2B / off-platform) approve / reject | `/dashboard/seller-reversals` | Approve applies stock restore + commission reversal + a settlement debit against the seller; the customer's order is unaffected. Reject stores the rejection reason. | ☐ | |
| 19 | Discounts / coupons CRUD + lifecycle | `/dashboard/discounts` | New discount/coupon created in DRAFT/SCHEDULED/ACTIVE; lifecycle transitions move it through Pause/Resume/Archive; | ☐ | |
| 110 | RBAC roles — create/edit role + assign permissions | `/dashboard/roles` | Role saved with the selected permission keys; toggling active changes whether assigned admins hold the permissions on their next request (assignments preserved either way). | ☐ | |
| 111 | Active sessions — revoke single / all-for-actor | `/dashboard/sessions` | Revoke sets revoked_at so the actor's next token refresh fails and they are forced to re-login; bulk revoke reports how many sessions were killed. | ☐ | |
| 112 | Seller KYC verification decision (approve / reject) | `/dashboard/sellers/approvals` | Approve flips verificationStatus to APPROVED/VERIFIED (seller can transact); reject stores the reason and moves the seller out of the queue. | ☐ | |
| 113 | Order-verification triage (COD risk tray / bulk-approve) | `/dashboard/verification` | Claimed orders move into the reviewer's tray; approve/reject/release update order verification state; bulk-approve-green returns the list of approved ids. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Customer management — search + 360 view | `/dashboard/customers` | Search returns matching customers; detail shows the customer's orders/returns/wallet. | ☐ | |
| 22 | Failed-payments review | `/dashboard/payment-ops/failed-payments` | Lists gateway create-order/capture/verify attempts that failed, directly (not only by order drill-down). | ☐ | |
| 23 | Replacements review | `/dashboard/replacements` | Replacement requests are listed and triageable by status tab. | ☐ | |
| 24 | Audit-log viewing + tamper-chain verification | `/dashboard/audit-logs` | Audit entries listed; chain verification returns OK (or flags a break); redacted CSV downloads. | ☐ | |
| 25 | Content + blog publish | `/dashboard/blog-posts` | Blog post saved with chosen visibility; VISIBLE posts surface on the storefront, HIDDEN do not; storefront content slots update (unfilled slots fall back to the curated placeholder). | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Admin login with MFA (TOTP / email-OTP / backup code)** — Email-OTP requires the email provider to actually deliver (dev may stub email); MFA only appears if the admin account is enrolled — a non-enrolled admin logs in straight to /dashboard.
- **14 Chargeback ingest + respond (Razorpay disputes)** — Real Razorpay evidence-API upload is not wired — the button only marks 'evidence submitted' tracking; webhook ingestion depends on the Razorpay webhook reaching the dev API.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 6 | | | | |
| P1 | 13 | | | | |
| P2 | 5 | | | | |
| **All** | **24** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
