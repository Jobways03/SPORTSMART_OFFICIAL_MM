# Test Sheet — Customer — Web Storefront

**App:** `web-storefront`  **Port:** 4005  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Register account + email OTP verify ⚠ | `/register` | POST /auth/register returns requiresVerification and redirects to verify; POST /auth/register/verify-otp succeeds and bounces to login. Registration provisions the account but does NOT auto-login. | ☐ | |
| 02 | Login + session establishment ⚠ | `/login` | POST /auth/login sets httpOnly cookies (sm_access_customer/sm_refresh_customer); the JS never sees tokens. /auth/me probe then resolves status=authed and the redirect away from /login fires. | ☐ | |
| 03 | Browse / search / filter catalog | `/products` | Catalog renders from the storefront catalog API with working search, facets, sort and pagination; collections show only their member products. | ☐ | |
| 04 | Product detail — variant, price, stock, add to cart | `/products/[slug]` | Variant selection drives the displayed price and stock; add-to-cart posts the productId+variantId+qty and fires cart-updated; serviceability returns estimatedDays/deliveryEstimate or unserviceable. | ☐ | |
| 05 | Cart — update qty, totals, coupon preview, tax | `/cart` | Cart totals (subtotal, discount preview, tax) are server-computed; coupon preview matches what checkout will charge; the discount is re-validated server-side at place-order (preview is advisory). | ☐ | |
| 06 | Checkout — address, serviceability, COD place order ⚠ | `/checkout` | Order is created (master + sub-orders + line snapshots), cart is cleared (cart-updated event), and you are redirected to /orders/[orderNumber]. Idempotency key prevents duplicate orders on retry. | ☐ | |
| 07 | Initiate a return | `/orders/[orderNumber]/return` | An eligible delivered item creates a return request (REQUESTED) with the chosen items, reasons and evidence; the return appears under /returns. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Password reset (forgot password) ⚠ | `/forgot-password` | POST /auth/forgot-password (always 200) then /auth/verify-reset-otp returns a resetToken, then /auth/reset-password updates the credential. | ☐ | |
| 12 | Order confirmation + GST invoice download ⚠ | `/orders/[orderNumber]` | The placed order appears immediately with correct line items and totals; once invoiced, a GST tax-document is listed and downloadable. | ☐ | |
| 13 | Order list + detail + tracking + cancel | `/orders` | Orders list and detail reflect real master/sub-order state; tracking timeline updates from shipping events; cancel transitions eligible orders to CANCELLED. | ☐ | |
| 14 | Online payment retry (Razorpay) ⚠ | `/orders/[orderNumber]` | Retry mints a new Razorpay order keyed to the MasterOrder and opens the checkout modal; successful capture verifies server-side and flips the order to PAID. | ☐ | |
| 15 | Return status + refund reflection ⚠ | `/returns/[returnId]` | Return status and refund outcome render accurately; refund shows as creditNote OR walletCredit (or 'processing' in-flight), with refund-attempt history surfaced on retries. | ☐ | |
| 16 | Raise support ticket / view thread (replaces disputes) ⚠ | `/account/support` | Ticket is created and threaded with customer/admin messages; the customer's only formal-resolution window is the support ticket — dispute routes soft-redirect to support. | ☐ | |
| 17 | Wallet balance, top-up, transactions, wallet-pay at checkout (incl. goodwill) ⚠ | `/account/wallet` | Wallet balance and a typed transaction ledger (TOPUP/REFUND/GOODWILL_CREDIT/ORDER_REDEMPTION/etc.) render; wallet-apply at checkout is server-clamped to the available balance and lowers the order total. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Add GSTIN tax-profile | `/account/tax-profiles` | Tax-profile is created (GSTIN validated/verifiable), set-default toggles the single default, and the chosen profile is snapshotted onto the order/invoice at place-order. | ☐ | |
| 22 | Addresses CRUD | `/account/addresses` | Address create/edit/delete and set-default persist; idempotency prevents duplicate rows on double submit; the default is used as the checkout pre-selection. | ☐ | |
| 23 | Profile + DPDP: data export, privacy/consent, access history ⚠ | `/account/data-export` | Data export streams a JSON file (3/hour rate limit → 429 surfaced); consent toggles persist; access history lists sessions/logins; profile edits and password change succeed. | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Register account + email OTP verify** — Email/SMS are dev stubs — OTP is logged to the API console, not delivered. Captcha is disabled by default in dev.
- **02 Login + session establishment** — Auth is cookie-based — sessionStorage 'accessToken' is NOT populated by login, so flows that read it (data-export, wallet CSV) can fail to authenticate in dev.
- **06 Checkout — address, serviceability, COD place order** — Storefront checkout hardcodes paymentMethod=COD and has NO Razorpay call — without NEXT_PUBLIC_RAZORPAY_KEY_ID it is COD-only by design. Online pay surfaces only as a retry on the order page.
- **11 Password reset (forgot password)** — Reset OTP is a dev console log (email stub).
- **12 Order confirmation + GST invoice download** — Invoice/tax-document generation may lag order placement depending on the invoice-gen job; a fresh COD order may not have a tax-document yet.
- **14 Online payment retry (Razorpay)** — Requires NEXT_PUBLIC_RAZORPAY_KEY_ID + Razorpay test keys; without the key the lib throws 'Razorpay is not configured… Use Cash on Delivery instead', so this flow is untestable in a default dev env.
- **15 Return status + refund reflection** — Exchange price-diff payment needs Razorpay test keys; refund/QC progression depends on admin/seller actions and the refund-execution cron in dev.
- **16 Raise support ticket / view thread (replaces disputes)** — Customer-facing disputes UI was collapsed into support (Phase 11); the Dispute model still exists server-side but is not directly customer-visible here.
- **17 Wallet balance, top-up, transactions, wallet-pay at checkout (incl. goodwill)** — Top-up needs Razorpay test keys; wallet CSV export reads sessionStorage 'accessToken' which cookie-login doesn't set, so the download can fail in dev.
- **23 Profile + DPDP: data export, privacy/consent, access history** — Data-export reads sessionStorage 'accessToken' (not set by cookie-login) — in a default dev session it throws 'You need to be logged in', a real auth gap to flag.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 7 | | | | |
| P1 | 7 | | | | |
| P2 | 3 | | | | |
| **All** | **17** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
