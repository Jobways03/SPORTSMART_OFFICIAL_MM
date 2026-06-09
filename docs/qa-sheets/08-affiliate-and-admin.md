# Test Sheet — Affiliate Portal + Affiliate Admin

**App:** `web-affiliate (member portal) + web-affiliate-admin (admin)`  **Port:** 4007 (web-affiliate), 4006 (web-affiliate-admin); API 8000  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Affiliate application (register) ⚠ | `/register (web-affiliate:4007)` | POST /affiliate/register returns 201; UI shows success and redirects to login with the 'we'll email you once reviewed' banner. A new affiliate row appears in the admin list under PENDING_APPROVAL. | ☐ | |
| 02 | Affiliate login + pending/rejected/suspended messaging | `/login (web-affiliate:4007)` | ACTIVE login stores access+refresh tokens (sessionStorage + httpOnly cookies) and routes to /dashboard. PENDING login is rejected with code AFFILIATE_PENDING_APPROVAL → friendly 'still under review' message; | ☐ | |
| 03 | Earnings dashboard — attributed sale lifecycle ⚠ | `/dashboard/earnings (web-affiliate:4007)` | An attributed order creates a commission row (source COUPON or LINK) at commissionPercentage of post-discount subtotal, starting PENDING. | ☐ | |
| 04 | Add payout method + request payout (TDS netting) ⚠ | `/dashboard/payouts (web-affiliate:4007)` | POST /affiliate/me/payout-methods saves the method (only last4 shown). POST /affiliate/me/payouts bundles CONFIRMED commissions into a REQUESTED payout. | ☐ | |
| 05 | Admin sign in (with MFA) | `/login (web-affiliate-admin:4006)` | Uses /admin/auth/login (shared admin identity, not a separate affiliate-admin account). mfaRequired swaps to the challenge step; verify stores adminToken and routes to /dashboard. | ☐ | |
| 06 | Approve / reject affiliate application | `/dashboard (web-affiliate-admin:4006)` | Approve (PATCH /admin/affiliates/:id/approve) flips status to ACTIVE and auto-generates a primary coupon code; the affiliate can then log in. | ☐ | |
| 07 | Manage affiliate — suspend / deactivate / reactivate + commission rate + coupon config | `/dashboard → Manage modal (web-affiliate-admin:4006)` | Suspend (PATCH .../suspend) blocks login + earning; Deactivate keeps login but stops new commissions; Reactivate restores ACTIVE. | ☐ | |
| 08 | Payout queue — approve / mark paid / mark failed ⚠ | `/dashboard/payouts (web-affiliate-admin:4006)` | Approve PATCH .../approve; Mark-paid PATCH .../mark-paid settles bundled commissions to PAID and writes the transaction ref; | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Forgot password → OTP → reset | `/forgot-password (web-affiliate:4007)` | forgot-password emails a 6-digit OTP; verify-reset-otp returns a resetToken stashed in sessionStorage; reset-password consumes it. New password works at /login. | ☐ | |
| 12 | Share coupon / referral code ⚠ | `/dashboard/coupons (web-affiliate:4007)` | Codes come from /affiliate/me (couponCodes); the page is read-only — affiliates cannot create codes themselves. Copy buttons flip to '✓ Copied'; share links open pre-filled with code + storefront link. | ☐ | |
| 13 | TDS statement + tax documents (Form 16A) ⚠ | `/dashboard/tds and /dashboard/tax-documents (web-affiliate:4007)` | /affiliate/me/tds returns one row per FY (no TDS until the FY threshold is crossed). /affiliate/me/tax/summary returns per-quarter rows; | ☐ | |
| 14 | Platform settings — commission default, return window, payout minimum, TDS config ⚠ | `/dashboard/settings (web-affiliate-admin:4006)` | PATCH /admin/affiliates/reports/settings persists the defaults; they apply to every affiliate without a per-affiliate override. Return window drives PENDING→CONFIRMED timing; minimum payout gates member payout requests; | ☐ | |
| 15 | Admin overview, commission ledger, TDS records, reports | `/dashboard/overview, /dashboard/commissions, /dashboard/tds, /dashboard/reports (web-affiliate-admin:4006)` | Overview action tiles deep-link to the right queues and zero out when handled ('Inbox zero'). Commission ledger reflects every affiliate's commissions with correct status totals. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Edit affiliate profile | `/dashboard/profile (web-affiliate:4007)` | PATCH /affiliate/me persists only changed fields; identity card, status pill, KYC pill, and commission-rate pill reflect the saved values. '✓ Profile saved' flash on success. | ☐ | |
| 22 | Affiliate support ticket | `/dashboard/support (web-affiliate:4007)` | createTicket returns a ticket with a ticketNumber; you land on its thread. The list shows it with the right status pill and last-activity time; status filters work. | ☐ | |
| 23 | Affiliate KYC submission + admin KYC review (PAUSED) ⚠ | `/dashboard/kyc (both apps)` | Both KYC surfaces render a static 'paused' placeholder — no PAN/Aadhaar capture, no upload, no admin verify/reject queue. Backend KYC routes and the KYC nav entries/KPIs are commented out. | ☐ | |
| 24 | Coverage / service-area (DEFERRED) ⚠ | `/dashboard/coverage (web-affiliate:4007)` | Static 'Coverage areas — coming soon' placeholder. There is no affiliate service-area data model; the old version 404'd against a non-existent franchise-coverage endpoint and was removed. | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Affiliate application (register)** — Registration does NOT use the OTP screen — /verify-otp is only for password reset. There is no email-verify-on-signup step; admin approval is the gate. Captcha is disabled in dev (NEXT_PUBLIC_CAPTCHA_PROVIDER=disabled).
- **03 Earnings dashboard — attributed sale lifecycle** — Requires a seeded storefront order + payment + delivery to generate a commission; the return-window→confirm step depends on the 60s confirmation cron and the configured returnWindowDays.
- **04 Add payout method + request payout (TDS netting)** — Eligibility checklist still lists 'KYC verified' (gates on kycStatus==='VERIFIED' via AFFILIATE_KYC_GATE_ENABLED) even though the KYC submission page is PAUSED — so in dev an affiliate may be unable to satisfy the checklist unless KYC is verified/forced server-side or the gate env is off. §194-O TDS section determination + the historical-10% correction are flagged in project memory as finance/legal sign-off gates before production.
- **08 Payout queue — approve / mark paid / mark failed** — The admin Mark-paid/Approve modal summary hard-codes 'TDS (10%)' while the member-side and project memory describe §194-O (5% with PAN). Treat the 10% label as a stale UI string. Reversal debit + TDS are computed server-side at payout-request time.
- **12 Share coupon / referral code** — Coupon CREATION/config is admin-only (in the affiliate-admin Manage modal). The member side only shares what admin issued.
- **13 TDS statement + tax documents (Form 16A)** — DISCREPANCY: /dashboard/tds text says 'Section 194H', '5% TDS', '₹15,000 threshold'; /dashboard/tax-documents says 'Section 194-O'. Project memory says the effective deduction is §194-O. Treat the §194H wording as a stale label, not a bug to fix during testing. Form 16A issuance is a separate manual/marketplace step, so most dev quarters show 'Not issued'.
- **14 Platform settings — commission default, return window, payout minimum, TDS config** — Settings UI labels TDS as 'Section 194H', '10% statutory', '₹15,000 floor' — inconsistent with the §194-O direction in project memory; the editable rate/threshold fields are the source of truth, the section label is informational/stale.
- **23 Affiliate KYC submission + admin KYC review (PAUSED)** — Intentionally disabled per product request (full impl preserved in git history / block comments). Do NOT log as a defect; just record that the flow is unavailable and that it interacts with payout gating.
- **24 Coverage / service-area (DEFERRED)** — Genuinely unimplemented feature (no affiliate coverage schema). Out of scope for functional testing — placeholder only.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 8 | | | | |
| P1 | 5 | | | | |
| P2 | 4 | | | | |
| **All** | **17** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
