# SPORTSMART_MM — Whole-Application Manual UI / UAT Checklist

> Auto-generated 2026-06-09 from a per-persona route→API trace across all 12 frontends. Covers **156 UI processes** across **10 personas** (59 are P0). Priorities: **P0**=core revenue / smoke path, **P1**=important, **P2**=edge/admin-config.

## How to read this
Each process lists: **route** → **Expected** (what you should see) → **Verify** (correctness checks, esp. money/state) → optional **Caveat** (a dev-env stub or known gap that *changes* the expected outcome — do not file these as bugs).

---
## 0. Prerequisites (set up before clicking)

- Stack bring-up: from repo root run `turbo run dev --concurrency=16` (plain `pnpm dev` fails — 13 persistent tasks exceed turbo's default concurrency 10). API serves on :8000; frontends on the fixed ports below; React Native Metro on :8081.
- Infra: Postgres reachable at DATABASE_URL (default postgresql://postgres:postgres@localhost:5432/sportsmart_dev) and Redis at REDIS_URL (default redis://localhost:6379) MUST be up before the API boots. NODE_ENV must NOT be 'production' (it enables the dev OTP console log).
- DB setup + seed: `pnpm db:setup` (runs prisma migrate deploy + seed:quick) or `cd apps/api && pnpm seed` for the full seed (pincodes/catalog/tax-master). Seed catalog/products so the storefront has buyable items: `pnpm --filter @sportsmart/api seed:catalog`. The dev DB logs a benign 'AUDIT CHAIN BREAK' on boot — ignore it (it is NOT a real tamper; distinguish from a chain-verify failure on the audit-logs page).
- Frontend ports (open in browser): web-admin-storefront 4000 (Super Admin / Finance-Compliance), web-d2c-seller-admin 4001, web-franchise-admin 4002, web-d2c-seller 4003, web-franchise 4004, web-storefront 4005 (customer), web-affiliate-admin 4006, web-affiliate 4007, web-retail-seller-admin 4008, web-retail-seller 4009. (web-admin has no fixed dev port.)
- ADMIN test login (seeded): email = ADMIN_SEED_EMAIL (default admin@sportsmart.com), password = ADMIN_SEED_PASSWORD from apps/api/.env (.env.example ships Admin@123). This is a SUPER_ADMIN — it holds ALL seller-type scopes, so it sees D2C+RETAIL+FRANCHISE. To exercise the scope-isolation P0s you must create a custom role holding ONLY sellers.scope.d2c (or .retail) via web-admin-storefront /dashboard/roles and assign it to a second admin — a default/unscoped admin sees everything and will NOT reproduce the 404 boundary.
- ADMIN MFA: a freshly-seeded admin is NOT MFA-enrolled, so it logs straight to /dashboard (no TOTP step). To test the MFA P0s, enroll TOTP first (or run `pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-admin-mfa-e2e.ts`). Email-OTP MFA fallback works in dev because the code is printed to the API console (see caveats).
- CUSTOMER login: self-register at web-storefront:4005 /register, then read the 6-digit OTP from the API console (printed as `🔑 [DEV OTP] for <email>: <code>`), verify at /register/verify, then log in. No auto-login after register.
- SELLER logins (D2C 4003 / RETAIL 4009): self-register at /register, verify email via the console OTP, submit onboarding KYC — then an ADMIN must approve the seller (web-d2c-seller-admin:4001 or web-retail-seller-admin:4008, seller detail → Verify KYC / Approve & Verify) before the account flips ACTIVE/VERIFIED and can transact. A seller cannot reach the dashboard or sell until admin-approved.
- FRANCHISE login (4004): self-register + console-OTP verify, submit KYC, then admin approves in web-franchise-admin:4002 (franchise detail → Update Verification → VERIFIED, then Update Status → APPROVED → ACTIVE). Seed at least one APPROVED+active catalog mapping AND non-zero stock (via procurement-receive or an inventory adjustment) before testing POS.
- AFFILIATE login (4007): self-register at /register (NO email-verify step — admin approval is the gate, and there is no signup OTP). An ADMIN approves the application in web-affiliate-admin:4006 (Pending → Approve), which auto-issues the affiliate's coupon code; only then can the affiliate log in. NOTE the payout eligibility checklist gates on KYC-verified while the KYC page is paused — to test a payout, verify/force kycStatus server-side or disable AFFILIATE_KYC_GATE_ENABLED.
- Test data dependencies: most downstream P0s need an upstream artifact — a placed order before fulfilment/return/refund, a delivered order before a return, an approved seller/product before allocation, a settlement cycle before mark-paid. Run the golden path first to mint these, or use seed:smoke (`pnpm --filter @sportsmart/api seed:smoke`) for ready-made customer/seller actors.
- Razorpay is unset by default (RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET blank). Leave it unset for the COD-only happy path, OR set Razorpay TEST keys (same project for key+secret, and NEXT_PUBLIC_RAZORPAY_KEY_ID on the relevant frontend) to exercise online-pay / wallet-topup / exchange-price-diff flows.
- SELLER_BANK_ENCRYPTION_KEY must be set in apps/api/.env to write seller bank details (AES-256-GCM) — without it the API 400s 'Bank-details encryption is not configured' and no seller/franchise settlement can be marked paid. Set it before testing the settlement P0s.

---
## 1. Golden-path smoke test (the P0 end-to-end — run this first)

Threads customer → seller → admin → settlement → return → refund across apps. If this passes, the core marketplace works.

**1. Customer** — _web-storefront (4005)_  
   - Do: Register (console OTP verify) → log in → browse catalog → open a PDP, pick a variant, Add to Cart → /checkout with a saved address → place order (paymentMethod=COD, X-Idempotency-Key).
   - Expect: Master order + sub-orders created with line snapshots, cart cleared, redirect to /orders/[orderNumber] showing PLACED, paymentStatus PENDING (COD). Note the order number.
**2. Storefront Ops Admin** — _web-admin-storefront (4000)_  
   - Do: Log in (seed admin) → /dashboard/orders → open the order → Verify (route to seller). (Or use /dashboard/verification claim-next → approve for the risk-triage path.)
   - Expect: Order flips verified=true and auto-routes to an eligible seller (ROUTED_TO_SELLER); a sub-order appears for that seller.
**3. Seller (D2C or RETAIL)** — _web-d2c-seller 4003 / web-retail-seller 4009_  
   - Do: Log in as the routed seller → /dashboard/orders → Accept the OPEN sub-order → upload 4 shipment-evidence photos → Mark Packed → Mark Shipped with tracking + courier (SELF_DELIVERY).
   - Expect: acceptStatus OPEN→ACCEPTED; ship button unlocks only at 4/4 evidence photos; sub-order → SHIPPED with tracking, awaiting admin delivery confirmation.
**4. Storefront / Seller-Admin** — _web-admin-storefront 4000 (or scoped seller-admin)_  
   - Do: Mark the sub-order DELIVERED (self-delivery has no Shiprocket/Delhivery webhook in dev, so admin/seller confirms manually) → then on the COD order open the cash-collection modal and Mark cash collected (mark-paid, idempotency key cod-mark-paid-<id>).
   - Expect: All sub-orders DELIVERED → order DELIVERED; paymentStatus → PAID, a CashCollection ledger row records expected/collected/variance (DB CHECK variance=collected-expected), COD_MARK_PAID audited. The COD-only guard means an online order would NOT show this CTA.
**5. Storefront Ops Admin / Finance** — _web-admin-storefront (4000)_  
   - Do: /dashboard/finance/settlements → preview + create a settlement cycle → open it → Approve → on the seller row Mark paid with a UTR (8-40 chars). Cross-check /dashboard/commission shows the commission record for the delivered item and /dashboard/accounts payables reconcile.
   - Expect: Cycle PENDING→APPROVED→PAID per row; mark-paid is atomic+CAS (no double-pay) and records the UTR; the seller's /dashboard/accounts Settlements tab shows the same row flip to PAID. (Requires SELLER_BANK_ENCRYPTION_KEY + a bank account on file.)
**6. Customer** — _web-storefront (4005)_  
   - Do: Open the DELIVERED order → /orders/[orderNumber]/return → pick item(s), qty, reason category, optional evidence → Submit return → land on /returns/[returnId].
   - Expect: Eligible delivered item creates a return (REQUESTED) with chosen items/reasons; window-expired/already-returned items are blocked.
**7. Seller + Admin** — _seller portal + web-admin-storefront / seller-admin_  
   - Do: Seller: Mark received → upload QC evidence → Accept (or Contest). Admin (seller-admin Returns or admin-storefront): Approve → schedule pickup → mark received → submit QC decision (per-item approved qty) → Initiate refund.
   - Expect: Return advances REQUESTED→APPROVED→…→RECEIVED→QC_APPROVED/PARTIALLY_APPROVED→REFUND_PROCESSING; refund amount derives from QC-approved qty (not full requested qty for PARTIAL/DAMAGED).
**8. Storefront Ops Admin / Finance** — _web-admin-storefront (4000)_  
   - Do: /dashboard/finance/refund-approvals → open the refund instruction → Approve (a second DISTINCT admin must approve for high-value/goodwill). Refund execution settles via the refund-execution cron (gateway stubbed in dev).
   - Expect: Final approval runs the refund saga and credits the customer (wallet credit, or credit-note for an in-window §34). The SAME admin cannot give both approvals (button + API enforce); a finance reject would route the linked dispute back to UNDER_REVIEW.
**9. Customer** — _web-storefront (4005)_  
   - Do: Reopen /returns/[returnId] and /account/wallet → confirm the refund landed (wallet credit increases balance, or credit-note shown) and refund amount matches the approved QC quantity.
   - Expect: Return shows REFUNDED; wallet ledger shows a REFUND entry (or credit-note row); amount ties to the QC-approved qty. Golden path complete: customer order → seller fulfil → admin verify/COD-collect → settlement → return → refund all threaded across apps.

---
## 2. Cross-cutting checks (apply on every screen / persona)

- Auth/RBAC isolation: every /admin/*, /seller/*, /franchise/*, /affiliate/* call must reject (401/403) without the right session; seller-type scope MUST return 404 (not 403) on an out-of-scope seller/order/return/product id so its existence can't be confirmed — verify with a role holding ONLY sellers.scope.d2c or .retail, not a SUPER_ADMIN.
- Money formatting: all amounts are paise (BigInt) server-side and rendered as 2-decimal INR strings (formatINR) — never float-parsed. Spot-check totals = subtotal − coupon − wallet + shipping + tax; CashCollection variance = collected − expected; settlement net = gross − reversal + adjustment.
- Idempotency on double-submit: place-order, address-create, COD mark-paid (cod-mark-paid-<id>), refund/payout/return-submit, settlement mark-paid, sub-order cancel, POS recordSale/return all carry an X-Idempotency-Key — double-click/retry must NOT create duplicate orders, payments, refunds, restocks, or pays.
- Empty / loading / error states: every list (orders, returns, products, settlements, commission, payouts) must show a no-rows empty state (not an error/blank), skeletons/spinners while loading, and a degraded banner (not a 500/white screen) when a composing sub-fetch fails (e.g. accounts overview, analytics).
- CAS / no-last-write-wins on every status transition: alert triage, reconciliation rows, refund approve/reject, settlement mark-paid, commission hold/adjust, pincode-priority edit (expectedVersion → 409 on stale), HSN/UQC/platform-GST edits (OCC) — concurrent edits must compare-and-swap, not silently clobber.
- Audit logging: sensitive money/governance actions (COD mark-paid, refund approve/reject, dispute decision, settlement pay, commission adjust, role activate/deactivate, session revoke, tax-mode change, GSTIN/platform-GST decisions) must each write an audit entry with actor + reason where required (reason-length guards enforced both client- and server-side).
- Notifications / live updates: SSE/poll surfaces (admin dispute 5s poll, refund queue, affiliate-earnings SSE stream, verification queue stats) must live-refresh without a manual reload; outbound email/SMS are dev stubs (see caveats).
- Mobile responsive + native parity: web screens should hold at narrow widths; mobile-storefront flows that are PARITY with web (browse/cart/orders/returns/tickets/addresses) need only render+refresh+tab-nav smoke checks — defer money/eligibility correctness to the web suite.
- Cross-screen consistency: one action must reflect everywhere — a POS sale → inventory ledger SALE row → stock decrement → daily report → earnings → settlement; a seller stock edit on the portal → admin inventory; a settlement mark-paid → both admin and seller finance views; an approved product → customer storefront PLP.
- Input validation everywhere: GSTIN regex + GSTIN[2:12]==PAN cross-check, PAN masked to last-4, 10-digit 6-9 mobile, 6-digit pincode→state code, UTR charset/length, reason-length minimums, discount/refund caps (refund ≤ QC-approved, commission adjust ≤ order platform amount, POS net clamped ≥ 0).

---
## 3. Dev-environment caveats (stubs & known gaps — NOT bugs)

- Email & SMS are dev stubs — every OTP (customer/seller/franchise/affiliate register, password reset, admin email-OTP MFA) is printed to the API console as `🔑 [DEV OTP] for <email>: <code>` (gated on NODE_ENV != production). Read codes from the API log, not a real inbox. Outbound status/approval/settlement notification emails do nothing visible.
- Captcha is disabled by default in dev (NEXT_PUBLIC_CAPTCHA_PROVIDER=disabled) — registration/login forms submit with no captcha; do NOT file the absent captcha as a bug.
- Razorpay is unset by default → storefront/mobile checkout is COD-only by design (web-storefront hardcodes paymentMethod=COD and has no Razorpay call). Online-pay retry, wallet top-up, exchange price-diff, and the native Razorpay sheet are UNTESTABLE without RAZORPAY test keys (+ NEXT_PUBLIC_RAZORPAY_KEY_ID); the lib throws a clear 'Razorpay is not configured… Use Cash on Delivery instead'. Refund execution uses a stubbed gateway — refunds settle via the refund-execution cron / simulated callback, not a live webhook.
- Self-delivery is the only live DeliveryMethod (iThink removed; Delhivery/Shiprocket are a courier-agnostic skeleton). Carrier tracking webhooks are stubbed/Shiprocket-shaped, so a shipped sub-order does NOT auto-advance to DELIVERED — an admin marks delivery manually. Delhivery label downloads can legitimately return empty right after booking.
- Tax/GST integrations are deterministic STUBS in dev: EINVOICE_PROVIDER=stub mints 64-char deterministic IRNs/QRs (not real NIC IRP), EWAY_BILL_PROVIDER=stub mints EWB-STUB-<uuid> numbers, GSTN_PROVIDER=stub verifies via a local Mod-36 checksum only (well-formed GSTIN passes; NOT a real GSTN-portal lookup). A stub IRN/EWB/'verified' result is the EXPECTED dev output — do not flag as fake. GSTR-1 B2B IRN/IRN-date columns are blank under the stub; §6 Exports/§8 Nil-rated may be empty on older seed rows; GSTR-3B is outward-only by design (inward ITC sections carry a disclaimer).
- STRICT tax mode flip is GATED on zero audit-readiness blockers — a fresh dev DB has seeded gaps (missing HSN/UQC/seller-GSTIN), so a STRICT flip returning 409 and a STRICT CSV export being blocked (unless acknowledgeBlockers=true + override permission) are CORRECT outcomes, not bugs. In the default OFF/AUDIT posture exports always download.
- ADMIN seller-type scope only bites when the admin's role actually holds sellers.scope.d2c / .retail; a default/unscoped admin (incl. the seed SUPER_ADMIN) sees ALL seller types. To reproduce the must-not-see-other-type 404 boundary, test with a custom single-scope role (no migration needed — activate via /dashboard/roles).
- D2C/RETAIL seller bank-details: there is NO bank-account UI in the seller frontend — the first-listing wizard deep-links to /dashboard/profile?tab=bank and /profile/delivery, neither of which exists. Bank details can only be set by calling PATCH /seller/bank-details directly, and writes 400 ('Bank-details encryption is not configured') unless SELLER_BANK_ENCRYPTION_KEY is set. Until a key + bank account exist, seller/franchise payouts stay pending — this is a config gap, not a per-screen bug.
- Several customer/affiliate browser flows read sessionStorage 'accessToken' that cookie-login does NOT populate — customer data-export and wallet-CSV throw 'You need to be logged in', and affiliate flows may mis-auth. This is a real dev auth gap to flag (not expected-and-fine like the stubs). Mobile-storefront persists tokens in Keychain instead and is unaffected.
- Customer disputes UI was collapsed into Support (Phase 11) — /account/disputes* soft-redirects to /account/support; the Dispute model still exists server-side but is admin-only. Affiliate KYC and Coverage pages are deliberately PAUSED/DEFERRED (static placeholders, no submit). TDS labels read inconsistently (§194H/10%/₹15k in some places, §194-O elsewhere) — project memory says effective deduction is §194-O; treat §194H wording as a stale label, not a defect. Mobile push notifications, biometric login, and https Universal/App Links are NOT built (do not write test cases for them).
- Franchise POS needs an APPROVED+active catalog mapping AND non-zero on-hand stock (seed via procurement-receive or an inventory adjustment) before a sale will commit; staff attribution currently uses the franchise principal until a per-cashier staff JWT lands. POS bonus/'+₹X' top-up badges are cosmetic — backend credits only the entered amount. Mobile wallet bonus tiers are likewise cosmetic. Affiliate Form 16A / quarterly certs show 'Not issued' until a separate manual issuance step.
- Chargeback ingestion depends on a Razorpay payment.dispute.* webhook reaching the dev API (won't fire without Razorpay configured + a reachable webhook), and the 'Mark evidence submitted' button is tracking-only — no real Razorpay evidence-API upload is wired. Procurement/settlement disbursal records the UTR but does not move real money in dev.

---
## 4. Recommended persona testing order

- 1. Customer (web-storefront, 4005) — origin of every downstream artifact; placing a COD order seeds the data all other personas act on. Start here.
- 2. Storefront Ops Admin / Super Admin (web-admin-storefront, 4000) — log in with the seed admin to verify/route the order, approve sellers, and own the central money paths; also the place to mint scoped roles other personas need.
- 3. D2C Seller (web-d2c-seller, 4003) + D2C Seller-Admin (web-d2c-seller-admin, 4001) — pair the seller and its scoped admin so accept→pack→ship→QC and the approval/scope-isolation P0s are tested back-to-back.
- 4. RETAIL Seller + RETAIL Seller-Admin (4009 / 4008) — byte-near clones of D2C; smoke the parity flows fast and spend the time on the RETAIL scope-isolation boundary (must NOT see D2C entities → 404).
- 5. Franchise operator (web-franchise, 4004) + Franchise Network Admin (web-franchise-admin, 4002) — self-contained POS/procurement/settlement loop; needs an admin-approved mapping + seeded stock, so run after admins are set up.
- 6. Affiliate + Affiliate Admin (4007 / 4006) — attribution-driven; needs a storefront order placed via a coupon/?ref= link plus admin approval, so it builds on step 1; exercise the commission→payout→TDS lifecycle.
- 7. Super Admin / Finance-Compliance tax hub (web-admin-storefront /dashboard/tax, 4000) — last, because the GST/IRN/EWB/GSTR/TCS/TDS surfaces consume invoices and orders produced by all earlier steps and are mostly deterministic stubs.
- 8. Mobile-storefront (Metro 8081) — last and lightest: only smoke the genuinely mobile surface (Keychain cold-start, native Razorpay sheet, deep links, camera evidence, session-expiry reset); defer all business-logic correctness to the web-storefront results.

---
## 5. Per-persona process checklists

### Customer (storefront shopper / buyer)
**App:** `web-storefront`  |  **Port:** 4005

The web-storefront is the customer-facing marketplace where a shopper registers (email + OTP verify), browses/searches the catalog, opens a PDP to pick variants and add to cart, applies coupons, and checks out to a saved address (COD-only in dev unless Razorpay test keys are set). Post-purchase, the customer tracks orders, downloads GST invoices, initiates returns and watches refunds land (as credit-note or wallet credit), tops up and pays with wallet (incl. goodwill credit), raises support tickets (the old disputes routes now redirect to support), manages addresses and GSTIN tax-profiles, and exercises DPDP rights (data export, consent/privacy, access history). All customer endpoints are real (api/.../customer-*.controller.ts); the place-order call is hardcoded paymentMethod=COD, with online pay surfacing only as a Razorpay retry on the order-detail page.

#### [P0] Register account + email OTP verify
- **Route:** `/register`
- **Steps:** Open /register, fill first/last name, email, optional 10-digit mobile (6-9 prefix), password (8+ upper/lower/number/special), confirm → Tick Terms + Privacy consent checkboxes, submit (captcha only if NEXT_PUBLIC_CAPTCHA_PROVIDER set; disabled in dev) → Get redirected to /register/verify?email=...; read the 6-digit OTP from the API console log (email is a dev stub) → Enter the 6 digits (paste supported), submit; optionally test Resend after the 60s cooldown → Land on /login?verified=1 with the green 'Email verified' banner
- **Expected:** POST /auth/register returns requiresVerification and redirects to verify; POST /auth/register/verify-otp succeeds and bounces to login. Registration provisions the account but does NOT auto-login.
- **Verify:** A new user row is created and marked emailVerified=true after OTP; duplicate-email register still routes to verify (anti-enumeration, uniform response); wrong OTP returns 401 'Invalid or expired code'; ALREADY_VERIFIED 400 pushes to login.
- ⚠️ **Caveat:** Email/SMS are dev stubs — OTP is logged to the API console, not delivered. Captcha is disabled by default in dev.

#### [P0] Login + session establishment
- **Route:** `/login`
- **Steps:** Open /login, enter the verified email + password, submit → On success the navbar reflects the signed-in user and you are redirected to / → Try an unverified account: confirm the 403 EMAIL_NOT_VERIFIED inline 'Verify now / resend code' link appears → Try wrong password: confirm 401 'Invalid email or password'
- **Expected:** POST /auth/login sets httpOnly cookies (sm_access_customer/sm_refresh_customer); the JS never sees tokens. /auth/me probe then resolves status=authed and the redirect away from /login fires.
- **Verify:** Session persists across refresh (cookie-backed); already-authed visitors to /login are redirected to /; logout revokes the server Session and clears cookies.
- ⚠️ **Caveat:** Auth is cookie-based — sessionStorage 'accessToken' is NOT populated by login, so flows that read it (data-export, wallet CSV) can fail to authenticate in dev.

#### [P1] Password reset (forgot password)
- **Route:** `/forgot-password`
- **Steps:** Enter account email, submit Send Reset Code (server always returns success to prevent enumeration) → Go to /forgot-password/verify?email=..., read the reset OTP from the API console, enter it to get a resetToken → On /forgot-password/reset, set a new compliant password and submit → Sign in with the new password on /login
- **Expected:** POST /auth/forgot-password (always 200) then /auth/verify-reset-otp returns a resetToken, then /auth/reset-password updates the credential.
- **Verify:** Old password no longer works; new password logs in; rate-limit (429) surfaces 'Too many requests' on repeated forgot-password calls.
- ⚠️ **Caveat:** Reset OTP is a dev console log (email stub).

#### [P0] Browse / search / filter catalog
- **Route:** `/products`
- **Steps:** Open /products; confirm the SSR product grid loads via GET /api/v1/storefront/products?<query> → Apply search term and facet filters (category/brand/price/sort) via the query string and confirm the grid + count update → Open a collection at /collections and /collections/[slug] (GET /catalog/collections/[slug] + storefront/products) → Paginate and click a product card through to its PDP
- **Expected:** Catalog renders from the storefront catalog API with working search, facets, sort and pagination; collections show only their member products.
- **Verify:** Only ACTIVE, in-catalog products appear; price/title/image match the PDP; empty result shows a no-products state, not an error.

#### [P0] Product detail — variant, price, stock, add to cart
- **Route:** `/products/[slug]`
- **Steps:** Open a PDP (GET /storefront/products/[slug]); confirm gallery, title, price, description render → Select a variant (size/color) and confirm price/stock update to the variant → Enter a pincode and click check delivery (GET /storefront/serviceability/check?productId&variantId&pincode) → Click Add to Cart (POST /customer/cart/items) — cart drawer opens, 'Added to cart' toast shows; or Buy Now to go to /cart → If signed out, confirm Add to Cart redirects to /login
- **Expected:** Variant selection drives the displayed price and stock; add-to-cart posts the productId+variantId+qty and fires cart-updated; serviceability returns estimatedDays/deliveryEstimate or unserviceable.
- **Verify:** Cart badge increments; out-of-stock variant disables add; serviceability reflects the pincode; wishlist heart toggles persist.

#### [P0] Cart — update qty, totals, coupon preview, tax
- **Route:** `/cart`
- **Steps:** Open /cart (GET /customer/cart); change a line qty (PATCH /customer/cart/items/[id]) and confirm line + subtotal recompute → Remove a line (DELETE /customer/cart/items/[id]) → Enter a coupon and Apply (POST /customer/coupons/validate); confirm the discount preview and that an invalid/expired code shows the server rule message → Confirm the GST tax preview line populates (POST /customer/tax-preview/cart) and updates after qty changes → Proceed to checkout
- **Expected:** Cart totals (subtotal, discount preview, tax) are server-computed; coupon preview matches what checkout will charge; the discount is re-validated server-side at place-order (preview is advisory).
- **Verify:** Qty/remove changes recompute subtotal and re-preview the coupon (drops it silently if min-order no longer met); 429 on coupon spam shows retry-after; tax preview degrades gracefully to 'GST included' if it fails.

#### [P0] Checkout — address, serviceability, COD place order
- **Route:** `/checkout`
- **Steps:** Open /checkout; pick a saved address or add a new one (pincode lookup via /pincodes/[pincode] auto-fills city/state) → Click initiate (POST /customer/checkout/initiate) and confirm serviceability per item; remove unserviceable items if prompted (POST /customer/checkout/remove-unserviceable) → Pick a shipping option (POST /customer/shipping-options/quote) and optionally a GSTIN tax-profile → Optionally apply wallet balance and/or a coupon → Place order (POST /customer/checkout/place-order with X-Idempotency-Key, paymentMethod=COD)
- **Expected:** Order is created (master + sub-orders + line snapshots), cart is cleared (cart-updated event), and you are redirected to /orders/[orderNumber]. Idempotency key prevents duplicate orders on retry.
- **Verify:** Final amount = subtotal − coupon − wallet + shipping + tax (server is authoritative); only serviceable items are ordered; chosen shipping option and tax-profile snapshot are locked onto the order.
- ⚠️ **Caveat:** Storefront checkout hardcodes paymentMethod=COD and has NO Razorpay call — without NEXT_PUBLIC_RAZORPAY_KEY_ID it is COD-only by design. Online pay surfaces only as a retry on the order page.

#### [P1] Order confirmation + GST invoice download
- **Route:** `/orders/[orderNumber]`
- **Steps:** Land on the order detail right after placing (GET /customer/orders/[orderNumber]) → Confirm order number, items, amounts, address snapshot and PLACED status → Go to /account/invoices (GET /customer/tax-documents) and open/download the tax document for the order
- **Expected:** The placed order appears immediately with correct line items and totals; once invoiced, a GST tax-document is listed and downloadable.
- **Verify:** Invoice amounts and GSTIN (if a tax-profile was chosen) match the order; COD orders show paymentStatus PENDING until collected.
- ⚠️ **Caveat:** Invoice/tax-document generation may lag order placement depending on the invoice-gen job; a fresh COD order may not have a tax-document yet.

#### [P1] Order list + detail + tracking + cancel
- **Route:** `/orders`
- **Steps:** Open /orders (GET /customer/orders?page&limit&status); filter by status and paginate → Open an order and review the sub-order timeline / fulfillment + shipping status → If eligible (not paid/shipped/delivered/cancelled), Cancel the order (PATCH /customer/orders/[orderNumber]/cancel) → Confirm cancelled orders roll up to CANCELLED even if individual sub-orders drove it
- **Expected:** Orders list and detail reflect real master/sub-order state; tracking timeline updates from shipping events; cancel transitions eligible orders to CANCELLED.
- **Verify:** canCancel gating is correct (blocked once PAID/SHIPPED/DELIVERED); effective status shows CANCELLED when all sub-orders are cancelled/rejected; status filter narrows the list.

#### [P1] Online payment retry (Razorpay)
- **Route:** `/orders/[orderNumber]`
- **Steps:** Open an ONLINE order stuck in PENDING_VERIFICATION (payment window still open) → Click Retry Payment (POST /customer/checkout/payment/retry) — a fresh Razorpay order is minted → Complete the Razorpay test-mode modal; on success the page refetches and shows PAID
- **Expected:** Retry mints a new Razorpay order keyed to the MasterOrder and opens the checkout modal; successful capture verifies server-side and flips the order to PAID.
- **Verify:** Retry CTA hides once paymentExpiresAt elapses; dismissing the modal is a no-op (can retry); only non-COD, non-PAID orders show the CTA.
- ⚠️ **Caveat:** Requires NEXT_PUBLIC_RAZORPAY_KEY_ID + Razorpay test keys; without the key the lib throws 'Razorpay is not configured… Use Cash on Delivery instead', so this flow is untestable in a default dev env.

#### [P0] Initiate a return
- **Route:** `/orders/[orderNumber]/return`
- **Steps:** From a DELIVERED order open Return (eligibility via GET /customer/returns/eligibility/[masterOrderId]) → Pick the sub-order + item(s), set quantity and a reason category (per-item valid categories from the API) → Optionally upload evidence (POST /customer/returns/evidence) and add notes / forfeit consent → Submit (POST /customer/returns) and land on /returns/[returnId]
- **Expected:** An eligible delivered item creates a return request (REQUESTED) with the chosen items, reasons and evidence; the return appears under /returns.
- **Verify:** Window-expired / already-returned / previously-rejected items are blocked with the right reason; available-for-return qty caps the request; reverse-pickup may be scheduled per policy.

#### [P1] Return status + refund reflection
- **Route:** `/returns/[returnId]`
- **Steps:** Open the return (GET /customer/returns/[returnId]); review status timeline (REQUESTED → APPROVED → PICKUP → RECEIVED → QC → REFUNDED) → Optionally Mark handed-over (POST /.../handed-over) or Cancel (POST /.../cancel) while pending → After QC, confirm the refund settlement: a credit-note (Section-34 open) or a wallet credit (time-barred) is shown → If an EXCHANGE remedy with price-up, complete the exchange Razorpay payment (init/verify)
- **Expected:** Return status and refund outcome render accurately; refund shows as creditNote OR walletCredit (or 'processing' in-flight), with refund-attempt history surfaced on retries.
- **Verify:** Refund amount matches the approved (possibly partial) QC quantity; wallet refund increases wallet balance; rejected returns expose an 'Open dispute' (support) link.
- ⚠️ **Caveat:** Exchange price-diff payment needs Razorpay test keys; refund/QC progression depends on admin/seller actions and the refund-execution cron in dev.

#### [P1] Raise support ticket / view thread (replaces disputes)
- **Route:** `/account/support`
- **Steps:** Open /account/support (GET /customer/support/tickets); create New (categories via /customer/support/categories) → Fill subject, body, priority, optionally link an order/return number; submit (POST /customer/support/tickets) → Open the ticket (GET /customer/support/tickets/[id]), reply (POST /.../messages), and Close (POST /.../close) → Hit an old /account/disputes or /account/disputes/[id] URL and confirm it redirects to /account/support
- **Expected:** Ticket is created and threaded with customer/admin messages; the customer's only formal-resolution window is the support ticket — dispute routes soft-redirect to support.
- **Verify:** Linked order/return number resolves on the ticket; status transitions (OPEN/WAITING_ON_CUSTOMER/RESOLVED/CLOSED) display correctly; reply appends to the thread.
- ⚠️ **Caveat:** Customer-facing disputes UI was collapsed into support (Phase 11); the Dispute model still exists server-side but is not directly customer-visible here.

#### [P1] Wallet balance, top-up, transactions, wallet-pay at checkout (incl. goodwill)
- **Route:** `/account/wallet`
- **Steps:** Open /account/wallet (GET /customer/wallet + /customer/wallet/transactions); review balance and ledger → Top up at /account/wallet/topup (POST /customer/wallet/topup → Razorpay → POST /customer/wallet/topup/verify) → At /checkout, toggle Apply wallet and confirm the applied paise reduce the payable amount → If a GOODWILL_CREDIT exists (from a dispute remedy), confirm it shows in the ledger and is spendable until its expiry
- **Expected:** Wallet balance and a typed transaction ledger (TOPUP/REFUND/GOODWILL_CREDIT/ORDER_REDEMPTION/etc.) render; wallet-apply at checkout is server-clamped to the available balance and lowers the order total.
- **Verify:** Applied wallet amount is deducted as ORDER_REDEMPTION on place-order; goodwill credit is non-withdrawable and excluded after its expiry; statement CSV export matches the ledger.
- ⚠️ **Caveat:** Top-up needs Razorpay test keys; wallet CSV export reads sessionStorage 'accessToken' which cookie-login doesn't set, so the download can fail in dev.

#### [P2] Add GSTIN tax-profile
- **Route:** `/account/tax-profiles`
- **Steps:** Open /account/tax-profiles (GET /customer/tax-profiles); Add a profile with GSTIN, legal name, billing address → Submit (POST /customer/tax-profiles); set one as default (POST /.../set-default) → At /checkout, confirm the default profile is pre-selected and a non-default can be picked for the order's invoice
- **Expected:** Tax-profile is created (GSTIN validated/verifiable), set-default toggles the single default, and the chosen profile is snapshotted onto the order/invoice at place-order.
- **Verify:** Invalid GSTIN is rejected; isVerified/verifiedAt reflect verification; only one isDefault; checkout invoice uses the selected GSTIN.

#### [P2] Addresses CRUD
- **Route:** `/account/addresses`
- **Steps:** Open /account/addresses (GET /customer/addresses); Add an address (POST /customer/addresses with idempotency key; pincode lookup fills city/state/stateCode) → Edit (PATCH /customer/addresses/[id]) and Set default (PATCH /.../set-default) → Delete an address (DELETE /customer/addresses/[id]) → Return to /checkout and confirm the address list + default reflect the changes
- **Expected:** Address create/edit/delete and set-default persist; idempotency prevents duplicate rows on double submit; the default is used as the checkout pre-selection.
- **Verify:** Phone/pincode validation enforced (10-digit 6-9, 6-digit pincode → state code); exactly one default; deleted address disappears from checkout.

#### [P2] Profile + DPDP: data export, privacy/consent, access history
- **Route:** `/account/data-export`
- **Steps:** On /account/data-export click Download (GET /customer/data-export → JSON attachment) → On /account/privacy review consent snapshot (GET /customer/consent) and toggle marketing/consent (POST /customer/consent) → On /account/access-history review login/access events (GET /customer/account/access...) → On /account/profile update name and change password (/customer/me, /customer/me/change-password)
- **Expected:** Data export streams a JSON file (3/hour rate limit → 429 surfaced); consent toggles persist; access history lists sessions/logins; profile edits and password change succeed.
- **Verify:** Export contains the user's data and respects the rate limit; consent state round-trips; access-history reflects recent logins; password change invalidates old credential.
- ⚠️ **Caveat:** Data-export reads sessionStorage 'accessToken' (not set by cookie-login) — in a default dev session it throws 'You need to be logged in', a real auth gap to flag.

---
### Customer (mobile shopper) — React Native iOS/Android storefront
**App:** `mobile-storefront`  |  **Port:** 8081 (Metro). App runs on iOS Simulator (Xcode) / Android Emulator (Android Studio) against API on :8000

The customer browses the catalog, adds to cart, checks out (Razorpay native sheet OR COD), tracks orders, starts photo-evidenced returns, and manages wallet/invoices/profile from a 4-tab app (Home / Browse / Cart / Account). The CONTENT of these flows is at parity with apps/web-storefront and should NOT be re-documented for correctness — testers should instead exercise the genuinely mobile-specific surface: native Razorpay sheet, Keychain login persistence, sportsmart:// deep links, camera/gallery evidence upload, system-browser PDF/file handoff, session-expiry reset, and Sentry/PostHog wiring. Push notifications, biometric auth, and https Universal/App Links are explicitly NOT built (Firebase/signing TODOs in README), so they are not testable.

#### [P0] App bring-up + cold-start login persistence (Keychain)
- **Route:** `App launch (no route)`
- **Steps:** Start Metro: turbo/pnpm --filter @sportsmart/mobile-storefront start (port 8081); launch via pnpm ios or pnpm android → Log in once with a CUSTOMER account on the Login screen → Fully kill the app (swipe-close on simulator), then relaunch from the home screen → Observe the brief full-screen spinner (RootNavigator isLoading) then the destination → Repeat after letting the access token expire to exercise the silent 401 refresh
- **Expected:** After re-launch the user lands directly on the App tabs (Home), NOT the Login screen — the user blob + tokens were rehydrated from Keychain (com.sportsmart.storefront.* services). An expired access token is transparently refreshed on the first API call.
- **Verify:** No re-login prompt on cold start; Home greeting shows the persisted user; network tab shows at most one auth/refresh 401-retry. Logout fully clears state (next launch shows Login).
- ⚠️ **Caveat:** Keychain writes are swallowed if biometrics aren't enrolled (storage.ts) — on a fresh simulator with no passcode this is fine. There is NO biometric/Face ID gating; persistence is silent token storage only.

#### [P0] Native Razorpay checkout sheet (online pay)
- **Route:** `/checkout (CartTab > Checkout)`
- **Steps:** Add an item to cart, ensure a default shipping address exists, open Checkout → Select 'Pay online · RAZORPAY' (note: COD is the default) → Tap 'Pay ₹… now' to open the NATIVE Razorpay sheet (not a web view) → Complete a test payment in the sheet, then cancel/decline on a second attempt → After success, confirm the app POSTs payment verify and lands on Order Confirmation (paid)
- **Expected:** Native Razorpay module opens an OS-level sheet. Success → handoff returns payment_id/order_id/signature → /customer/checkout/payment/verify → OrderConfirmation(paid:true). User-cancel (code 0) → OrderConfirmation(paid:false). Failure → 'Payment failed' alert.
- **Verify:** Money/total matches order summary (subtotal − coupon + shipping, GST included, wallet netted). Verify is server-side — a forged sheet success without verify must NOT mark paid. Confirm dismissed vs failed branch correctly (track PaymentDismissed vs PaymentFailed).
- ⚠️ **Caveat:** Requires RAZORPAY_KEY_ID in apps/mobile-storefront/.env AND restart with --reset-cache; the API's RAZORPAY_KEY_SECRET must match the same project or HMAC verify fails silently. Without the key the Pay button shows a clear config error. In the default dev env keys are unset, so COD is the realistic path — see next process.

#### [P0] Place order via COD (default dev path) + confirmation
- **Route:** `/checkout`
- **Steps:** Open Checkout with a serviceable cart and a default address → Leave payment as 'Cash on delivery' (the app's safe default) → Optionally toggle 'Use wallet balance' (note ONLINE locks to COD when wallet leaves a balance) → Tap 'Place order · COD' (or 'Paid by wallet' if wallet covers it all) → Land on Order Confirmation, then open the order from Account > Orders
- **Expected:** Order is created with no gateway call; lands on OrderConfirmation (paid:true, cod:true) — or paid-by-wallet when payable hits 0. Idempotency key prevents a double order on retap.
- **Verify:** COD balance-at-door equals payable after wallet/coupon; full-wallet order shows no cash to collect; coupon preview is cleared post-order so it can't bleed into the next order.
- ⚠️ **Caveat:** Online + partial wallet is deliberately forced to COD for the remainder (retryPayment charges full total on the current backend); this is a known client guard, not a bug to file.

#### [P1] Deep links via sportsmart:// scheme
- **Route:** `sportsmart://product/:slug, /order/:orderNumber, /return/:id, /wallet, /cart, /support/:ticketId, etc.`
- **Steps:** With the app installed and logged in, run: xcrun simctl openurl booted "sportsmart://product/<slug>" (iOS) or adb shell am start -a android.intent.action.VIEW -d "sportsmart://order/<orderNumber>" (Android) → Confirm the app foregrounds on the correct screen (PDP / Order detail / etc.) → Test a tab-level link (sportsmart://browse, sportsmart://wallet) → Log OUT, then fire a deep link and observe the fallback → Rebuild the app and confirm the URL scheme still resolves (registered at build time only)
- **Expected:** Authenticated: each URL routes to its mapped screen per src/navigation/linking.ts. Unauthenticated: the link lands on Login and the original destination is LOST (documented limitation).
- **Verify:** Param routes (product slug, orderNumber, returnId, ticketId) resolve the right entity; unknown paths fall through to Login when logged out; no crash on cold-start-from-link.
- ⚠️ **Caveat:** Only the custom sportsmart:// scheme works. https Universal Links / App Links are TODO (no apple-app-site-association / assetlinks.json). Lost-destination-after-login is a known gap, not a defect.

#### [P1] Camera / gallery evidence upload on a return
- **Route:** `/return/create (Account > Orders > order > Start a return)`
- **Steps:** Open a delivered, in-window order and tap Start a return → Select item(s), quantity, reason, accept the policy consent → Tap the ADD photo tile and choose 'Take photo' (camera) then 'Choose from gallery' → Add up to 5 photos; remove one with the X; try a >5MB image → Submit and confirm landing on the Return detail screen
- **Expected:** Native camera and photo-library pickers open (iOS perms NSCamera/NSPhotoLibrary already declared). Each picked image is downscaled (1600px/0.8q) and POSTed multipart to /customer/returns/evidence; the returned URL is attached. >5MB images are skipped with an alert; cancel returns silently.
- **Verify:** Evidence thumbnails render via cached image; the return is created with evidenceFileUrls; denying camera/photo permission shows the 'Allow it from Settings' alert (not a crash). Max 5 enforced.
- ⚠️ **Caveat:** On iOS simulator the camera is unavailable — use 'Choose from gallery' or a physical device for the camera path. react-native-image-picker predates RN 0.76 New Arch; if the build fails, pod install with RCT_NEW_ARCH_ENABLED=0.

#### [P1] Wallet top-up via native Razorpay
- **Route:** `/wallet/topup (Account > Wallet > Add money)`
- **Steps:** Open Wallet > Add money; enter or tap a quick amount (min ₹10, max ₹100,000) → Tap Pay to open the native Razorpay sheet → Complete a test payment; then on a second run cancel mid-sheet → On success confirm the verify call and the success alert → Pull-to-refresh the Wallet to confirm the new balance
- **Expected:** Razorpay sheet opens; success → verify(walletTransactionId,...) → balance increases by the amount; cancel → 'Top-up cancelled' note that credit may still land. Bonus tiers shown are pure UX (backend credits only the entered amount).
- **Verify:** Balance reflects the top-up after verify (not the displayed +bonus); a dismissed sheet does not double-credit; refresh shows the authoritative server balance.
- ⚠️ **Caveat:** Same Razorpay key/secret requirement as checkout. Bonus '+₹X' badges are cosmetic — do NOT file the missing bonus credit as a bug.

#### [P2] Invoice / data-export file handoff to system browser
- **Route:** `/invoices and /account/data-export`
- **Steps:** Open Account > My invoices on an account with a billed order → Tap Download on a PDF_GENERATED invoice → Confirm the device leaves the app and opens the PDF in the system browser/viewer → Repeat for Data export (Account > Privacy/Data export) download link
- **Expected:** App fetches a signed URL then calls Linking.openURL — the OS browser handles render + Save/Share. Invoices still 'generating' are disabled with a 'Pending' label.
- **Verify:** Correct invoice opens; non-ready docs can't be tapped; a missing/blocked URL shows 'Cannot open' rather than crashing.
- ⚠️ **Caveat:** There is NO in-app PDF viewer or file save — it's a browser handoff by design. On a bare simulator with no default PDF handler the open may no-op.

#### [P1] Session-expiry reset to Auth stack
- **Route:** `any authenticated screen`
- **Steps:** Log in and navigate deep into Account (e.g. Order detail) → Invalidate/expire the refresh token server-side (or wait past its TTL) → Trigger any API call (pull-to-refresh / navigate) → Observe the navigation behavior when refresh fails
- **Expected:** On a dead refresh token, onAuthFailure calls navigationRef.resetRoot to the Auth stack — the user is bounced to Login with an EMPTY history (cannot 'back' into a protected screen).
- **Verify:** Back gesture from Login does not return to the protected screen; re-login restores normal access; only one silent refresh attempt is made before the reset.

#### [P2] Crash reporting + analytics wiring (Sentry / PostHog RN)
- **Route:** `App-wide (ErrorBoundary + navigation onStateChange)`
- **Steps:** Set SENTRY_DSN (+ SENTRY_ENVIRONMENT) and POSTHOG_API_KEY in .env, restart Metro with --reset-cache → Navigate across several screens and perform login + a checkout → Force a JS error (or use a debug throw) to trip the ErrorBoundary → Check the Sentry project for the event and PostHog for screen/identify/event records
- **Expected:** ErrorBoundary catches render errors and reportError sends to Sentry; screen views fire on each navigation; login calls identify then Auth Login Completed; checkout fires Payment Started/Succeeded/Dismissed/Failed.
- **Verify:** Sentry event carries the environment tag and the ErrorBoundary context; PostHog shows the anon→distinct alias after identify, and reset() on logout starts a fresh anon id.
- ⚠️ **Caveat:** Both are NO-OPS when their env vars are empty (the default) — events go nowhere and reportError just console.errors. You MUST set DSN/API key + --reset-cache to test, otherwise there is nothing to verify.

#### [P2] PARITY NOTE — flows NOT to re-document (web-storefront equivalents)
- **Route:** `Home / Browse / PDP / Cart / Wishlist / Orders / Order detail / Returns / Tickets / Addresses / Profile / Change-password / Notification-prefs`
- **Steps:** Treat catalog browse, search + filters, pincode serviceability check on PDP, add-to-cart/wishlist, coupon preview, address CRUD, order list/detail/tracking, return status, support tickets, profile edit, change password, and notification preferences as PARITY with apps/web-storefront → Verify CONTENT correctness once on web; on mobile only smoke-check that each screen renders, loads data, and the bottom-tab navigation (Home/Browse/Cart/Account) + pull-to-refresh + skeletons work → Spot-check mobile gesture/keyboard handling (KeyboardAvoidingView on forms, swipe-back) rather than re-testing business logic
- **Expected:** Same REST endpoints and {success,message,data} envelope as web; same money math and state transitions. Mobile differences are presentation (NativeWind, tab bar, native pickers), not behavior.
- **Verify:** No mobile-only data divergence; screens render and refresh; tab nav + back gesture work. Defer correctness assertions (amounts, statuses, eligibility) to the web test suite.
- ⚠️ **Caveat:** Push-notification receipt, biometric login, and https Universal/App Links are NOT implemented (Firebase + iOS/Android signing are README TODOs) — do not write test cases for them. App icon/splash are RN defaults (TODO).

---
### Storefront Ops Admin (Super Admin / marketplace control center)
**App:** `web-admin-storefront`  |  **Port:** 4000

The Storefront Ops Admin is the marketplace control center that governs the platform's most sensitive money paths: order fulfillment, COD cash collection, disputes, the dual-approval refund-instruction queue, goodwill credits, chargebacks, payment-ops mismatch triage, reconciliation, seller/franchise settlements + commission, plus governance (RBAC roles, sessions, audit-log integrity, seller KYC). It talks to the API at port 8000 under /admin/* with bearer-token + httpOnly cookies; admin login is MFA-gated (TOTP, email-OTP fallback, or backup codes). Key invariants enforced server-side and surfaced in UI: COD mark-paid is COD-only-guarded, refunds above threshold/goodwill need two distinct approvers, and a finance refund rejection routes the dispute back to UNDER_REVIEW.

#### [P0] Admin login with MFA (TOTP / email-OTP / backup code)
- **Route:** `/login`
- **Steps:** Enter admin email + password and click Sign in → On MFA-enrolled accounts an MFA challenge appears (challengeToken with a visible countdown, default 5 min) → Enter the 6-digit authenticator code, OR click 'Email me a code instead' then enter the emailed 6-digit code, OR enter a backup code (8-16 chars) → Click 'Verify and sign in' → Confirm redirect to /dashboard; optionally test 'Use a different account' and challenge-expiry fallback
- **Expected:** Correct credentials + valid MFA code lands on /dashboard; tokens stored in sessionStorage AND sm_access_admin/sm_refresh_admin httpOnly cookies are set. Expired challenge (countdown hits 0:00 / 403) drops back to the password form with a clear message.
- **Verify:** Wrong code shows 'Invalid code' and clears the input; expired challenge forces re-password; after a password reset, /login?reset=success shows the 'every previous admin session signed out' banner. All sign-ins are logged for audit.
- ⚠️ **Caveat:** Email-OTP requires the email provider to actually deliver (dev may stub email); MFA only appears if the admin account is enrolled — a non-enrolled admin logs in straight to /dashboard.

#### [P1] Order management — search, filter, open detail
- **Route:** `/dashboard/orders`
- **Steps:** Open Orders; use the status filter tabs/select (All, Placed, Routed to seller, Exception queue, Cancelled) — list calls /admin/orders?orderStatus=...&page&limit=20 → Note the summary counts (pending verify, in-progress, returns, cancelled) and the EXCEPTION_QUEUE badge → Click a row to open /dashboard/orders/[id] → Review the status banner/timeline, sub-orders, payment method/status, discount + GST breakdown, affiliate commission rows
- **Expected:** Filtered list reflects orderStatus; paging works; detail page loads full order with sub-orders, payment status, money breakdown.
- **Verify:** Counts and badges match the filtered rows; COD vs online payment method is shown correctly; cross-check the order total against the GST/discount breakdown card.

#### [P1] Verify a PLACED order (route to seller)
- **Route:** `/dashboard/orders/[id]`
- **Steps:** Open a PLACED / PENDING_VERIFICATION order → Optionally add verify remarks → Click Verify (PATCH /admin/orders/:id/verify) → Watch the order auto-route to the best eligible seller
- **Expected:** Order flips to verified=true and is routed (ROUTED_TO_SELLER); sub-orders appear for the chosen seller(s).
- **Verify:** Status banner updates without manual refresh (page re-fetches); routing-preview can be checked first via /routing-preview. Online orders settle via Razorpay verify/webhook, not here.

#### [P0] COD mark-as-paid (cash collection) — COD-only guarded
- **Route:** `/dashboard/orders/[id]`
- **Steps:** Open a COD order that is verified + all sub-orders delivered and paymentStatus PENDING (the 'Mark cash collected' CTA only renders for paymentMethod === COD) → Open the cash-collection modal — collected amount pre-fills to the full payable → If collected differs from payable, a variance reason becomes mandatory; optionally add a collection reference (charset-guarded) + notes → Submit (PATCH /admin/orders/:id/mark-paid with collectedAmountInPaise, idempotency key cod-mark-paid-<id>)
- **Expected:** paymentStatus → PAID, a CashCollection ledger row records expected/collected/variance in paise (DB CHECK variance=collected-expected), paid* columns stamped, COD_MARK_PAID audited, captured-payment event fires once.
- **Verify:** An online (non-COD) order must NOT show this CTA and the API rejects mark-paid (COD-only guard, anti-fraud); variance without a reason is blocked client- and server-side; double-click dedupes via idempotency key. Cross-check the collected amount equals the order total.

#### [P1] Cancel / reject an order or sub-order (triggers refund saga for prepaid)
- **Route:** `/dashboard/orders/[id]`
- **Steps:** For a sub-order, click Cancel; pre-ship (UNFULFILLED/PACKED) needs only a reason → For SHIPPED/FULFILLED in-transit, tick the force-cancel acknowledgement (needs orders.subOrder.cancel.force) — cancels courier shipment first via /shipping/sub-orders/:id/cancel-with-courier → Or reject the whole order via Reject (PATCH /admin/orders/:id/reject-order, reason 10-500 chars) → Confirm
- **Expected:** Sub-order/order moves to CANCELLED/REJECTED, stock holds release, and for prepaid orders the refund saga is triggered; reason is stored.
- **Verify:** Reason under 10 chars is blocked; in-transit cancel requires the force checkbox; cross-check that a prepaid cancel creates a refund instruction/saga and stock is released. Server times out gracefully (60s abort).

#### [P2] Customer management — search + 360 view
- **Route:** `/dashboard/customers`
- **Steps:** Search by name/email/phone (GET /admin/customers?search=...) and page through results → Open a customer to /dashboard/customers/[id] → Review orders, returns, wallet, and activity in the 360 view
- **Expected:** Search returns matching customers; detail shows the customer's orders/returns/wallet.
- **Verify:** PII handling (phone/email) and order history cross-check against the orders module; wallet balance matches wallet ledger.

#### [P0] Dispute review + decision (resolve with liability + remedy)
- **Route:** `/dashboard/disputes/[id]`
- **Steps:** Open a dispute; optionally set status (e.g. UNDER_REVIEW), severity, and assignee; reply in-thread (internal note toggle) → For an orphan dispute, use Attach order/return to link context → Click Make decision: pick outcome (Resolved buyer/seller/split), liabilityParty (SELLER/LOGISTICS/PLATFORM/CUSTOMER/NONE), customerRemedy (FULL_REFUND/PARTIAL_REFUND/NO_REFUND/GOODWILL_CREDIT) → Enter rationale (required) and refund amount in ₹ (required unless NO_REFUND); add courier/AWB if LOGISTICS → Confirm decision
- **Expected:** Dispute moves to RESOLVED_* and, for refund/goodwill remedies, a RefundInstruction is minted (PENDING_APPROVAL) routed to the finance refund queue; liability attribution recorded per ADR-016.
- **Verify:** Backend rejects invalid (outcome × remedy × liability) combos with a clear error; amount required for any non-NO_REFUND remedy; the live 5s poll mirrors customer replies. Cross-check the created refund instruction appears in /dashboard/finance/refund-approvals.

#### [P0] Refund approve/reject — dual-approval queue + goodwill
- **Route:** `/dashboard/finance/refund-approvals`
- **Steps:** Open the queue; use tabs (Pending approval / Needs clarification / All), source filter, overdue-only and goodwill-only toggles → Open an instruction; review the bundled dispute/return context, money (₹ from amountInPaise), method, currency → Click Approve (needs refunds.approve) — high-value/goodwill shows 'First approval recorded'; a second DISTINCT admin must approve to release → Or click Reject (needs refunds.reject), enter an internal reason + optional safe customer-visible message, confirm → Optionally bulk-approve selected PENDING_APPROVAL rows
- **Expected:** Final approval runs the refund saga and credits the customer wallet (status → SUCCESS); first approval of a high-value refund only records firstApprovedBy and shows 'pending second approval'. Reject cancels the instruction and reverses the dispute's liability attribution (or queues an ops task if a debit was already applied).
- **Verify:** The SAME admin cannot provide both approvals (button enforces, API enforces); reject routes the linked dispute BACK to UNDER_REVIEW (see 'routed back' banner + dispute link), so re-decision is possible; goodwill credit posts to wallet as non-withdrawable with an expiry. Cross-check wallet ledger creditType=GOODWILL_CREDIT and expiresAt.

#### [P1] Chargeback ingest + respond (Razorpay disputes)
- **Route:** `/dashboard/payment-ops/chargebacks`
- **Steps:** Open the Chargebacks tab; filter by status (Open/Under review/Won/Lost/Closed) and search by order/payment/dispute id → Identify rows with an evidence deadline (Overdue / Nh left highlighted) → On an OPEN/UNDER_REVIEW row with evidenceStatus PENDING, click 'Mark evidence submitted' (needs chargeback.respond)
- **Expected:** Chargebacks ingested from payment.dispute.* webhooks are listed; marking evidence submitted advances evidenceStatus and is audited; won→RECOVERED, lost→LOST are terminal.
- **Verify:** Confirm a previously-dropped dispute webhook now creates a Chargeback row + a CHARGEBACK_EVIDENCE_DUE admin task; financialImpact is preserved on close; cross-check amount (paise→₹) against the disputed payment.
- ⚠️ **Caveat:** Real Razorpay evidence-API upload is not wired — the button only marks 'evidence submitted' tracking; webhook ingestion depends on the Razorpay webhook reaching the dev API.

#### [P1] Payment-ops mismatch triage (alert transitions)
- **Route:** `/dashboard/payment-ops`
- **Steps:** Review headline metrics (7d attempts, success rate, failures, alerts created) and filter alerts by status/kind/severity + free-text search → Open an alert (/dashboard/payment-ops/[id]); read description, expected vs actual amount, linked gateway attempts → Add triage notes and transition status (OPEN→IN_REVIEW→RESOLVED/IGNORED) — RESOLVED/IGNORED are terminal
- **Expected:** Alert status transitions via CAS (no last-write-wins); resolution notes persisted and transition audited. Metrics summarize gateway attempt success/failure.
- **Verify:** Terminal alerts show no further action buttons; expected≠actual amounts (amount/currency/duplicate/orphan/signature) display correctly in paise→₹; payment ids are masked (click-to-copy). Metrics failure shows a banner, not a blank.

#### [P2] Failed-payments review
- **Route:** `/dashboard/payment-ops/failed-payments`
- **Steps:** Open the Failed payments tab; search by order/payment id/failure reason → Review failed gateway attempts (kind, attempt #, amount, failure reason, time)
- **Expected:** Lists gateway create-order/capture/verify attempts that failed, directly (not only by order drill-down).
- **Verify:** Failure reasons render; amounts paise→₹ correct; masked payment ids copyable. Cross-check a known failed checkout appears here.

#### [P1] Reconciliation run + discrepancy resolution
- **Route:** `/dashboard/reconciliation`
- **Steps:** Start a new reconciliation run (Start run form) → Open a run (/dashboard/reconciliation/[id]); review discrepancies → Assign to self / unassign, move OPEN→Review→Resolve/Ignore per row, or bulk-transition selected rows (ignore needs a reason) → Reopen a resolved discrepancy with a reason; export discrepancies CSV
- **Expected:** Run produces discrepancies; per-row and bulk status transitions persist with assignment + notes; reopen requires a reason; CSV downloads (bearer-gated).
- **Verify:** Terminal rows can't be re-transitioned except via reopen; discrepancy history shows the audit trail; cross-check counts of resolved vs open after a bulk action.

#### [P0] Seller / franchise settlement cycle — approve + mark-paid (UTR)
- **Route:** `/dashboard/finance/settlements`
- **Steps:** Optionally preview then create a settlement cycle (needs settlements.createCycle); cancel a cycle if needed → Open a cycle (/dashboard/finance/settlements/[id]); review per-seller settlement rows + adjustments → Approve the cycle (PATCH .../approve, notes; needs settlements.approve) → On an approved row, Mark paid: enter UTR (8-40 chars, [A-Za-z0-9_-]) + optional method/proof (needs settlements.markPaid) → If the bank reversed it, Mark failed with a reason (≥3 chars)
- **Expected:** Cycle moves PENDING→APPROVED→PAID per row; mark-paid is atomic + CAS (no double-pay) and records UTR; adjustments can be added/voided (void reverses the effect on settlement + cycle totals).
- **Verify:** Invalid UTR is blocked; the same row can't be paid twice (CAS); approved/paid counts on the cycle KPI strip update; cross-check the paid amount against the accounts payable figure and the seller's ledger.

#### [P1] Accounts overview — platform / seller / franchise payables
- **Route:** `/dashboard/accounts`
- **Steps:** Set a date range; switch tabs (Platform / Sellers / Franchises) → Review KPIs: gross commission revenue, platform commissions, tax on commission, seller + franchise payables (pending settlements), refunded-from-commission, affiliate commission paid → Use drill links to seller settlements / franchise settlements / commission records / top performers
- **Expected:** Money KPIs reconcile across tabs; pending payables match the count of pending settlements; drill links land on the matching filtered list.
- **Verify:** Tax-on-commission is shown as GST/VAT (not revenue); refunded-from-commission has a 'bad' tone; cross-check platform payables totals against the settlements module.

#### [P0] Commission view / hold / resume / adjust
- **Route:** `/dashboard/commission`
- **Steps:** Filter commission records (search, date range, status) and review type/rate/admin earning/settlement status → Hold a commission (needs settlements.hold; reason ≥5 chars) → Resume a held commission → Adjust the platform earning (needs settlements.adjustRecord; new value 0..order's platform amount cap, reason ≥3 chars) → View per-record history timeline; export CSV (bearer-gated, warns if truncated)
- **Expected:** Hold/resume flips the commission's hold state; adjust changes adminEarning within the cap and flags the record as adjusted; every action recorded in the history timeline.
- **Verify:** Adjustment above the order's platform amount is rejected client- and server-side; reason-length guards enforced; held commissions are excluded from settlement until resumed; CSV export carries the active filters and warns on truncation.

#### [P1] Seller reversals (B2B / off-platform) approve / reject
- **Route:** `/dashboard/seller-reversals`
- **Steps:** Filter by status; review reversal requests with value (paise→₹) → Approve (needs sellerReversals.approve) — confirm the warning that stock, commission, and a settlement debit will be applied → Or reject with a reason (≥5 chars)
- **Expected:** Approve applies stock restore + commission reversal + a settlement debit against the seller; the customer's order is unaffected. Reject stores the rejection reason.
- **Verify:** Rejected rows show the reason; approved reversals create a settlement debit (cross-check in settlements/liability-ledger) and reverse commission; reason under 5 chars blocked.

#### [P2] Replacements review
- **Route:** `/dashboard/replacements`
- **Steps:** Open Replacements; switch status tabs → Review replacement requests and their state
- **Expected:** Replacement requests are listed and triageable by status tab.
- **Verify:** Cross-check a replacement against its originating order/return.

#### [P1] Discounts / coupons CRUD + lifecycle
- **Route:** `/dashboard/discounts`
- **Steps:** Filter discounts by tab/status; click Create discount and pick a type (routes to /dashboard/discounts/new?type=...) → Fill the discount/coupon form and save (POST /admin/discounts) → Open a discount (/dashboard/discounts/[id]) and use lifecycle controls Pause / Resume / Archive (status FSM endpoint) → Optionally 'Unify affiliate coupons' to migrate legacy affiliate coupons into the discount pipeline
- **Expected:** New discount/coupon created in DRAFT/SCHEDULED/ACTIVE; lifecycle transitions move it through Pause/Resume/Archive; legacy affiliate-coupon unification reports total/unified/skipped/errors and preserves existing redemptions.
- **Verify:** A CODE-type coupon then applies at storefront checkout; pausing/archiving stops new redemptions; cross-check status badge after each transition and the unify summary counts.

#### [P1] RBAC roles — create/edit role + assign permissions
- **Route:** `/dashboard/roles`
- **Steps:** Search/filter roles; click New role (or Edit an existing one) → Set name/description and toggle permissions (module-level select-all or individual permission keys) — payload permissions: [...] → Save (createRole / updateRole) → Activate/deactivate a role (setActive) — deactivation preserves assignments but suspends the role's permissions on next request
- **Expected:** Role saved with the selected permission keys; toggling active changes whether assigned admins hold the permissions on their next request (assignments preserved either way).
- **Verify:** Permission count on the row reflects the selection; deactivating a role removes governed actions (e.g. refunds.approve) from affected admins — verify by re-loading a gated page; reactivating restores them.

#### [P1] Active sessions — revoke single / all-for-actor
- **Route:** `/dashboard/sessions`
- **Steps:** Filter active sessions (by actor UUID, IP, etc.); refresh list → Revoke a single session (needs sessions.revoke) → Or revoke all sessions for an actor (bulk) and confirm the revoked count
- **Expected:** Revoke sets revoked_at so the actor's next token refresh fails and they are forced to re-login; bulk revoke reports how many sessions were killed.
- **Verify:** Revoking an already-revoked session shows 'already revoked' (not a fresh kill); the targeted actor (customer/seller/admin) is logged out on next refresh — needed for incident response.

#### [P2] Audit-log viewing + tamper-chain verification
- **Route:** `/dashboard/audit-logs`
- **Steps:** Filter audit logs and browse entries → Run 'Verify chain (fast)' and 'Verify chain (full)' to check the hash chain integrity → View verification-run history; download a redacted CSV
- **Expected:** Audit entries listed; chain verification returns OK (or flags a break); redacted CSV downloads.
- **Verify:** Chain-verify result reports no break for healthy data; the dev DB logs a benign boot-time AUDIT CHAIN BREAK that should be distinguishable from a real tamper; CSV is redacted mode.

#### [P2] Content + blog publish
- **Route:** `/dashboard/blog-posts`
- **Steps:** Open Blog posts; search; create a post via the form (status VISIBLE/HIDDEN, image upload in edit mode), save (create/update) → Delete a post if needed → In /dashboard/content, add/remove storefront slots and upload/copy/reset slot media per section
- **Expected:** Blog post saved with chosen visibility; VISIBLE posts surface on the storefront, HIDDEN do not; storefront content slots update (unfilled slots fall back to the curated placeholder).
- **Verify:** Toggling a post HIDDEN→VISIBLE makes it appear on the public storefront; deleted posts disappear; a content slot upload reflects on the storefront homepage.

#### [P1] Seller KYC verification decision (approve / reject)
- **Route:** `/dashboard/sellers/approvals`
- **Steps:** Open the approvals queue — lists sellers with verificationStatus=UNDER_REVIEW → Select a seller to read inline KYC (GSTIN/PAN masked, legal name, registration type) → Approve with optional notes (POST /admin/sellers/:id/approve) OR Reject with a required reason (POST /admin/sellers/:id/reject) → Optionally open /dashboard/sellers/[id] to audit GSTIN/PAN + verification status
- **Expected:** Approve flips verificationStatus to APPROVED/VERIFIED (seller can transact); reject stores the reason and moves the seller out of the queue.
- **Verify:** Rejection requires a reason; approved seller disappears from UNDER_REVIEW and can receive routed orders; GSTIN/PAN shown masked. (Note: franchise KYC decisioning is not a dedicated page in this app; the 'verification' route here is COD order-verification triage, separate from seller KYC.)

#### [P1] Order-verification triage (COD risk tray / bulk-approve)
- **Route:** `/dashboard/verification`
- **Steps:** Review queue-stats and claim-next into my-tray (concurrency-safe claim) → Approve (idempotent) or Reject an order in your tray, or Release it back to the queue → Use 'Bulk approve green' to approve all low-risk (green band) orders at once
- **Expected:** Claimed orders move into the reviewer's tray; approve/reject/release update order verification state; bulk-approve-green returns the list of approved ids.
- **Verify:** Idempotency keys prevent double approve/reject; two reviewers can't claim the same order; bulk-approve only touches green-band orders. Cross-check an approved order then routes like a verified order.

---
### D2C Seller (independent direct-to-consumer merchant selling on the SportSmart marketplace)
**App:** `web-d2c-seller`  |  **Port:** 4003

A D2C seller self-registers, verifies email by OTP, submits KYC (legal name, GSTIN/PAN, registered + store address), and waits for admin approval before the account flips ACTIVE/VERIFIED. Once live they create/map products (which enter PENDING_APPROVAL), manage stock and service-area pincodes, then fulfil incoming sub-orders (accept -> pack -> upload 4 shipment-evidence photos -> ship/auto-ship), handle returns and B2B reversals, and track commission, settlements, TDS/TCS, tax invoices and payouts. All `/seller/*` endpoints are scoped to the logged-in seller via SellerAuthGuard, and the X-Seller-Type=D2C header pins the seller type server-side.

#### [P0] Seller registration + email OTP verification
- **Route:** `/register`
- **Steps:** Open /register and fill seller name, shop name, email, 10-digit phone, password+confirm → Tick Terms + Privacy consents (Marketing optional); submit (CAPTCHA only if NEXT_PUBLIC_CAPTCHA_PROVIDER != disabled) → POST /seller/auth/register fires; you are redirected to /register/verify?email=... → Enter the 6-digit OTP emailed to you (use Resend if needed) -> POST /seller/auth/verify-email → On success the email is marked verified and you can log in at /login
- **Expected:** Account is created in an unverified state, an OTP email is sent (verificationEmailSent flag), and after entering the code the email flips to verified. Duplicate email/phone returns a generic 409 (no account-existence leak).
- **Verify:** Register response shape is uniform for fresh vs duplicate; verify page shows a resend prompt if verificationEmailSent=false; after verify, login succeeds where it was blocked before (closes the 'login while unverified' loophole).
- ⚠️ **Caveat:** Email OTP delivery depends on the dev mail transport being configured; if email is stubbed, read the OTP from API logs/mail catcher. CAPTCHA is disabled by default in dev.

#### [P0] Login + cookie session
- **Route:** `/login`
- **Steps:** Go to /login, enter identifier (email or phone) + password → Submit -> POST /seller/auth/login → Dashboard mounts and validates the session via GET /seller/auth/me → Land on /dashboard (or onboarding if not yet approved)
- **Expected:** Login sets the httpOnly sm_access_seller/sm_refresh_seller cookies; /seller/auth/me returns sellerId, status, verificationStatus, isEmailVerified, sellerType=D2C.
- **Verify:** Session survives reload via cookie (sessionStorage Bearer is only a transitional fallback); an unverified-email account cannot reach the dashboard; logout?all=true revokes every SellerSession.

#### [P0] Onboarding KYC submit (business details, GSTIN, PAN, addresses)
- **Route:** `/dashboard/onboarding`
- **Steps:** After email verify, the wizard shows Step 2 'Submit KYC' → Enter legal business name, GST registration type (REGULAR/COMPOSITION/CASUAL), GSTIN, 2-digit GST state code, PAN, registered business address, store/pickup address + pincode → Tick the accuracy confirmation; client validates GSTIN regex, PAN regex, and that GSTIN positions 3-12 equal the PAN → Submit -> POST /seller/onboarding/submit; verificationStatus transitions NOT_VERIFIED/REJECTED -> UNDER_REVIEW → Step 3 'Await approval' shows a read-only submission summary (PAN masked to last-4)
- **Expected:** Profile moves to UNDER_REVIEW; the seller cannot self-approve. If admin REJECTS, the reason (kycRejectionReason) shows and the form reopens pre-filled for resubmit. On approval (status=ACTIVE + verificationStatus=VERIFIED) the page auto-redirects to /dashboard/onboarding/first-listing.
- **Verify:** GSTIN/PAN cross-check enforced client-side; UNREGISTERED is blocked for new submissions (GSTIN mandatory); a 'DRAFT - not for ITC' banner warns that tax docs/GSTR use these fields only after an admin marks them verified.
- ⚠️ **Caveat:** GSTIN verification is a Mod-36 well-formedness checksum only in dev (GstnProvider is a stub; sandbox adapter not wired) - it confirms format, not real GSTN registration. Admin approval is a separate manual step (use the admin app) before the seller can transact.

#### [P0] First-listing wizard + add bank details (payout setup)
- **Route:** `/dashboard/onboarding/first-listing`
- **Steps:** Lands here after approval; shows 3 cards: add bank details, list first product, enable delivery → Click 'Add bank details' (links to /dashboard/profile?tab=bank) → Intended: enter account number / IFSC and save (PATCH /seller/bank-details, AES-256-GCM encrypted at rest) → List first product via /dashboard/products/new; enable Self-delivery via /dashboard/profile/delivery
- **Expected:** hasBankDetails / hasFirstProduct / hasDeliveryMethod flags drive the green 'done' state on each card; once all three are set and the wizard is dismissed, future logins skip straight to /dashboard.
- **Verify:** Bank account is stored encrypted (accountNumberEnc) and required before the first settlement can pay out.
- ⚠️ **Caveat:** MAJOR GAP: there is NO bank-account UI in the D2C frontend - the wizard deep-links to /dashboard/profile?tab=bank and /dashboard/profile/delivery, but the profile page has no bank tab and the /profile/delivery route does not exist. Bank details can only be set by calling PATCH /seller/bank-details directly. Also, writes are gated on SELLER_BANK_ENCRYPTION_KEY: if it is unset in dev the API throws 400 'Bank-details encryption is not configured', so payouts are blocked until the key + a bank account exist.

#### [P0] Create product (variants, price, HSN, submit for approval)
- **Route:** `/dashboard/products/new`
- **Steps:** Fill title, category, brand, descriptions, base price, stock, SKU; optionally generate copy with the AI button → Set tax/GST fields: HSN code, GST rate (bps), supplyTaxability, cess, UQC, tax-inclusive toggle → Optionally enable variants and generate them; add images on the edit screen → Click 'Save as draft' (POST /seller/products) OR 'Save & submit for review' (also POST /seller/products/:id/submit)
- **Expected:** Draft creation returns a product in DRAFT; 'Submit for review' transitions moderationStatus to PENDING_APPROVAL and the SKU mapping goes live only after admin approval (toast confirms). Backend re-checks the seller is ACTIVE + email-verified and 403s otherwise.
- **Verify:** Product appears in /dashboard/products with the right moderation badge; rejection surfaces rejectionReason, changes surface changeRequestNote; tax fields persist and stamp tax_config_updated_by/at only when at least one tax field is sent.
- ⚠️ **Caveat:** Going live requires admin catalog approval (separate admin app). HSN/GST values only flow to invoices/GSTR after admin verifies the seller's tax config.

#### [P1] Edit product, manage variants and images, publish/pause
- **Route:** `/dashboard/products/[id]/edit`
- **Steps:** Open a product, edit fields or variants (PATCH /seller/products/:id, variants bulk/individual PATCH) → Upload/reorder/delete product and per-variant images (multipart POST) → Resubmit for review after changes if it was rejected/changes-requested → Use self-status to toggle a live product ACTIVE <-> SUSPENDED (PATCH /seller/products/:id/self-status)
- **Expected:** Edits persist; re-submitting re-enters PENDING_APPROVAL; self-suspend pauses sales without admin involvement; images upload via Cloudinary.
- **Verify:** statusHistory rows record fromStatus->toStatus with reason; variant stock/price changes reflect in inventory and catalog views.

#### [P1] Catalog browse + map master product to seller listing
- **Route:** `/dashboard/catalog`
- **Steps:** Browse the master catalog (GET /seller/catalog/browse) and search → Click 'Map' on a product; enter stock qty, pickup pincode, dispatch SLA (days), internal SKU → For multi-variant products, set per-variant stock → Submit -> POST /seller/catalog/map
- **Expected:** A seller-product mapping is created and (after admin approval) becomes APPROVED+active so it is sellable; pickup pincode/SLA feed serviceability.
- **Verify:** Mapped items appear under /dashboard/catalog/my-products; POS/checkout only sells APPROVED+active mappings; pausing a mapping (POST .../pause) sets STOPPED+isActive=false and releases reservations (re-activation needs admin re-approval).

#### [P1] Inventory stock update
- **Route:** `/dashboard/inventory`
- **Steps:** Open Inventory; view overview (total/reserved/available, low-stock, out-of-stock counts) → Filter Low-stock / Out-of-stock lists → Adjust a mapping's stock by a delta -> POST /seller/catalog/mapping/:id/adjust-stock (or bulk-stock PATCH)
- **Expected:** stockQty updates and availableStock = stockQty - reservedQty recomputes immediately; low/out-of-stock counts refresh.
- **Verify:** A sale on a mapped SKU decrements stock/reserves under lock (oversell-guarded server-side); adjustment returns the new stockQty/reservedQty/availableStock.

#### [P2] Service-areas + COD serviceability config
- **Route:** `/dashboard/service-areas`
- **Steps:** View serviceable pincodes; click Add and paste 6-digit pincodes (comma/space/newline separated) → Submit -> POST /seller/service-areas (invalid pincodes filtered client-side) → Toggle per-pincode COD eligibility -> PATCH /seller/service-areas/:pincode/cod → Remove a pincode -> DELETE /seller/service-areas/:pincode
- **Expected:** Added pincodes become serviceable for this seller; COD shows at checkout only for pincodes flagged cod_eligible=true; others get ONLINE-only.
- **Verify:** List reflects added/removed pincodes; the COD toggle persists per row and changes the checkout payment options for that destination pincode.

#### [P0] Incoming order: accept / reject within deadline
- **Route:** `/dashboard/orders/[id]`
- **Steps:** Open an OPEN sub-order; a live acceptance-deadline countdown is shown → Click ACCEPT ORDER, optionally set expected dispatch date -> PATCH /seller/orders/:id/accept → Or click REJECT ORDER, pick a reason (OUT_OF_STOCK/CANNOT_SHIP/LOCATION_ISSUE/OTHER) + note -> PATCH /seller/orders/:id/reject
- **Expected:** Accept moves acceptStatus OPEN->ACCEPTED; reject moves it to REJECTED (reason/note shown) and the order is reassigned. If the deadline expires it auto-rejects.
- **Verify:** Countdown turns urgent under 2h and shows 'DEADLINE EXPIRED - Auto-rejecting' at zero; accepted orders expose pack/ship actions; payment + fulfillment badges update.

#### [P0] Fulfil order: pack + upload shipment evidence + mark shipped
- **Route:** `/dashboard/orders/[id]`
- **Steps:** On an ACCEPTED/UNFULFILLED order, upload 4 dispatch photos in Shipment Evidence (POST /seller/sub-orders/:id/shipment-evidence) → Click MARK AS PACKED -> PATCH /seller/orders/:id/status {status:PACKED} → For self-ship: click MARK AS SHIPPED, enter tracking number + courier -> PATCH .../status {status:SHIPPED, trackingNumber, courierName} → For Delhivery: it auto-ships on PACK; use Request Delhivery pickup + Download shipping label
- **Expected:** Mark-as-Packed/Shipped is hard-blocked until 4 shipment-evidence photos exist (SHIPMENT_EVIDENCE_REQUIRED=4, enforced client + server). Self-ship sets SHIPPED with tracking; Delhivery books the courier + AWB automatically on PACK.
- **Verify:** Evidence counter shows N/4 and unlocks the ship button at 4; SHIPPED state shows 'Delivery will be confirmed by admin'; the 4 photos become the admin's as-shipped baseline for return/damage claims.
- ⚠️ **Caveat:** Delhivery seller-side is assigned upstream (the picker only offers SELF_DELIVERY; entitlement selfDeliveryEnabled gates it). The tracking webhook is Shiprocket-shaped (/shipping tracking-webhook), so a Delhivery shipment will NOT auto-advance to DELIVERED - an admin marks delivery manually. The Download-label call can legitimately return empty right after booking (carrier propagation).

#### [P1] Self-delivery status progression
- **Route:** `/dashboard/orders/[id]`
- **Steps:** On a SELF_DELIVERY sub-order, use the status buttons (POST /seller/sub-orders/:id/self-delivery/status) → Advance PENDING -> READY_FOR_PICKUP -> OUT_FOR_DELIVERY -> DELIVERED (or FAILED/CANCELLED)
- **Expected:** Each transition updates selfDeliveryStatus and the sub-order fulfillmentStatus; reaching DELIVERED stamps selfDeliveredAt and surfaces the delivery/commission card.
- **Verify:** FSM rejects illegal jumps; DELIVERED enables the return-window and the B2B reversal action.

#### [P1] Returns handling: mark received, upload QC evidence, accept/contest, escalate
- **Route:** `/dashboard/returns/[returnId]`
- **Steps:** Open a return; when goods arrive click Mark received -> PATCH /seller/returns/:id/mark-received → Upload QC evidence photos -> POST /seller/returns/:id/qc-evidence → If the return alleges seller fault and is PENDING, choose Accept or Contest (notes required to contest) -> PATCH /seller/returns/:id/respond → If past the response window, escalate to a formal dispute
- **Expected:** Return moves to RECEIVED; evidence is attached; the seller can ACCEPT or CONTEST within the response window; QC approval/refund is decided by admin (QC_APPROVED/QC_REJECTED/PARTIALLY_APPROVED).
- **Verify:** Respond is allowed only in PENDING and not >1h past due; there is NO seller QC-decision endpoint (QC is admin-only by design); refundAmount/qcOutcome appear after admin QC.
- ⚠️ **Caveat:** The seller cannot approve a return/QC itself - it only marks-received, uploads evidence, and accepts/contests. The actual approve+refund is an admin action.

#### [P1] Seller-initiated B2B reversal (off-platform return)
- **Route:** `/dashboard/orders/[id]`
- **Steps:** On a DELIVERED sub-order, open the B2B/off-platform reversal panel → Select items + quantities (capped at delivered minus prior customer returns) and enter a reason (>=5 chars) → Confirm the danger dialog -> POST /seller/reversals {subOrderId, reason, items} → Track it under /dashboard/reversals (cancel while PENDING_APPROVAL via PATCH /seller/reversals/:id/cancel)
- **Expected:** A reversal request is created PENDING_APPROVAL; nothing changes until an admin approves. On approval, stock is restored, the sub-order is adjusted, and commission/settlement (refundedAdminEarning) are reversed. It does NOT create a customer-facing Return.
- **Verify:** Quantity cannot exceed delivered qty; reversal value (reversalValueInPaise) and item lines show on /dashboard/reversals; cancel is only allowed in PENDING_APPROVAL.

#### [P1] Commission statement view
- **Route:** `/dashboard/commission`
- **Steps:** Open Commission; view per-order-item commission records (platform price, settlement price, margin, status) → View settlement records with TCS/TDS/commission-GST deduction snapshots and UTR → Page through records
- **Expected:** Each delivered item shows productEarning, platformMargin, adminEarning and commission status; settlements roll these into a payout with statutory deductions (paise as decimal strings).
- **Verify:** Reversed/refunded items show refundedAdminEarning; settlement deductions (TCS §52, TDS §194-O, commission GST CGST/SGST or IGST) reconcile; paid settlements carry a UTR + paidAt.

#### [P1] Accounts: finances overview + payouts/settlements
- **Route:** `/dashboard/accounts`
- **Steps:** Open My finances; pick a date range → Review KPIs: net revenue, platform margin, pending/overdue payable, paid-to-you, TDS, TCS, refunds, adjustments (GET /seller/accounts/overview) → Switch to Commission records / Settlements tabs and page through (GET /seller/accounts/commission-records, /settlements)
- **Expected:** Overview shows gross-minus-refunds net revenue, what the platform owes (pendingAmount), overdue past-SLA exposure, and last settled date; settlements list UTR, payout due-by, failure reason, and paid date.
- **Verify:** Money is exact 2-decimal rupee strings (formatINR, never math-parsed); data is scoped to this seller only (req.sellerId server-side); a payout reflects commission earned minus statutory deductions.
- ⚠️ **Caveat:** Settlements only pay out once bank details exist AND SELLER_BANK_ENCRYPTION_KEY is configured; otherwise payable stays pending. Overview composes several endpoints, so a missing one degrades a KPI rather than 500ing.

#### [P2] Tax: GSTIN/tax documents + TCS certificates
- **Route:** `/dashboard/tax`
- **Steps:** Open Tax; view your submitted GSTIN/PAN identity (read-only) → Go to /dashboard/tax/invoices: list tax documents (GET /seller/tax-documents), download a doc (GET .../:id/download returns a signed URL) → Go to /dashboard/tax/tcs: view §52 TCS summary per filing period and open §52(5) certificates
- **Expected:** Tax documents list per sub-order with type, FY, totals (paise strings), IRN/e-invoice status; downloads open the signed PDF; TCS rows show gross/net taxable supply and collected TCS, and issued certificates open as HTML.
- **Verify:** Documents generated before admin GST verification carry a 'DRAFT - not for ITC' banner; certificate open is auth'd (Bearer + X-Seller-Type) and 403/404 are handled.
- ⚠️ **Caveat:** E-invoicing/IRN uses a NIC stub in dev; tax fields only become 'real' (used on GSTR filings) after admin verifies the seller's GST config.

#### [P2] Analytics dashboard
- **Route:** `/dashboard/analytics`
- **Steps:** Open Analytics; it composes from existing endpoints (earnings summary, orders, products, returns) → Review all-time KPIs (total earned, pending settlement, catalogue size, return rate) and the fulfillment-status mix / payment split / weekly trend over recent orders
- **Expected:** KPIs render from /seller/earnings/summary + pagination totals; the mix/trend is computed over the most recent batch (RECENT_LIMIT=200).
- **Verify:** Numbers reconcile with the Orders, Products and Returns lists; failed sub-fetches degrade a card to '-' rather than breaking the page.
- ⚠️ **Caveat:** No dedicated seller-analytics backend endpoint exists yet; this is a client-side composition, so trend/mix reflect only the most recent 200 orders, not full history.

#### [P2] Support ticketing
- **Route:** `/dashboard/support`
- **Steps:** Open Support; click New (GET /seller/support/categories for the category list) → Create a ticket: subject, body, priority, optional related order/return -> POST /seller/support/tickets → Open a ticket, reply (POST .../messages), and Close when resolved (POST .../close)
- **Expected:** Ticket is created OPEN with a ticketNumber; replies append messages; admin replies move it through IN_PROGRESS / WAITING_ON_CUSTOMER / RESOLVED; seller can close.
- **Verify:** Status labels/colors match the enum; WAITING_ON_CUSTOMER prompts the seller to reply; closing sets closedAt.

#### [P2] Profile management + password change
- **Route:** `/dashboard/profile`
- **Steps:** Open Profile; edit contact/address/store description/policy (PATCH /seller/profile) → Upload/remove profile image and shop logo (multipart PATCH/DELETE) → Change password (current + new + confirm -> POST /seller/profile/change-password)
- **Expected:** Editable fields save and bump profileCompletionPercentage; media uploads return new URLs; password change succeeds with correct current password.
- **Verify:** GSTIN/PAN are read-only (PAN masked to last-4); editing is restricted while status is SUSPENDED/INACTIVE; logisticsLocked freezes pickup/identity fields once registered with a courier.
- ⚠️ **Caveat:** Media upload requires ACTIVE status; the profile page has NO bank-details tab despite the first-listing wizard linking to ?tab=bank.

#### [P2] Admin impersonation handoff
- **Route:** `/impersonate`
- **Steps:** Arrive via an admin-generated link carrying token+data in the URL fragment (#) → The page parses the fragment, stores accessToken + seller + impersonated=true in sessionStorage, strips the hash, and redirects to /dashboard
- **Expected:** An admin can view the seller dashboard as the seller; the impersonated flag is set and the token never persists in history (hash stripped).
- **Verify:** Invalid/missing token shows 'Invalid impersonation link'; certain actions are blocked-while-impersonating server-side (e.g. bank-details writes).
- ⚠️ **Caveat:** Only reachable with a valid admin-signed impersonation token; not a self-service seller flow.

---
### D2C Seller-Side Admin (platform governance team that approves/moderates D2C sellers, their products, returns, KYC, and commission)
**App:** `web-d2c-seller-admin`  |  **Port:** 4001

This app is the platform team's console for governing D2C sellers: approving/suspending seller accounts, moderating the product catalog (approve/reject/request-changes + seller-mapping approvals), overseeing the returns/QC/refund pipeline, making KYC/verification decisions, and configuring platform commission and settlements. It is hard-scoped to D2C: api-client sends X-Seller-Type: D2C and the seller-list query appends sellerType=D2C, but the authoritative boundary is the backend AdminSellerScopeGuard, which resolves the admin's seller-type scope from their permissions (sellers.scope.d2c) — a forged header won't bypass it. A D2C-scoped admin must never see RETAIL sellers/products/orders/returns; an out-of-scope seller id returns 404 (not 403) so its existence can't even be confirmed. Note: the sidebar "Verification" tab is ORDER fraud/risk verification, NOT seller KYC — seller KYC lives on the seller detail page.

#### [P0] Admin login (password + optional MFA)
- **Route:** `/login`
- **Steps:** Open http://localhost:4001 — unauthenticated visit redirects to /login → Enter a D2C-scoped admin email + password (min 8 chars) and click Sign in → If the admin has MFA enrolled, the form swaps to a TOTP/backup-code box; enter the 6-digit authenticator code (or click 'Email me a code instead' for an email OTP) and click Verify and sign in → Land on /dashboard with the sidebar (Sellers, Products, Verification, Returns, Commission, etc.)
- **Expected:** Successful login stores adminAccessToken/refreshToken/admin in sessionStorage and routes to /dashboard. Wrong password shows an inline 401 'Invalid credentials' and clears the password; an inactive account shows a 403 info message.
- **Verify:** After login the navbar badge reads 'D2C SELLER ADMIN'. Tokens are in sessionStorage under adminAccessToken. MFA challenge shows a live countdown and expires (403 → back to password). Logout (user menu → Sign Out) clears sessionStorage and returns to /login; reloading a dashboard route with no token redirects to /login.

#### [P0] Seller list filtered to D2C only (scope boundary)
- **Route:** `/dashboard/sellers`
- **Steps:** Click Sellers in the sidebar → Observe the seller table and the header count (total) → Use the Status filter (Active / Pending Approval / Suspended / etc.), Verification filter, and the search box (name/email/phone/shop) → Cross-check against a known RETAIL seller's name/email by typing it into search
- **Expected:** Only D2C sellers appear. listSellers appends sellerType=D2C and the backend AdminSellerScopeGuard/list filter restricts results from the admin's sellers.scope.d2c permission. A RETAIL seller must NOT appear in the list or in search results, and the count reflects D2C-only.
- **Verify:** Searching a RETAIL seller's exact email returns no rows. Directly navigating to /dashboard/sellers/<retailSellerId> returns a 'Seller not found' / load error (backend 404, not 403) — the D2C admin cannot confirm the RETAIL seller exists. A SUPER_ADMIN (holds both scopes) by contrast would see all sellers — useful as a contrast check.

#### [P0] Seller KYC / verification decision (Approve & Verify or Reject)
- **Route:** `/dashboard/sellers/[sellerId]`
- **Steps:** Open a seller whose verification status is UNDER_REVIEW (they submitted GSTIN+PAN via onboarding) → Click the '✓ Verify KYC' action button (only shown when verificationStatus === UNDER_REVIEW and role is SUPER_ADMIN/SELLER_ADMIN) → Review the Submitted KYC block (legal business name, GSTIN, GST state code, PAN last-4 masked) → To approve: optionally add approval notes, click 'Approve & Verify' (POST /admin/sellers/:id/approve) → To reject instead: type a rejection reason (min 10 chars, shown to the seller) and click 'Reject KYC' (POST /admin/sellers/:id/reject)
- **Expected:** Approve sets the seller to ACTIVE + VERIFIED (backend requires GSTIN+PAN on file or it 400s). Reject sends the seller back with the visible reason and flips verification to REJECTED. The detail page refetches and the verification badge updates.
- **Verify:** After approve, the verification badge reads VERIFIED and status ACTIVE; the '✓ Verify KYC' button disappears (no longer UNDER_REVIEW). Approving a seller with no GSTIN/PAN is rejected server-side. The seller list verification filter VERIFIED now includes this seller. Reject reason appears on the seller's own onboarding view. The raw VerificationModal override is distinct — KYC approve/reject is the GSTIN/PAN-gated path.

#### [P0] Seller approval / suspension (status change)
- **Route:** `/dashboard/sellers (row action) or /dashboard/sellers/[sellerId]`
- **Steps:** From the seller list row action menu choose 'Edit Status' (or 'Change Status' on the detail page) → In the modal pick a new status from the allowed transitions (e.g. PENDING_APPROVAL→ACTIVE to approve, ACTIVE→SUSPENDED to suspend) → Optionally add a reason (max 500 chars) and click Update Status (PATCH /admin/sellers/:id/status) → To halt a suspended seller's fulfillment, on the detail page click 'Suspend all mappings' (confirm dialog)
- **Expected:** Status transitions follow the allowed matrix (PENDING_APPROVAL→ACTIVE/DEACTIVATED; ACTIVE→INACTIVE/SUSPENDED/DEACTIVATED; SUSPENDED→ACTIVE/DEACTIVATED, etc.). The list/detail refetch and the status badge updates. Suspend-all-mappings hides the seller's product mappings from allocation.
- **Verify:** A suspended seller's badge reads SUSPENDED; their products should stop being allocatable (cross-check on the customer storefront — a SUSPENDED seller's listings drop out). Approving a PENDING_APPROVAL seller flips them ACTIVE. Attempting a status change on a RETAIL seller id 404s (scope guard). 'Re-activate all' restores suspended mappings.

#### [P0] Product approval queue — approve / reject (with reason) / request changes
- **Route:** `/dashboard/products`
- **Steps:** Click Products, then the 'Pending Review' quick-filter tab (moderationStatus=PENDING) → On a submitted product use the row action menu: Approve (PATCH /admin/products/:id/approve) → Or choose Reject → enter a reason in the modal (PATCH /admin/products/:id/reject) → Or choose Request Changes → enter a note (PATCH /admin/products/:id/request-changes) → Switch to the 'Active' tab to confirm the approved product moved out of the queue
- **Expected:** Approve flips moderation to APPROVED and (once active) makes the product live; Reject sets REJECTED with the reason; Request Changes sets CHANGES_REQUESTED with the note. The list refetches and the product leaves Pending Review.
- **Verify:** An APPROVED + ACTIVE product becomes visible to customers (cross-check the customer-facing storefront search/PLP — it should now appear). Rejected/changes-requested products are NOT customer-visible and the reason/note surfaces in the seller's own product view. A 'Tax: unverified' pill stays until tax config is attested (separate finance signoff). Crucially: only products belonging to D2C sellers appear — a RETAIL seller's product must NOT show in this queue (entity seller-scope filter).

#### [P1] Pending seller-mapping approvals (approve / stop, batch from queue)
- **Route:** `/dashboard/products (Pending Seller Approvals tab)`
- **Steps:** On Products click the 'Pending Seller Approvals' tab (badge shows pending count; same count badges the sidebar Products item) → Review each row (product, seller, internal SKU, stock) → Click Approve (POST /admin/seller-mappings/:id/approve) to let the seller fulfill that product, or Stop (POST /admin/seller-mappings/:id/stop) to reject the mapping → Repeat across rows to clear the queue
- **Expected:** Approve activates the seller-product mapping (seller can now be allocated orders for it); Stop removes/halts it. The row disappears and the pending badge decrements on both the tab and the sidebar.
- **Verify:** After approving a mapping, the product's inventory panel (expand the product card) shows that seller as an active source with stock/available. The sidebar Products badge and tab badge both drop by one. Only D2C sellers' mappings appear here. Stopped mappings no longer participate in allocation.

#### [P2] Product tax-config attestation (verify / bulk)
- **Route:** `/dashboard/products and /dashboard/products/bulk-tax-config`
- **Steps:** Identify a product showing the 'Tax: unverified' pill → Open the product edit page, confirm HSN code / GST rate / supply taxability, then verify the tax config (PATCH /admin/products/:id/verify-tax-config) → For many products at once, open 'Bulk tax config', filter (e.g. missing HSN only / by category) and apply an HSN/GST/UQC update (POST /admin/products/bulk/tax-config)
- **Expected:** Verifying flips taxConfigVerified=true and records verifiedAt/verifiedBy; the 'Tax: unverified' pill clears. Bulk update returns a count of updated products. Editing any tax field afterward auto-resets the attestation to unverified.
- **Verify:** The pill disappears on verified products and reappears if a tax field is later edited. STRICT-mode invoicing should gate on taxConfigVerified. Bulk operation count matches the filtered set; spot-check a couple of products show the new HSN/GST.

#### [P0] Returns oversight + QC/refund pipeline
- **Route:** `/dashboard/returns and /dashboard/returns/[returnId]`
- **Steps:** Click Returns; review the analytics summary and the list; filter by status and by fulfillment node type (set node-type filter to SELLER to see seller-fulfilled returns) → Open a REQUESTED return; Approve (with notes) or Reject (with reason) → Walk an approved return through: Schedule Pickup → Mark In Transit → Mark Received → upload QC evidence → Submit QC decision (per-item APPROVED/REJECTED/PARTIAL/DAMAGED with approved qty) → Initiate refund, then Confirm refund with a UTR/reference + method (or Mark refund failed / Retry), and Close the return
- **Expected:** The status advances through the FSM (REQUESTED→APPROVED→PICKUP_SCHEDULED→IN_TRANSIT→RECEIVED→QC_APPROVED/PARTIALLY_APPROVED→REFUND_PROCESSING→REFUNDED→COMPLETED). Refund amount derives from QC-approved quantities; the status history records each transition with actor.
- **Verify:** Refund amount matches the QC-approved item totals (not the full requested qty for PARTIAL/DAMAGED). The creditNoteEligibility preview warns if the return is TIME_BARRED before QC. Confirmed refund shows the UTR/reference and REFUNDED status; the customer's return view and any wallet/original-payment refund reflect it. Scope check: only returns whose sub-order is a D2C seller node appear — a RETAIL-fulfilled return must NOT be listed (mixed-cart orders are shared by design, so confirm the specific sub-order is D2C).

#### [P1] Commission rate configuration (global)
- **Route:** `/dashboard/commission/settings`
- **Steps:** Click Commission, then 'Commission settings' → Choose a commission type (% / FIXED / % + FIXED / FIXED + %) and enter the primary value (and second value + fixed-commission-type Product/Order for combo types) → Optionally toggle 'Enable maximum commission' and set a per-seller-per-order cap → Click SAVE (PUT /admin/commission/settings)
- **Expected:** Settings persist and a green 'Commission settings saved successfully' banner shows. The chosen type/value drive how platform commission is computed on future delivered orders.
- **Verify:** Reload the page — values persist from GET /admin/commission/settings. Place/deliver a test D2C order afterward and confirm the commission record on /dashboard/commission Records reflects the new rate (commissionType/commissionRate, platform margin). The max-commission cap clamps the per-order commission when enabled.

#### [P1] Commission records, per-record adjust, and settlement cycle → mark paid
- **Route:** `/dashboard/commission`
- **Steps:** On the Records tab, filter by date/status/search and review platform price, settlement price, and platform margin per order item; open a row's History for the audit trail → For a non-SETTLED/non-REFUNDED record, adjust the platform earning with a required reason (PATCH /admin/commission/:id/adjust) → Switch to Settlement cycles, create a cycle for a period (POST create-cycle), open it, Approve it, then per seller-settlement click Mark Paid and enter a UTR (PATCH /admin/settlements/:id/mark-paid) → Open the Reconciliation tab to confirm platform revenue vs seller settlements balance
- **Expected:** Records show correct margin (platform − settlement). Adjust writes an audited override and refreshes history. A cycle goes DRAFT/PREVIEWED→APPROVED; marking a seller settlement Paid records the UTR and sets it PAID. Reconciliation shows 'All Reconciled' or lists mismatches.
- **Verify:** The margin summary cards (revenue / payouts / margin / pending) update after creating a cycle. A paid settlement shows the UTR and PAID badge and can't be paid twice. The adjust modal is disabled for SETTLED/REFUNDED records. Reconciliation mismatch list is empty when delivered-items count equals commission-records count. CSV export downloads (warns if capped at 50k rows). All sellers shown are D2C only.

---
### RETAIL Seller + RETAIL Seller-Admin (marketplace retail-channel seller and its scoped admin/ops console)
**App:** `web-retail-seller (portal), web-retail-seller-admin (admin)`  |  **Port:** 4009 (seller portal), 4008 (seller-admin)

The RETAIL seller portal (4009) is the seller-facing app for marketplace RETAIL-channel sellers: register/onboard with KYC, map/list products from the master catalog, manage inventory & service-areas, accept/ship sub-orders, handle returns, and view payouts. The retail-seller-admin (4008) is the back-office console where staff onboard/approve RETAIL sellers, approve products & seller catalog mappings, oversee orders/returns/refunds, configure routing/commission/storefront, and run Delhivery ops tools. Both apps are byte-near clones of their D2C twins — the only baked-in difference is api-client SELLER_TYPE='RETAIL' + the X-Seller-Type:RETAIL header; the AUTHORITATIVE RETAIL scope boundary is enforced server-side by the admin's `sellers.scope.retail` permission (AdminSellerScopeGuard), NOT by the forgeable header. Most seller-portal flows are pure parity with D2C; the RETAIL-specific value to test is the admin scope isolation (RETAIL admin must never see/act on D2C sellers — out-of-scope returns 404, not 403).

#### [P0] Seller register + email-OTP verify (RETAIL parity with D2C)
- **Route:** `http://localhost:4009/register`
- **Steps:** Open /register; fill Seller Name, Shop Name, email, 10-digit Indian mobile, password (meets all 5 strength rules), confirm password → Tick Terms + Privacy consents (Marketing optional); complete captcha only if NEXT_PUBLIC_CAPTCHA_PROVIDER is set (default 'disabled' = no captcha) → Submit -> redirected to /register/verify?email=... → Read the 6-digit OTP from the API/email-stub log, enter it, submit → Land on login or dashboard once verified
- **Expected:** Account is created as a RETAIL seller (X-Seller-Type:RETAIL on every request, SELLER_TYPE in body); verify page accepts the OTP and marks email verified.
- **Verify:** New row appears in the RETAIL admin Sellers list (4008) but NOT in the D2C admin. 409 on duplicate email/phone shows 'already exists, sign in'. Confirm the seller record carries sellerType=RETAIL.
- ⚠️ **Caveat:** Email OTP delivery is a dev stub — read the code from API logs, not a real inbox. Captcha defaults to disabled in dev.

#### [P0] Seller KYC onboarding wizard (email -> KYC submit -> await admin)
- **Route:** `http://localhost:4009/dashboard/onboarding`
- **Steps:** Step 1: if email unverified, resend/enter OTP (POST /seller/profile/verify-email/verify) → Step 2: fill Legal business name, GST type (REGULAR/COMPOSITION/CASUAL — UNREGISTERED removed), GSTIN (15-char, positions 3-12 must equal PAN), GST state code (2-digit), PAN, registered business address + store/pickup address with 6-digit pincodes → Tick the accuracy confirmation, Submit for review (POST /seller/onboarding/submit) → Step 3: page flips to 'Awaiting admin review' (verificationStatus=UNDER_REVIEW) with a read-only summary (PAN masked to last 4) → After admin approves, reload -> auto-redirect to /dashboard/onboarding/first-listing
- **Expected:** Client-side validation blocks bad GSTIN/PAN/pincode; on submit verificationStatus -> UNDER_REVIEW and the blue banner warns GST fields are admin-verified before invoices use them (DRAFT-not-for-ITC until verified).
- **Verify:** Submission appears as UNDER_REVIEW in RETAIL admin Sellers filter. On admin REJECT, seller sees the rejection reason and an editable re-submit form. On admin VERIFIED+ACTIVE, the onboarding redirects to first-listing. PAN never returned in full.
- ⚠️ **Caveat:** GSTIN is validated by regex/PAN-cross-check only; live GSTN portal verification is a stub. No KYC document upload sub-system exists (deferred).

#### [P0] Seller catalog mapping + product create/submit (parity with D2C)
- **Route:** `http://localhost:4009/dashboard/catalog`
- **Steps:** Browse master catalog (/seller/catalog/browse), map a master variant to your inventory with stock + internal SKU (POST /seller/catalog/map) — mapping starts PENDING → Alternatively create an own product at /dashboard/products/new, add images/variants, then Submit (POST /seller/products/:id/submit) → Set stock via /dashboard/inventory (bulk-stock) and per-variant low-stock thresholds → Watch status badges move DRAFT/SUBMITTED -> APPROVED/ACTIVE once admin acts
- **Expected:** A new seller catalog mapping is created in PENDING state; a submitted product moves to SUBMITTED/PENDING moderation. Neither is sellable until the RETAIL admin approves.
- **Verify:** The pending mapping shows under RETAIL admin Products -> 'Pending Seller Approvals' tab (and the sidebar Products badge increments). After admin Approve, mapping -> APPROVED and the product becomes purchasable. Tax-config-unverified products show a 'Tax: unverified' pill.
- ⚠️ **Caveat:** RETAIL admin only sees this seller's mappings because it is a RETAIL seller — a D2C admin would not see it.

#### [P0] Seller accept/ship sub-orders + reject (parity)
- **Route:** `http://localhost:4009/dashboard/orders`
- **Steps:** Open Orders; filter by fulfillment/acceptance status (GET /seller/orders) → On a PLACED sub-order click Accept (POST /seller/orders/:subOrderId/accept) — UI optimistically flips status then refetches → Mark subsequent fulfillment steps (e.g. ready-to-ship) via the row action → Or Reject a sub-order with a reason (POST /seller/orders/:subOrderId/reject) — triggers auto-reallocation
- **Expected:** Accept transitions the sub-order and persists after the refetch (no 'click didn't take' regression); Reject releases the line for reallocation to another node.
- **Verify:** The same sub-order's status change is reflected in RETAIL admin Orders and in the routing engine (a rejected line shows as a reassignment in Routing -> Health). Money/quantities on the sub-order match the customer order.

#### [P1] Seller returns handling (respond / mark-received / QC evidence)
- **Route:** `http://localhost:4009/dashboard/returns`
- **Steps:** Open Returns; pick a return routed to this seller → Respond to the return request (POST /seller/returns/:id/respond) → When the parcel arrives, Mark received (POST /seller/returns/:id/mark-received) → Upload QC evidence photos (POST /seller/returns/:id/qc-evidence)
- **Expected:** Seller can move the return through its seller-side states and attach QC evidence; QC_REJECTED is a visible terminal-ish state.
- **Verify:** Return state + QC evidence appear on the RETAIL admin Returns detail; admin's downstream QC-decision/refund actions reflect the seller's input. State stays consistent across seller and admin views.

#### [P1] Seller finances / payouts (read-only parity)
- **Route:** `http://localhost:4009/dashboard/accounts`
- **Steps:** Open 'My finances'; view Commission tab KPIs (pending payable, overdue payout) over a date range (GET /seller/accounts/overview, /commission-records) → Switch to Settlements tab to see settlement history (GET /seller/accounts/settlements) → Cross-read tax surfaces at /dashboard/tax/invoices and /dashboard/tax/tcs
- **Expected:** KPIs render: gross revenue, commission deducted, statutory deductions (TCS/TDS), pending/overdue payable, and a paged settlement list.
- **Verify:** Seller's pending-payable and settlement rows match what RETAIL admin shows under Commission/Accounts for this seller. Amounts are INR-formatted and tie out gross - commission - deductions = net.

#### [P0] ADMIN: RETAIL scope isolation (must NOT see D2C sellers)
- **Route:** `http://localhost:4008/dashboard/sellers`
- **Steps:** Log in to the RETAIL admin with a role that holds `sellers.scope.retail` → Open Sellers; confirm only RETAIL sellers list (GET /admin/sellers, server-filters by scope) → Note a known D2C seller's id; try to open /dashboard/sellers/<d2cSellerId> directly → Repeat the direct-URL probe for a D2C product / order / return id
- **Expected:** The list contains zero D2C sellers; directly navigating to a D2C seller/order/return returns 404 (Seller not found) — never a 403 and never the D2C record — so the RETAIL admin cannot even confirm a D2C entity exists.
- **Verify:** AdminSellerScopeGuard enforces this from `req.user.permissions` (NOT the X-Seller-Type header, which is forgeable). A role with NEITHER scope perm is unrestricted (legacy/SUPER_ADMIN sees all) — so test specifically with a retail-only-scoped role. Confirm list + entity guards both hold.
- ⚠️ **Caveat:** Scope only bites when the admin role actually holds `sellers.scope.retail`. A default/unscoped admin sees all seller types — pick the right role to exercise the boundary.

#### [P0] ADMIN: seller management — status, KYC decision, message, impersonate
- **Route:** `http://localhost:4008/dashboard/sellers/[sellerId]`
- **Steps:** Open a RETAIL seller's detail; review profile + KYC submission → Set verification decision: Verified or Rejected with reason (PATCH /admin/sellers/:id/verification) → Change account status ACTIVE/SUSPENDED/etc with reason (PATCH /admin/sellers/:id/status) → Optionally Send message, Change password, or Impersonate (POST /admin/sellers/:id/impersonate)
- **Expected:** Verification -> VERIFIED + status ACTIVE unblocks the seller (onboarding redirects to first-listing); REJECTED surfaces the reason in the seller's onboarding wizard. Impersonate issues a short-lived token to enter the seller portal as that seller.
- **Verify:** Seller portal (4009) reflects the new verification/status on next load (banner + sidebar gating). Rejection reason text round-trips to the seller. All these per-seller routes are scope-guarded -> a D2C seller id 404s here.
- ⚠️ **Caveat:** Outbound notification email/SMS on status/message is a dev stub. Impersonation token is real.

#### [P0] ADMIN: product approval + seller-mapping approve/stop + tax-config verify
- **Route:** `http://localhost:4008/dashboard/products`
- **Steps:** Open Products; use 'Pending Review' tab for submitted products and 'Pending Seller Approvals' tab for pending mappings → Approve a product (POST /admin/products/:id/approve) or Reject / Request changes with reason → On the Pending Seller Approvals tab, Approve or Stop a seller mapping inline (POST /admin/seller-mappings/:id/approve|stop) → On the product edit page, Verify tax config (POST /admin/products/:id/verify-tax-config); optionally Bulk tax config
- **Expected:** Approve flips product status to APPROVED/ACTIVE and the mapping to APPROVED (sellable). Reject/Request-changes returns it to the seller with the reason. Tax verify clears the 'Tax: unverified' pill.
- **Verify:** Seller portal reflects the new product/mapping status; an approved+tax-verified product is purchasable and no longer carries DRAFT-not-for-ITC. The Pending badge count in the sidebar decrements. Catalog moderation and tax-config attestation are independent gates.

#### [P1] ADMIN: order risk-verification queue (claim -> approve/reject)
- **Route:** `http://localhost:4008/dashboard/verification`
- **Steps:** Open Verification; review queue stats + band-filtered list (highest risk first) → Click 'Claim next order' (POST /admin/verification/claim-next) — atomically claims a PLACED order into your 15-min tray → Open the claimed order, review risk band + reasons (GET /admin/verification/orders/:id/risk) → Approve (PATCH .../approve) to verify + route to sellers, or Reject (PATCH .../reject) to cancel + restore stock; Release if walking away
- **Expected:** Approve releases the order to seller routing; Reject cancels and restocks. Orders that fail allocation post-approval (e.g. unserviceable address) are auto-released back to the queue and listed under the action.
- **Verify:** This is ORDER fraud-review, distinct from seller KYC. An approved order shows up as a new sub-order in the relevant seller's Orders. Claims expire after 15 min back to the queue. queue-stats counts move accordingly.

#### [P1] ADMIN: returns oversight + refund lifecycle
- **Route:** `http://localhost:4008/dashboard/returns`
- **Steps:** Open Returns; pick a return and Approve/Reject (POST /admin/returns/:id/approve|reject) → Schedule pickup -> mark in-transit -> mark received (the reverse-logistics chain) → Record QC decision (POST .../qc-decision), then Initiate refund -> Confirm refund (or Mark failed / Retry) → Close the return
- **Expected:** Each transition advances the return FSM; Initiate+Confirm refund moves money back to the customer (online) or queues a wallet/COD remedy; Mark-failed -> Retry path works.
- **Verify:** Refund amount equals the returned-item value (proportional); the seller's Returns view and finances reflect the reversal/commission clawback. State transitions are CAS-guarded (no double-refund). RETAIL-scope: only returns for RETAIL sellers are listed/actionable.
- ⚠️ **Caveat:** Razorpay refund execution is gateway-stubbed in dev; 'Confirm refund' may rely on a simulated gateway callback rather than a live webhook.

#### [P2] ADMIN: inventory oversight (overview / low-stock / out-of-stock / reservations)
- **Route:** `http://localhost:4008/dashboard/inventory`
- **Steps:** Open Inventory overview (GET /admin/inventory/overview) → Filter Low-stock and Out-of-stock lists (GET /admin/inventory/low-stock, /out-of-stock) → Inspect active stock reservations (GET /admin/inventory/reservations) → Cross-check a product's per-seller/per-franchise breakdown via the Products card expand panel
- **Expected:** Aggregated stock/available/reserved counts render; low/out lists match the threshold logic; reservations show order-linked holds.
- **Verify:** Numbers tie out: available = stock - reserved; a seller's stock edit on 4009 reflects here. Reserved quantities correspond to live orders (reservation lifecycle is order-linked, not orphaned).

#### [P2] ADMIN: routing diagnostics (health snapshot + dry-run preview)
- **Route:** `http://localhost:4008/dashboard/routing`
- **Steps:** Open Routing -> Health snapshot: exception-queue, reassignments (7d), coverage-gap pincodes, top rejecting nodes (auto-refresh 30s, GET /admin/routing/health) → Switch to Dry-run preview; enter a 6-digit customer pincode + up to 50 (productId, optional variantId, qty) rows → Run dry-run (POST /admin/routing/preview)
- **Expected:** Health KPIs render and auto-refresh; preview returns per-item serviceable/unserviceable/error with a primary node + ranked alternates (score, distance, available stock, reasons) WITHOUT committing any order.
- **Verify:** Preview is non-mutating (no order/reservation created). Serviceable allocations point at real RETAIL seller/franchise nodes with stock; coverage-gap pincodes correspond to repeated failed allocations.

#### [P1] ADMIN: commission config + settlement cycles (mark-paid)
- **Route:** `http://localhost:4008/dashboard/commission`
- **Steps:** Open Commission; review Records / Sellers / Cycles / Reconciliation tabs → Adjust a commission record with reason (POST /admin/commission/:id/adjust) and view its history → Default rates at /dashboard/commission/settings (GET/PUT /admin/commission/settings) → Create a settlement cycle, Approve it, then Mark a seller settlement paid with UTR (POST /admin/settlements/:id/mark-paid)
- **Expected:** Adjustments are audited with history; a cycle previews seller-breakdown totals; mark-paid records the UTR and flips the settlement to PAID atomically (CAS, no double-pay).
- **Verify:** Net = gross - commission - reversals + adjustments. The seller's /dashboard/accounts Settlements tab shows the same settlement flip to PAID with the UTR. Reconciliation/margin-summary totals tie out. RETAIL sellers only.
- ⚠️ **Caveat:** Bank/payout disbursal keys are stubbed in dev — mark-paid records the UTR but does not move real money.

#### [P2] ADMIN: accounts dashboards + settlement preview/reports
- **Route:** `http://localhost:4008/dashboard/accounts`
- **Steps:** Open Accounts; view overview/outstanding/top-performers/sellers dashboards (GET /admin/accounts/dashboard/*) → Open Settlements -> preview a cycle (GET /admin/accounts/settlements/preview), drill into a cycle detail → Run Reconciliation report (GET /admin/accounts/reports/reconciliation)
- **Expected:** Outstanding payables, top performers, and per-seller balances render; settlement preview shows what each seller is owed for the cycle; reconciliation report balances.
- **Verify:** Outstanding totals equal the sum of seller pending-payables; preview amounts match the per-seller finance views. Scope: only RETAIL seller finance is aggregated.

#### [P2] ADMIN: storefront curation (feature/arrange catalog products)
- **Route:** `http://localhost:4008/dashboard/storefront`
- **Steps:** Open Storefront; search the storefront-eligible product catalog → Select/feature products and arrange the merchandised layout (save/publish) → Reload the public storefront to confirm the arrangement
- **Expected:** Featured/arranged products persist and surface on the customer storefront.
- **Verify:** Only APPROVED/ACTIVE products are eligible; changes reflect on the storefront after publish. Products shown trace back to RETAIL sellers' approved catalog.

#### [P2] ADMIN: Delhivery ops tools (serviceability / cost / TAT / label / RTO)
- **Route:** `http://localhost:4008/dashboard/delhivery-tools`
- **Steps:** Open Delhivery tools (route exists though commented out of the sidebar — navigate directly) → Check pincode serviceability + COD/prepaid support (GET /admin/delhivery/serviceability/:pincode) → Quote shipping cost between two pincodes by weight/mode (GET /admin/delhivery/cost) → Check expected TAT; from a sub-order, generate a label or force/NDR-RTO (POST /admin/shipping/sub-orders/:id/label|force-rto|ndr-rto)
- **Expected:** Read-only checks (serviceability/cost/TAT) return live-shaped quotes; mutating actions (label, e-waybill, RTO) change the carrier shipment + sub-order shipping status.
- **Verify:** Serviceability/COD flags drive checkout/routing eligibility; a generated label/status change appears on the sub-order in admin Orders and the seller's order view.
- ⚠️ **Caveat:** Delhivery is the carrier skeleton with SELF_DELIVERY as the only live DeliveryMethod (iThink removed). Delhivery webhook callbacks are stubbed in dev — status transitions may need manual triggering rather than real carrier pushes.

#### [P2] ADMIN: franchise linkage oversight (catalog/orders/finance/settlements)
- **Route:** `http://localhost:4008/dashboard/franchises`
- **Steps:** Open Franchises; review a franchise's status/verification, commission, and messaging (PATCH /admin/franchises/:id/status|verification|commission) → Approve/stop a franchise catalog mapping (POST /admin/franchise-catalog/:id/approve|stop) → View franchise orders, POS sales, inventory ledger, and approve/pay franchise settlements (POST /admin/franchise-settlements/:id/approve|pay)
- **Expected:** Franchise mappings/orders/finance are visible and actionable; settlement approve->pay records the disbursal; ledger and inventory tie out.
- **Verify:** Franchise fulfillment nodes also appear as routing candidates in the Routing dry-run. Franchise finance is separate from seller finance. Confirm franchise actions don't leak across seller-type scope.
- ⚠️ **Caveat:** Franchises are a separate node type from RETAIL sellers; not in the primary sidebar nav (reached via context). Payout disbursal stubbed.

---
### FRANCHISE operator (store owner / manager running a SportsMart franchise outlet — onboards via KYC, runs an in-store POS, manages stock, procures from HQ, and reconciles earnings/settlements)
**App:** `web-franchise`  |  **Port:** 4004

The franchise operator self-registers, verifies email by OTP, awaits admin approval + completes KYC onboarding, then runs the storefront: a POS terminal (atomic stock-deducting sales, void, cumulative-guarded returns with damaged-stock routing, daily report + cash reconciliation), inventory (stock view, adjustments, low-stock, immutable ledger), HQ procurement REQUEST flow (draft → submit → track approval → receive), catalog mapping (the gate that decides which products this franchise can sell — POS only shows APPROVED+active mappings), and finance screens (earnings summary, settlement statements that net returns, ledger, commission, tax invoices). All money is INR; POS sale stock deduction is atomic, over-returns are blocked, and a single POS sale must cross-reflect into the inventory ledger, earnings, and the daily report.

#### [P0] Franchise registration + email OTP verification
- **Route:** `/register`
- **Steps:** Open /register; fill owner name, business name, email, 10-digit phone (must start 6-9), strong password + confirm → Check Terms + Privacy consent boxes (Marketing optional); complete captcha if NEXT_PUBLIC_CAPTCHA_PROVIDER is enabled; submit → Land on /register/verify?email=...; enter the 6-digit code emailed (paste auto-fills all 6 boxes) → If no code arrives, wait out the 60s cooldown then Resend; verify and continue → On success you are routed to /login?verified=1
- **Expected:** Register returns a uniform 'requiresVerification' response (same on duplicate email/phone — no account-existence leak). Verify-email succeeds and shows 'Email verified! Sending you to sign in'. A new FranchiseAccount exists in UNDER_REVIEW/pending-approval state.
- **Verify:** Duplicate-email register does NOT reveal the email is taken (identical success message). Wrong/expired OTP -> 401 'Invalid or expired code'. Already-verified -> 400 ALREADY_VERIFIED redirects to /login. Resend is rate-limited (429) and 60s cooldown is enforced client-side.

#### [P0] Login (verified + approval gating)
- **Route:** `/login`
- **Steps:** Open /login; enter email or phone as identifier + password; submit → Observe the three distinct outcomes by account state below
- **Expected:** Approved+verified account: tokens stored in sessionStorage and redirect to /dashboard. Unverified: 403 EMAIL_NOT_VERIFIED with an inline resend hint. Pending approval: 403 generic 'pending admin approval' info message (NOT a hard error).
- **Verify:** Bad credentials -> 401 'Invalid email/phone number or password' and the password field clears. Repeated failures -> 429 lockout message. EMAIL_NOT_VERIFIED vs pending-approval render as different colored banners (warning vs info), proving the backend distinguishes the two 403 codes.

#### [P1] KYC onboarding (GSTIN/PAN submission + admin decision)
- **Route:** `/dashboard/onboarding`
- **Steps:** Open /dashboard/onboarding (VERIFIED accounts auto-redirect to /dashboard) → Enter legal business name, GST type, 15-char GSTIN, 2-digit state code, 10-char PAN, business address (+ optional warehouse) → Tick 'I confirm the information is accurate'; Submit KYC → Observe UNDER_REVIEW pending banner; later, if admin rejects, return to edit and Resubmit
- **Expected:** POST /franchise/onboarding/submit cross-validates GSTIN[0:2]==state code and GSTIN[2:12]==PAN. Success shows 'KYC submitted, we will email you'; profile flips to UNDER_REVIEW (form becomes read-only). Rejected state shows the reason and re-enables the form.
- **Verify:** GSTIN whose embedded PAN != entered PAN is blocked client-side AND server-side. A GSTIN/PAN already used by another franchise -> 409 'already in use'. UNDER_REVIEW locks the form; only REJECTED re-opens it for resubmit.

#### [P1] Staff management (add staff, assign role, deactivate)
- **Route:** `/dashboard/staff`
- **Steps:** Open /dashboard/staff; click Add Staff → Enter name, email, optional phone, role (MANAGER / POS_OPERATOR / WAREHOUSE_STAFF), password (min 8); save → Edit a staff row to change role or phone (email is immutable) → Deactivate an active staff member, then re-Activate them
- **Expected:** New staff appears in the table; KPI counters (Active Staff / Managers / POS Operators / Warehouse) increment. Deactivate flips status to Inactive and the member can no longer access the dashboard. OWNER role is not assignable from the UI (only MANAGER/POS_OPERATOR/WAREHOUSE_STAFF).
- **Verify:** Duplicate-email add surfaces the API error. Edit cannot change email (rendered read-only). Deactivated staff lose access; KPIs only count active staff.

#### [P0] Catalog mapping (which products this franchise can sell — the POS gate)
- **Route:** `/dashboard/catalog`
- **Steps:** Open /dashboard/catalog; browse available master products (GET /franchise/catalog/available-products) → Add a product/variant to the franchise catalog (Add mapping); optionally set franchiseSku + barcode + online-fulfillment flag → Observe the new mapping's approvalStatus = PENDING; wait for admin approval to APPROVED → Confirm only APPROVED + active mappings become sellable
- **Expected:** Adding a mapping creates it in PENDING. Already-mapped variants are pre-disabled in the add modal. Only after admin sets approvalStatus=APPROVED and isActive=true does the product become usable in POS and procurement.
- **Verify:** A PENDING (or deactivated) mapping does NOT appear in the POS product picker (which filters approvalStatus=APPROVED & isActive=true) nor in the procurement product list. This is the catalog gate — without it, POS sale of that product is impossible.
- ⚠️ **Caveat:** Mapping approval is an ADMIN action — a fresh franchise self-mapping stays PENDING and is unsellable until the admin side approves it. Seed at least one APPROVED+active mapping before testing POS/procurement.

#### [P0] POS sale (add items, payment method, complete sale -> atomic stock deduct + receipt)
- **Route:** `/dashboard/pos`
- **Steps:** Open /dashboard/pos (New Sale tab); search or barcode-scan APPROVED products to add to cart, adjust qty / unit price / line discount → Optionally enter customer name + phone; pick sale type (WALK_IN / PHONE_ORDER / LOCAL_DELIVERY) and payment method (CASH / UPI / CARD) → Click 'Complete Sale'; confirm the success modal shows sale number, net amount, and GST breakdown → Auto-print receipt + (CASH only) auto-open cash drawer fire after commit; then start a New Sale
- **Expected:** POST /franchise/pos/sales records the sale and deducts onHandQty ATOMICALLY in one DB transaction (under FOR UPDATE lock — no oversell). Net = subtotal - line discounts, clamped >= 0. GST (CGST+SGST, IGST=0 intra-state) is snapshotted per line. Sale status = COMPLETED, createdByStaffId attributes the cashier.
- **Verify:** Inventory onHandQty drops by exactly the sold qty; an inventory ledger SALE row appears (beforeQty/afterQty consistent). Selling more than on-hand is rejected. The X-Idempotency-Key means a double-fire (flaky network) does NOT double-deduct or create two sales. Discount capped so net never goes negative. Sale also reflects into the day's daily-report totals.
- ⚠️ **Caveat:** Requires an APPROVED + active catalog mapping (backend findApprovedActiveByFranchiseAndProduct gate) AND non-zero on-hand stock — seed stock via procurement-receive or an inventory adjustment first. Staff attribution currently uses the franchise principal until a per-cashier staff JWT lands.

#### [P1] POS void (full reversal within void window -> restock)
- **Route:** `/dashboard/pos`
- **Steps:** POS -> Sale History tab; find a COMPLETED sale (Void only shows for COMPLETED) → Click Void; read the 'returns all items to inventory' warning → Enter a reason (5-500 chars); Confirm Void
- **Expected:** POST /franchise/pos/sales/{id}/void flips status to VOIDED and restores every line's outstanding qty (quantity - alreadyReturned) back to onHandQty in one transaction. A POS_VOID inventory movement is written. Voided amount is excluded from net revenue.
- **Verify:** onHandQty increases back by the un-returned quantity; a POS_VOID ledger row appears. A sale older than POS_VOID_WINDOW_HOURS (default 24h) is REJECTED with an 'older than the 24h void window' message. Void is unavailable for PARTIALLY_RETURNED sales (only return is). Daily report void count/amount increments.

#### [P0] POS return (cumulative-guarded, refund, saleable vs damaged routing)
- **Route:** `/dashboard/pos`
- **Steps:** POS -> Sale History; on a COMPLETED or PARTIALLY_RETURNED sale click Return → Tick the line(s) to return; the Return Qty is clamped to remaining = quantity - returnedQty (fully-returned lines show 'Fully returned', disabled) → Set each line condition SALEABLE or DAMAGED; choose refund method (CASH/UPI/CARD/MANUAL — required) + optional reference/reason → Confirm the live refund preview, accept the 'Refund X to customer?' dialog
- **Expected:** POST /franchise/pos/sales/{id}/return refunds net-per-unit (lineTotal/qty, GST-inclusive) and restocks: SALEABLE -> onHandQty, DAMAGED -> damagedQty. Sale becomes PARTIALLY_RETURNED or RETURNED. Per-line returnedQty is incremented under the same tx; refundedAmount accumulates.
- **Verify:** OVER-RETURN IS BLOCKED: trying to return more than (quantity - already-returned) cumulatively is rejected server-side, not just clamped in UI. SALEABLE units land in onHandQty, DAMAGED units in damagedQty (verify on inventory screen). A second partial return correctly uses the reduced remaining. Idempotency-key prevents double-restock/double-refund. Daily report returned-count + refundTotal increment.

#### [P1] POS daily report + cash reconciliation / day-closure
- **Route:** `/dashboard/pos`
- **Steps:** POS -> Daily Report tab; pick a date and Load Report → Review KPIs: total sales, Net (after refunds), refund total, voided/returned counts, GST (CGST/SGST/IGST/total), by-payment-method, by-sale-type, inventory reconciliation, closure status → Enter Actual Cash Counted (+ optional bank deposit & reference & notes); submit reconciliation → Optionally Download CSV and Generate Closure Report (print)
- **Expected:** GET /franchise/pos/reconciliation returns net-of-refunds revenue (netAmount - refunded), void/return counts, GST breakdown, and a server-computed expectedCashInPaise. Submitting reconciliation persists a row with server-recomputed variance = counted - expected and a MATCHED/VARIANCE verdict.
- **Verify:** totalNetAmount equals gross minus refunds (a returned sale lowers net). Voided/returned counts match the History tab. Expected cash is server-authoritative (client never sends it); variance verdict comes back MATCHED when counted==expected, VARIANCE otherwise. Day boundaries honor IST offset. Re-loading shows the previously submitted reconciliation row.

#### [P1] Inventory: stock view, adjustments, low-stock, damage
- **Route:** `/dashboard/inventory`
- **Steps:** Open /dashboard/inventory; review per-SKU onHand / reserved / available / damaged / in-transit and low-stock threshold → Filter low-stock-only to see SKUs at/below threshold → Adjust stock: pick product, type DAMAGE / LOSS / ADJUSTMENT / AUDIT_CORRECTION, qty, reason; submit
- **Expected:** POST /franchise/inventory/adjust changes the relevant quantity bucket (DAMAGE moves to damagedQty) and writes an immutable inventory ledger entry with beforeQty/afterQty, movementType, actor, and reason. Low-stock list is DB-driven (onHandQty <= lowStockThreshold).
- **Verify:** availableQty = onHand - reserved holds after every change. A DAMAGE adjustment increases damagedQty and decreases sellable. Every adjustment produces exactly one ledger row (ledger is append-only / PG-trigger immutable). Low-stock filter returns only SKUs at/below threshold.

#### [P1] Inventory ledger (audit trail / cross-screen reflection)
- **Route:** `/dashboard/ledger`
- **Steps:** Open /dashboard/ledger (or inventory ledger view); filter by product, movementType, referenceType, date range → Locate the SALE row created by the POS sale test above → Cross-check beforeQty/afterQty against the current stock view
- **Expected:** GET /franchise/inventory/ledger returns one row per stock movement (SALE, POS_VOID, RETURN_RESTOCK, DAMAGE, PROCUREMENT_RECEIPT, ADJUSTMENT) with quantityDelta and before/after snapshots.
- **Verify:** A POS sale produces a matching SALE ledger row; a void produces POS_VOID; a return produces a restock row. The chain of afterQty values is continuous (no gaps/edits), proving immutability. This is the primary cross-screen check: POS sale -> ledger -> stock all agree.

#### [P1] Procurement REQUEST flow (draft -> submit -> track approval -> receive)
- **Route:** `/dashboard/procurement/new`
- **Steps:** Open /dashboard/procurement/new; select APPROVED catalog products and per-item quantities (max 10000/item, max 100 items), add notes → Save as DRAFT or Submit directly (POST /franchise/procurement then /submit) → Track status on /dashboard/procurement (DRAFT -> SUBMITTED -> APPROVED/PARTIALLY_APPROVED -> DISPATCHED -> RECEIVED -> SETTLED) → When DISPATCHED, open the request and Confirm Receipt entering receivedQty + damagedQty per item
- **Expected:** Submit moves the request through the 11-state FSM. Admin sets approved qty + landed cost + procurement fee at approval (these are em-dash/null until then). Confirm Receipt (POST .../receive) increments inventory onHandQty by receivedQty (and damagedQty for damaged units) and writes a PROCUREMENT_RECEIPT ledger row; status -> RECEIVED/PARTIALLY_RECEIVED.
- **Verify:** A freshly SUBMITTED request shows '—' for cost fields (not ₹0.00). Partial dispatch/receive is supported (PARTIALLY_RECEIVED). Receiving increases stock that then becomes POS-sellable. Procurement fee later appears as a PROCUREMENT_FEE earnings-ledger row and feeds the settlement. Only APPROVED+active catalog products are selectable in the request builder.
- ⚠️ **Caveat:** Approval, landed-cost entry, and dispatch are ADMIN actions — without the admin side advancing the request, the franchise can only reach SUBMITTED and cannot test receive. Quantities are capped (10000/item, 100 items) to mirror backend DTO.

#### [P1] Earnings summary + settlement statement (nets returns)
- **Route:** `/dashboard/earnings`
- **Steps:** Open /dashboard/earnings; review summary (total earnings, pending settlement, platform fees, online commission, procurement fees) → Open earnings ledger history; filter by sourceType (ONLINE_ORDER / PROCUREMENT_FEE / RETURN_REVERSAL / ADJUSTMENT / PENALTY) and status → Open a settlement statement (GET /franchise/earnings/settlements/{id}) and inspect the net computation
- **Expected:** Settlement net = grossFranchiseEarning - reversalAmount + adjustmentAmount; gross counts sales rows only (POS + online), and RETURN_REVERSAL rows subtract — returns are NOT double-counted. Settlement carries online orders, procurements, POS sales, fees, reversals, and netPayableToFranchise with status PENDING/APPROVED/PAID/FAILED.
- **Verify:** A POS sale's commission/fee appears in the earnings ledger; a subsequent return posts a RETURN_REVERSAL that lowers net (settlement nets returns). netPayableToFranchise = gross - reversals + adjustments. A PAID settlement shows paidAt + UTR/payment reference. Cross-check: a POS sale flows POS -> earnings ledger -> settlement.

#### [P2] Commission view
- **Route:** `/dashboard/commission`
- **Steps:** Open /dashboard/commission; review the commission rate(s) and computed online-commission / platform-fee amounts applied to the franchise's sales
- **Expected:** Commission screen reflects the configured commission rate and the platform/online-commission split that the earnings ledger and settlements are derived from.
- **Verify:** Commission amounts shown reconcile with the totalOnlineCommission / totalPlatformFees on the earnings summary and settlement statements (same rate applied consistently).

#### [P2] Tax invoices
- **Route:** `/dashboard/tax/invoices`
- **Steps:** Open /dashboard/tax/invoices; review the list of GST tax invoices generated for the franchise's sales → Open an invoice to confirm HSN + CGST/SGST/IGST breakdown and place-of-supply
- **Expected:** Each invoice shows the Section 31 CGST Act required breakdown (HSN per line, CGST/SGST for intra-state, IGST=0), taxable value, and total GST consistent with the originating POS/online sale.
- **Verify:** Invoice GST figures match the per-line gstRateBps/cgst/sgst captured on the POS sale. Intra-state sales show CGST+SGST and zero IGST; place-of-supply state code is present.

#### [P2] Profile / accounts / support / forgot-reset password (config + ancillary)
- **Route:** `/dashboard/profile`
- **Steps:** Open /dashboard/profile to review business details + verificationStatus; /dashboard/accounts for bank/settlement account info → Open /dashboard/support to raise a ticket (/support/new) and view ticket threads (/support/[id]) → Test password reset: /forgot-password -> email -> /verify-otp -> /reset-password with reset token
- **Expected:** Profile reflects KYC/verification status. Support ticket creation persists and is viewable in the thread. Forgot-password issues an OTP, verify-reset-otp returns a resetToken, and reset-password sets the new password.
- **Verify:** Forgot-password does not leak account existence; reset requires the OTP-derived resetToken and matching new/confirm passwords. Profile verificationStatus matches the onboarding decision. Support thread shows submitted message + any admin reply.

---
### Franchise Network Admin
**App:** `web-franchise-admin`  |  **Port:** 4002

The Franchise Network Admin oversees the company's franchise partners end-to-end: onboarding/KYC verification and lifecycle status, pincode->franchise territory mapping with priority routing, approving which catalog products each franchise may sell, approving/dispatching/settling procurement (HQ->franchise) requests with negotiated landed costs, running settlement cycles and marking franchise payouts paid with a UTR, plus oversight of earnings/finance ledgers, inventory, POS sales and orders. The app (Next.js, persona-pinned via X-Seller-Type: FRANCHISE) talks to the NestJS API under /admin/* and is gated by admin roles/permissions backend-side. Note: the /dashboard/verification route here is ORDER risk-verification (fraud band triage), distinct from franchise KYC, which lives in the franchise detail "Update Verification" action.

#### [P0] Admin login (with MFA challenge)
- **Route:** `/login`
- **Steps:** Open /login (root / redirects here when unauthenticated). → Enter admin email + password (>=8 chars), submit (POST /admin/auth/login). → If MFA-enrolled, the page switches to a 6-digit step: enter authenticator code OR choose 'email OTP' (request -> enter code). → On success the access/refresh tokens + admin are stored in sessionStorage and you land on /dashboard.
- **Expected:** Authenticated session; /dashboard shows KPI tiles (pending verification, pending settlements) and Quick actions (Catalog, Procurement, Settlements).
- **Verify:** Without MFA you go straight to /dashboard; with MFA, tokens are issued ONLY after the challenge is verified (login response returns a challengeToken, not tokens). Wrong password / expired challenge surfaces an inline error. Reload keeps you logged in (sessionStorage). API calls carry Authorization + X-Seller-Type: FRANCHISE.

#### [P0] Franchise onboarding decision (KYC verification + activation)
- **Route:** `/dashboard/franchises`
- **Steps:** Open Franchises list; filter verificationStatus=NOT_VERIFIED (or UNDER_REVIEW) and/or status=PENDING to find new applicants. → Open the row kebab -> 'Update Verification' (or open the franchise detail). Pick VERIFIED (or REJECTED / UNDER_REVIEW), add an optional reason, submit (PATCH /admin/franchises/:id/verification). → Then open the kebab -> 'Update Status' and transition the lifecycle: PENDING -> APPROVED, then APPROVED -> ACTIVE (PATCH /admin/franchises/:id/status). Allowed transitions are enforced (PENDING->APPROVED/DEACTIVATED, APPROVED->ACTIVE/DEACTIVATED, ACTIVE->SUSPENDED/DEACTIVATED, etc.). → Optionally set commission via 'Update Commission' (onlineFulfillmentRate / procurementFeeRate, PATCH /admin/franchises/:id/commission).
- **Expected:** Verification badge flips to VERIFIED (or REJECTED); status badge progresses PENDING->APPROVED->ACTIVE. Reason is recorded.
- **Verify:** Badges on both the list row and the detail header update immediately. Disallowed status jumps are not offered (modal only lists valid next states; backend rejects illegal transitions). A REJECTED verification should block/limit downstream activation. Commission rates persist and later feed procurement fee + settlement math.

#### [P0] Pincode -> franchise mapping CRUD + priority (territory routing)
- **Route:** `/dashboard/franchises/[id]/pincodes`
- **Steps:** Open a franchise -> Pincodes page. Add a single pincode with a priority 0-1000 (default 100) and optional reason (PUT /admin/franchises/:id/pincodes). → Bulk-add a list of pincodes at one priority (POST .../pincodes/bulk, all-or-nothing, max 5000) — an invalid pincode in the batch saves nothing. → Edit a row's priority inline (PUT with expectedVersion = the loaded row.version) and toggle Active/Inactive. → Soft-remove a row (DELETE .../pincodes/:mappingId — deactivates, keeps history). → Cross-check routing: place/route a customer order to a MAPPED pincode vs an UNMAPPED one (storefront/checkout).
- **Expected:** Mapped pincode rows appear with priority + active flag; conflictsWith lists any OTHER active franchise also serving that pincode. A higher-priority mapped franchise outranks a lower-priority one for the same pincode.
- **Verify:** ROUTING: a mapped pincode routes the order to the mapped franchise(s) only, ranked by priority (mappingPriority feeds the allocation score in seller-allocation.service; pincodeMappingId is snapshotted on the AllocationLog). An UNMAPPED pincode falls back to the distance-based (Haversine) allocator unchanged. Priority edit fails with a 409 if version is stale (optimistic concurrency) — confirms two admins can't silently clobber. Bulk with one bad pincode -> 400, count unchanged.

#### [P0] Catalog mapping approval (which products a franchise can sell)
- **Route:** `/dashboard/catalog`
- **Steps:** Open Franchise Catalog Mappings; filter approvalStatus=PENDING_APPROVAL. Mappings are grouped per franchise with Approved/Pending/Rejected/Stopped count chips. → Approve a single pending mapping (PATCH /admin/franchise-catalog/:id/approve) or Reject it (.../reject). → Use the per-franchise kebab -> Bulk approve (approves every PENDING mapping for that franchise) or Bulk stop (stops every APPROVED one). → Soft-remove/stop an approved mapping via Stop (PATCH .../stop) — moves it to STOPPED, not deleted. → Cross-check: as that franchise, attempt a POS sale of the now-approved product.
- **Expected:** Mapping moves PENDING_APPROVAL -> APPROVED (or REJECTED / STOPPED); count chips update; bulk actions flip all matching rows in the group.
- **Verify:** GATE: only an APPROVED + active mapping unblocks the franchise — POS sale, procurement, and stock all call findApprovedActiveByFranchiseAndProduct, so a PENDING/REJECTED/STOPPED product is rejected at POS/procurement. Approving a mapping should immediately let that franchise transact the SKU; stopping it re-blocks. Reject/Stop are reversible-state changes (soft), not hard deletes.

#### [P0] Procurement REQUEST approval -> dispatch -> settle (HQ to franchise)
- **Route:** `/dashboard/procurement/[id]`
- **Steps:** Open Procurement list, filter status=SUBMITTED, open a request detail. → Click Approve: per item set approvedQty and landedUnitCost (prefilled from per-franchise negotiated price or variant cost). Submit (PATCH /admin/procurement/:id/approve). At least one item must have approvedQty>0 and landedUnitCost>0. → Mark Dispatched (status APPROVED/PARTIALLY_APPROVED/SOURCING): optionally enter trackingNumber/carrierName/expectedDeliveryAt (PATCH .../dispatch). → After the franchise records receipt (status RECEIVED), click Settle (PATCH .../settle). → Reject path: from SUBMITTED, click Reject with a reason (PATCH .../reject).
- **Expected:** Status walks SUBMITTED -> APPROVED/PARTIALLY_APPROVED -> DISPATCHED -> (RECEIVED via franchise) -> SETTLED. Totals (totalApprovedAmount, procurementFeeAmount = rate-based, finalPayableAmount) recompute on approve. Reject -> REJECTED with reason.
- **Verify:** CAP: approvedQty > requestedQty is rejected by the API (BadRequest: 'approvedQty exceeds requestedQty') — confirms you can't approve more than requested; approvedQty=0 marks that item REJECTED. Settle is only enabled at RECEIVED. Procurement fee = franchise procurementFeeRate applied to landed cost. Action buttons are state-gated (Approve/Reject only SUBMITTED; Settle only RECEIVED). Every transition writes a ProcurementRequestEvent history row.

#### [P1] Per-franchise procurement pricing override
- **Route:** `/dashboard/franchises/[id]/pricing`
- **Steps:** Open a franchise -> Pricing. The table lists the franchise's approved catalog products with current landed-cost override (if any) and an editable draft. → Enter a negotiated landedUnitCost for a product/variant and Save (PUT /admin/franchises/:id/procurement-prices). → Remove an override to fall back to the default cost (DELETE .../procurement-prices/:priceId).
- **Expected:** Override is saved per (franchise, product, variant); 'Saved' confirmation shows. Removing it reverts to ProductVariant.costPrice.
- **Verify:** An override WINS over ProductVariant.costPrice in the procurement-approval landedUnitCost prefill (Option C). Save a value, then open a new procurement request for that SKU+franchise and confirm the approve modal prefills the negotiated cost (not the generic cost).

#### [P0] Settlement run + mark-paid with UTR (atomic, CAS-guarded)
- **Route:** `/dashboard/settlements`
- **Steps:** Open Franchise Settlements. Click 'Create settlement cycle', pick periodStart/periodEnd, create (POST /admin/franchise-settlements) — one settlement per franchise whose PENDING ledger entries fall in the period. → For a PENDING settlement, click Approve (PATCH .../:id/approve). → For an APPROVED settlement, click Mark Paid and enter the UTR / paymentReference (PATCH .../:id/pay). → (Cross-check the accounts view at /dashboard/accounts/settlements/[cycleId] for the cycle-level breakdown.)
- **Expected:** New cycle creates per-franchise settlements in PENDING; Approve -> APPROVED; Mark Paid -> PAID with the UTR recorded and paidAt set. Status chips update.
- **Verify:** ATOMIC + CAS: mark-paid runs in a single $transaction that flips the settlement APPROVED->PAID via updateMany WHERE status='APPROVED' (compare-and-swap) AND flips the linked franchiseFinanceLedger rows to SETTLED in the same tx — so 'paid' and 'settled' never diverge and a double-submit can't pay twice (second call matches 0 rows). It requires step-up re-auth (60s window) and is throttled (5/min). Cycle creation atomically CLAIMS the period's PENDING ledger rows so a concurrent cycle can't grab the same entries.

#### [P1] Earnings / finance ledger oversight (+ adjustment/penalty)
- **Route:** `/dashboard/franchises/[id]`
- **Steps:** Open a franchise -> Finance tab. Review the finance ledger (GET /admin/franchise-finance/:id/ledger), filter by sourceType. → Create a manual Adjustment (credit/debit) with amount + reason (POST .../adjustment). → Create a Penalty with amount + reason (POST .../penalty). → Open the Settlements tab on the franchise to see that franchise's settlement history.
- **Expected:** Ledger lists earnings/fees/returns/adjustments with running balanceAfter; new adjustment/penalty rows appear with reason and shift the balance.
- **Verify:** An adjustment/penalty posts a new PENDING ledger row that is later swept into the NEXT settlement cycle for that period (net = gross - reversal + adjustment). REVERSED rows from returns are negative and net out. The franchise's Finance + Settlements tabs reflect the same ledger the global settlement run consumes.

#### [P2] Inventory oversight (stock + ledger)
- **Route:** `/dashboard/inventory`
- **Steps:** Open Inventory; pick a franchise to load its stock (GET /admin/franchises/:id/inventory). → Review per-SKU onHand/available/reserved/damaged and lowStockThreshold; low/out rows are colour-coded (red <=0, amber <= threshold). → On the franchise detail Inventory tab, open the stock-movement ledger (GET .../inventory/ledger) to trace receipts, sales, DAMAGE, RTO_RESTOCK, reservations.
- **Expected:** Read-only oversight: availableQty, reserved, damaged and the immutable movement ledger per franchise.
- **Verify:** availableQty should equal onHand - reserved (and excludes damaged). A procurement RECEIVED, a POS sale, and a return each appear as ledger movements with balanceAfter; the ledger is append-only (DB-trigger immutable). Low-stock rows below threshold are flagged.

#### [P2] Franchise orders oversight (mark delivered / cancel)
- **Route:** `/dashboard/orders`
- **Steps:** Open Orders (franchise sub-orders) and open one (GET /admin/franchise-orders/sub-orders/:id). → Mark a fulfilled sub-order Delivered (PATCH /admin/franchise-orders/:id/mark-delivered). → Cancel a sub-order with a reason >=10 chars (POST /admin/shipping/sub-orders/:id/cancel-with-courier, idempotency-keyed).
- **Expected:** Sub-order fulfillmentStatus advances to DELIVERED; cancel cancels the franchise leg and restores reserved stock.
- **Verify:** Mark-delivered re-reads siblings in-tx to recompute the master order status (no TOCTOU). Cancel requires a 10+ char reason and is idempotent (X-Idempotency-Key) so a double-click won't double-cancel. Wallet-aware payment label shows correctly on COD+wallet orders.

#### [P1] Order risk-verification queue (fraud band triage)
- **Route:** `/dashboard/verification`
- **Steps:** Open the verification queue; review band tabs (All/High/Red/Critical/Yellow/Green/Unscored) and the queue-stats banner. → Click 'Claim next <band>' to atomically claim the next PLACED order (POST /admin/verification/claim-next); it lands in 'My tray'. → Open a claimed order; review risk score + reasons. Approve with remarks (PATCH .../approve) or Reject (PATCH .../reject). RED/CRITICAL approvals REQUIRE a >=10 char reason. → Optionally bulk-approve GREEN (dry-run first), rescore, or release/force-release a claim.
- **Expected:** Claimed order moves to your tray; Approve routes it onward to fulfillment; Reject cancels and restores stock. High-risk approvals are blocked without a written reason.
- **Verify:** claim-next is atomic (one admin owns a claim; claimExpiresAt enforces TTL). Approving a RED/CRITICAL order without a 10-char reason is blocked client- and server-side. Reject restores reserved stock. This is order-fraud verification, NOT franchise KYC (don't confuse with the franchise 'Update Verification').

---
### Affiliate (member portal partner) + Affiliate Admin (SportsMart staff managing the program)
**App:** `web-affiliate (member portal) + web-affiliate-admin (admin)`  |  **Port:** 4007 (web-affiliate), 4006 (web-affiliate-admin); API 8000

Two surfaces share one backend (/api/v1). web-affiliate (port 4007) is the partner portal: apply, sign in, share auto-issued coupon/referral codes, watch attributed commissions move PENDING→CONFIRMED→PAID, add a bank/UPI payout method, request payouts (netted of §194-O TDS), and view TDS / tax documents (Form 16A). web-affiliate-admin (port 4006) is run by SportsMart admins (admin/auth/login + MFA) to approve/reject applications, suspend/deactivate/reactivate affiliates, set per-affiliate commission rates and coupon discount config, approve/mark-paid/mark-failed payouts, and tune platform defaults (commission %, return window, payout minimum, TDS rate + FY threshold). NOTE: affiliate KYC and Coverage pages are deliberately paused/deferred in dev; several TDS labels read §194H/10%/₹15k in the UI while project memory says the effective deduction is §194-O — flag as a known discrepancy, not a test failure.

#### [P0] Affiliate application (register)
- **Route:** `/register (web-affiliate:4007)`
- **Steps:** Open /register and fill first/last name, email, 10-digit Indian mobile (must start 6-9), password + confirm → Optionally add website, social handle, join reason → Tick Terms of Service and Privacy Policy (both required); marketing opt-in optional → If captcha enabled, complete it; click Submit application → See the 'Application submitted' success card, then auto-redirect to /login?applied=1
- **Expected:** POST /affiliate/register returns 201; UI shows success and redirects to login with the 'we'll email you once reviewed' banner. A new affiliate row appears in the admin list under PENDING_APPROVAL.
- **Verify:** Password mismatch / unchecked consent blocks submit client-side with a red error. In affiliate-admin the new application shows in the Pending tile/list (with a 'New · Xh ago' badge if <24h). Account is NOT usable until an admin approves.
- ⚠️ **Caveat:** Registration does NOT use the OTP screen — /verify-otp is only for password reset. There is no email-verify-on-signup step; admin approval is the gate. Captcha is disabled in dev (NEXT_PUBLIC_CAPTCHA_PROVIDER=disabled).

#### [P0] Affiliate login + pending/rejected/suspended messaging
- **Route:** `/login (web-affiliate:4007)`
- **Steps:** Open /login, enter email + password of an ACTIVE affiliate, sign in → Land on /dashboard (welcome + onboarding checklist + balance stats) → Separately, try logging in as a still-PENDING applicant
- **Expected:** ACTIVE login stores access+refresh tokens (sessionStorage + httpOnly cookies) and routes to /dashboard. PENDING login is rejected with code AFFILIATE_PENDING_APPROVAL → friendly 'still under review' message; REJECTED/SUSPENDED show their server message.
- **Verify:** Dashboard renders balances (Pending/Confirmed/Paid/Hold) from /affiliate/me/balances; primary coupon card shows the auto-issued code + storefront ?ref= link. 401s during the session silently single-flight-refresh rather than bouncing to login.

#### [P1] Forgot password → OTP → reset
- **Route:** `/forgot-password (web-affiliate:4007)`
- **Steps:** On /login click 'Forgot password?'; enter email and submit (always 200 to avoid enumeration) → On /verify-otp enter the 6-digit OTP (10-min expiry); use Resend (60s cooldown) if needed → On /reset-password set a new password, then sign in with it
- **Expected:** forgot-password emails a 6-digit OTP; verify-reset-otp returns a resetToken stashed in sessionStorage; reset-password consumes it. New password works at /login.
- **Verify:** Wrong/expired OTP shows an inline error; resend disables until the 60s countdown ends. Navigating to /verify-otp without an in-flight email bounces back to /forgot-password. OTP is read from the dev mail log / email handler.

#### [P1] Share coupon / referral code
- **Route:** `/dashboard/coupons (web-affiliate:4007)`
- **Steps:** Open Coupons; view the auto-issued primary code card (and any extra codes) → Copy the coupon code and the ?ref= referral link → Use WhatsApp / Twitter / Email quick-share buttons
- **Expected:** Codes come from /affiliate/me (couponCodes); the page is read-only — affiliates cannot create codes themselves. Copy buttons flip to '✓ Copied'; share links open pre-filled with code + storefront link.
- **Verify:** Referral link is STOREFRONT_URL/?ref=<code> (drops a 30-day attribution cookie). Inactive/expired/used-up codes show the right pill and disabled styling. Empty state explains codes are issued on admin approval.
- ⚠️ **Caveat:** Coupon CREATION/config is admin-only (in the affiliate-admin Manage modal). The member side only shares what admin issued.

#### [P0] Earnings dashboard — attributed sale lifecycle
- **Route:** `/dashboard/earnings (web-affiliate:4007)`
- **Steps:** Place a storefront order using the affiliate's coupon code OR via the ?ref= link, and complete payment + delivery → Open /dashboard/earnings; filter by status; expand a row to see the lifecycle timeline → Wait for the return window to close (or have admin/cron advance it)
- **Expected:** An attributed order creates a commission row (source COUPON or LINK) at commissionPercentage of post-discount subtotal, starting PENDING. After the return window closes without refund, the cron flips it PENDING→CONFIRMED (eligible for payout); a post-payout refund yields REVERSED (clawback), a pre-payout refund yields CANCELLED.
- **Verify:** Balance tiles (pending/confirmed/paid/hold) increment correctly and match /affiliate/me/balances. SSE stream /portal/streams/affiliate-earnings live-refreshes balances. adjustedAmount vs commissionAmount shows when an adjustment applied. Rate matches the per-affiliate override or platform default.
- ⚠️ **Caveat:** Requires a seeded storefront order + payment + delivery to generate a commission; the return-window→confirm step depends on the 60s confirmation cron and the configured returnWindowDays.

#### [P0] Add payout method + request payout (TDS netting)
- **Route:** `/dashboard/payouts (web-affiliate:4007)`
- **Steps:** Open Payouts; add a BANK method (account no, IFSC, holder name, optional bank) or UPI id; first method becomes primary → Confirm the eligibility checklist is all-green (ACTIVE, KYC verified, primary method, balance ≥ ₹500) → Click 'Request payout' (sends an idempotency key); watch it appear in Payout history → After admin marks it paid, re-open and read the Gross / TDS / Net breakdown
- **Expected:** POST /affiliate/me/payout-methods saves the method (only last4 shown). POST /affiliate/me/payouts bundles CONFIRMED commissions into a REQUESTED payout. Once admin marks paid, the row shows status PAID with gross, any reversal debit, TDS deducted, and net — TDS row discloses section/rate/PAN-on-file (e.g. '§194-O, 5%, PAN on file').
- **Verify:** Net = gross − reversal − TDS. Requesting below ₹500 or with no primary method is blocked by the disabled button + checklist. Double-clicking Request reuses the idempotency key (no duplicate request). Confirmed commissions move to PAID after mark-paid; affiliate sees the bank transaction reference.
- ⚠️ **Caveat:** Eligibility checklist still lists 'KYC verified' (gates on kycStatus==='VERIFIED' via AFFILIATE_KYC_GATE_ENABLED) even though the KYC submission page is PAUSED — so in dev an affiliate may be unable to satisfy the checklist unless KYC is verified/forced server-side or the gate env is off. §194-O TDS section determination + the historical-10% correction are flagged in project memory as finance/legal sign-off gates before production.

#### [P1] TDS statement + tax documents (Form 16A)
- **Route:** `/dashboard/tds and /dashboard/tax-documents (web-affiliate:4007)`
- **Steps:** Open /dashboard/tds; read per-FY cumulative gross / TDS / net and threshold-crossed date → Open /dashboard/tax-documents; read per-quarter gross/TDS and download Form 16A where status allows
- **Expected:** /affiliate/me/tds returns one row per FY (no TDS until the FY threshold is crossed). /affiliate/me/tax/summary returns per-quarter rows; Form 16A downloads (opens HTML in a new tab) only when canDownloadForm16A is true (marketplace has issued the certificate).
- **Verify:** TDS row turns red and threshold-crossed badge appears once cumulative gross exceeds the threshold. Tax-documents 'Download' is greyed to 'Not issued' until the cert is issued; clicking a not-yet-issued quarter shows 'not available yet'.
- ⚠️ **Caveat:** DISCREPANCY: /dashboard/tds text says 'Section 194H', '5% TDS', '₹15,000 threshold'; /dashboard/tax-documents says 'Section 194-O'. Project memory says the effective deduction is §194-O. Treat the §194H wording as a stale label, not a bug to fix during testing. Form 16A issuance is a separate manual/marketplace step, so most dev quarters show 'Not issued'.

#### [P2] Edit affiliate profile
- **Route:** `/dashboard/profile (web-affiliate:4007)`
- **Steps:** Open Profile, click Edit profile → Change name/phone/website/social/join reason; Save → Cancel a separate edit to confirm it reverts
- **Expected:** PATCH /affiliate/me persists only changed fields; identity card, status pill, KYC pill, and commission-rate pill reflect the saved values. '✓ Profile saved' flash on success.
- **Verify:** Email is read-only (contact support copy). Phone re-validates the 6-9 Indian-mobile rule. Save button is disabled when nothing is dirty. Commission pill shows the per-affiliate override or 'Platform default'.

#### [P2] Affiliate support ticket
- **Route:** `/dashboard/support (web-affiliate:4007)`
- **Steps:** Open Support; click '+ New ticket' → Pick a category, set priority, write subject + body; submit → Open the created ticket and post a reply
- **Expected:** createTicket returns a ticket with a ticketNumber; you land on its thread. The list shows it with the right status pill and last-activity time; status filters work.
- **Verify:** Empty subject/body is blocked client-side. New ticket appears in the list (and in the staff support queue). Replies thread under the ticket.

#### [P0] Admin sign in (with MFA)
- **Route:** `/login (web-affiliate-admin:4006)`
- **Steps:** Open the affiliate-admin /login; enter SportsMart admin email + password → If MFA is enrolled, enter the authenticator/backup code OR tap 'Email me a code' and enter the 6-digit email OTP → Land on /dashboard (affiliate applications list)
- **Expected:** Uses /admin/auth/login (shared admin identity, not a separate affiliate-admin account). mfaRequired swaps to the challenge step; verify stores adminToken and routes to /dashboard. Access to /admin/affiliates/* is enforced by AdminAuthGuard.
- **Verify:** Wrong password → 'Invalid email or password'. Expired MFA challenge (5-min timer) drops back to the password form. Destructive routes can additionally trigger a STEP_UP_REQUIRED modal that replays the request after elevation.

#### [P0] Approve / reject affiliate application
- **Route:** `/dashboard (web-affiliate-admin:4006)`
- **Steps:** On the Affiliates list, filter by Pending (or use the hero 'Review N pending' button) → On a pending card click Approve → confirm in the modal → On another pending card click Reject → enter a reason (required) → confirm
- **Expected:** Approve (PATCH /admin/affiliates/:id/approve) flips status to ACTIVE and auto-generates a primary coupon code; the affiliate can then log in. Reject (PATCH .../reject with reason) sets REJECTED and the reason is shown to the applicant; they can re-apply.
- **Verify:** KPI tiles + counts update after the action. Approved affiliate now appears under Active and gets a coupon (verify on the member coupons page). Rejected affiliate sees the reason on login. Reject requires a non-empty reason.

#### [P0] Manage affiliate — suspend / deactivate / reactivate + commission rate + coupon config
- **Route:** `/dashboard → Manage modal (web-affiliate-admin:4006)`
- **Steps:** On an ACTIVE affiliate click Manage → Status section: Suspend (reason required) or Deactivate; on a suspended/inactive one click Reactivate → Commission section: untick 'use platform default', enter a 0–100% rate, Save → Coupon section: set customer discount (none/percent/fixed), expiry, max uses, min order value, active toggle; Save
- **Expected:** Suspend (PATCH .../suspend) blocks login + earning; Deactivate keeps login but stops new commissions; Reactivate restores ACTIVE. Commission PATCH .../commission sets a per-affiliate override (null = platform default) applied to future commissions. Coupon PATCH .../coupons/:id updates the customer-facing discount/limits.
- **Verify:** After suspend, the affiliate cannot log in (login shows AFFILIATE_SUSPENDED). Commission override shows as the 'X% rate' pill on the card and on the member profile; new attributed orders use the new rate. Coupon discount changes reflect at storefront checkout and on the member coupons card.

#### [P0] Payout queue — approve / mark paid / mark failed
- **Route:** `/dashboard/payouts (web-affiliate-admin:4006)`
- **Steps:** Open Payouts; default filter shows REQUESTED → On a REQUESTED card click Approve → confirm (REQUESTED→APPROVED) → On the APPROVED/PROCESSING card click Mark paid → enter UTR/RRN (optional) → confirm → Alternatively click Reject (on REQUESTED) or Mark failed (on APPROVED/PROCESSING) with a reason
- **Expected:** Approve PATCH .../approve; Mark-paid PATCH .../mark-paid settles bundled commissions to PAID and writes the transaction ref; Mark-failed PATCH .../mark-failed releases bundled commissions back to CONFIRMED so the affiliate can retry; Reject PATCH .../reject with reason. Per-status buttons are strict (REQUESTED=approve/reject only; APPROVED/PROCESSING=mark-paid/mark-failed only; PAID/FAILED/CANCELLED terminal).
- **Verify:** KPIs (Awaiting/Approved/Processing/Paid/Failed) update; the affiliate's payout history shows the new status, net, and reference; mark-failed re-confirms the commissions (member Confirmed balance rises again). A TDS record is created/updated for the FY on mark-paid. Reason fields are visible to the affiliate.
- ⚠️ **Caveat:** The admin Mark-paid/Approve modal summary hard-codes 'TDS (10%)' while the member-side and project memory describe §194-O (5% with PAN). Treat the 10% label as a stale UI string. Reversal debit + TDS are computed server-side at payout-request time.

#### [P1] Platform settings — commission default, return window, payout minimum, TDS config
- **Route:** `/dashboard/settings (web-affiliate-admin:4006)`
- **Steps:** Open Settings (loads /admin/affiliates/reports/settings); click Edit settings → Change Default commission %, Return window days, Minimum payout ₹, Reversal grace days, TDS rate %, FY threshold ₹ → Save (sticky bar) and confirm the values persist
- **Expected:** PATCH /admin/affiliates/reports/settings persists the defaults; they apply to every affiliate without a per-affiliate override. Return window drives PENDING→CONFIRMED timing; minimum payout gates member payout requests; TDS rate + threshold drive auto-deduction at payout-request time.
- **Verify:** Validation rejects empty/negative, >100% percentages, non-integer or >365 day windows. 'Last updated' stamp + admin id show after save. Changing the default commission affects new commissions for default-rate affiliates; changing the payout minimum changes the member eligibility checklist threshold.
- ⚠️ **Caveat:** Settings UI labels TDS as 'Section 194H', '10% statutory', '₹15,000 floor' — inconsistent with the §194-O direction in project memory; the editable rate/threshold fields are the source of truth, the section label is informational/stale.

#### [P1] Admin overview, commission ledger, TDS records, reports
- **Route:** `/dashboard/overview, /dashboard/commissions, /dashboard/tds, /dashboard/reports (web-affiliate-admin:4006)`
- **Steps:** Overview: read action-item tiles (applications to review, payouts to approve) and platform commission totals + top earners → Commissions: filter/search the platform-wide commission ledger by status / order / coupon, expand a row → TDS records: filter by FY, read per-affiliate cumulative gross/TDS/net → Reports: read total paid, available-for-payout, pending pipeline, reversal-rate, and top-20 earners
- **Expected:** Overview action tiles deep-link to the right queues and zero out when handled ('Inbox zero'). Commission ledger reflects every affiliate's commissions with correct status totals. TDS records update each time a payout is marked paid. Reports aggregates match the commission totals endpoint.
- **Verify:** Counts on overview match the list pages. Reversal rate = reversed/(paid+reversed); turns danger above 5%. TDS 'threshold crossed' badge appears once cumulative gross > the threshold. Top earners ranking matches actual paid+confirmed sums.

#### [P2] Affiliate KYC submission + admin KYC review (PAUSED)
- **Route:** `/dashboard/kyc (both apps)`
- **Steps:** Open the member /dashboard/kyc and the admin /dashboard/kyc → Observe the 'Feature paused' / 'KYC review is temporarily disabled' cards
- **Expected:** Both KYC surfaces render a static 'paused' placeholder — no PAN/Aadhaar capture, no upload, no admin verify/reject queue. Backend KYC routes and the KYC nav entries/KPIs are commented out.
- **Verify:** Confirm neither page submits or fetches KYC data (placeholder only). Note the tension: the payout eligibility checklist + AFFILIATE_KYC_GATE_ENABLED still reference kycStatus VERIFIED, so payouts may be blocked unless KYC is verified/forced server-side or the gate is disabled in dev.
- ⚠️ **Caveat:** Intentionally disabled per product request (full impl preserved in git history / block comments). Do NOT log as a defect; just record that the flow is unavailable and that it interacts with payout gating.

#### [P2] Coverage / service-area (DEFERRED)
- **Route:** `/dashboard/coverage (web-affiliate:4007)`
- **Steps:** Open /dashboard/coverage and observe the 'Coming soon' card
- **Expected:** Static 'Coverage areas — coming soon' placeholder. There is no affiliate service-area data model; the old version 404'd against a non-existent franchise-coverage endpoint and was removed.
- **Verify:** Page renders the placeholder only; no network call. Record as deferred, not broken.
- ⚠️ **Caveat:** Genuinely unimplemented feature (no affiliate coverage schema). Out of scope for functional testing — placeholder only.

---
### Super Admin / Finance-Compliance Ops (India GST & tax operator)
**App:** `web-admin-storefront`  |  **Port:** 4000 (api 8000)

This persona owns Sportsmart's India tax/GST compliance posture from one hub at /dashboard/tax: it flips the tax-engine mode (OFF/AUDIT/STRICT), clears audit-readiness blockers, runs the IRN/e-invoice and e-way-bill lifecycles, generates GSTR-1 / GSTR-3B / GSTR-8(TCS) and §194-O TDS filings, manages credit notes, and curates reference data (HSN/UQC masters, platform-GST profiles, seller-GSTIN verifications). Almost every external integration here runs in a deterministic STUB in dev (no real NIC/GSTN portal calls), so stub IRNs/EWBs/checksum-verifications are the EXPECTED dev behavior, not bugs. Seller/franchise/affiliate portals get read-only mirror views (TCS summary + §52(5) cert, tax-invoice download with IRN field, §194-O Form 16A).

#### [P0] Tax mode toggle (OFF/AUDIT/STRICT) + history
- **Route:** `/dashboard/tax/mode (also inline on /dashboard/tax)`
- **Steps:** Open /dashboard/tax/mode; note the Current-mode hero pill and the three Switch-to cards (OFF=danger, AUDIT=warning, STRICT=recommended). → Click 'Switch to AUDIT'; confirm the consequences dialog; observe success banner 'Tax mode set to AUDIT'. → Click 'Switch to STRICT'; confirm the harder dialog warning checkouts/invoices can be rejected. → If audit-readiness has blockers, expect a 409 error banner (STRICT flip is gated unless forced). → Scroll to 'Recent changes' table; verify a new OLD->NEW row appears with actor id/role and timestamp. → Cross-check the mini mode control + KPI on the /dashboard/tax hub reflects the same mode.
- **Expected:** Mode persists across refresh; each change appends an audit row (action=TAX_MODE_CHANGED) visible in the history table; STRICT is rejected with a clear blocker message when readiness is not clear.
- **Verify:** POST /admin/tax/reports/mode returns new mode; GET /admin/audit?module=tax-mode shows the OLD->NEW entry; the hub KPI 'Engine mode' chip color matches (STRICT=green/AUDIT=amber/OFF=neutral); a blocked STRICT flip surfaces the unresolved-blocker count, not a silent success.
- ⚠️ **Caveat:** TAX_STRICT_MODE defaults to false; a fresh dev DB usually reads OFF or AUDIT. STRICT flip only succeeds when readiness shows zero blockers (or force) — in dev with seeded gaps a 409 is the correct, expected outcome, not a bug.

#### [P0] Audit-readiness dashboard scans + STRICT export gate
- **Route:** `/dashboard/tax`
- **Steps:** Open /dashboard/tax; let the KPI strip + 'Audit readiness' card load. → Read the blockers table: each check row shows a friendly title, raw code, severity chip, count, sample IDs, and a 'Fix' jump link. → Click a blocking row's Fix link (e.g. 'Open seller GSTINs' / 'Bulk-verify config' / 'Open products?taxStatus=missing_hsn') and confirm it routes to the right remediation surface. → Note the Verdict pill: 'Ready' (green) vs 'N blockers' (red). → Switch engine mode to STRICT (or have it STRICT), then attempt a GSTR CSV download from the Filings section while blockers exist.
- **Expected:** Dashboard shows real per-check counts with sample IDs; in STRICT mode a CSV/JSON export is BLOCKED (HTTP 422/403-style error) unless acknowledgeBlockers=true is sent and the operator holds tax.reports.overrideBlockers.
- **Verify:** GET /admin/tax/audit-readiness returns blockers[] with code/severity/count/sampleIds; in OFF/AUDIT exports are unrestricted; in STRICT the controller rejects the export with a 'Cannot export … in STRICT mode: N blockers' message and only proceeds with ?acknowledgeBlockers=true + override permission; a failed readiness load shows the amber 'Unavailable — do not assume clear' banner (never a false green).
- ⚠️ **Caveat:** Scanners read live seed data, so counts are nonzero in dev (missing HSN/UQC/GSTIN are normal). The STRICT-export gate only bites when mode is STRICT; in the default OFF/AUDIT dev posture exports always download — that is correct.

#### [P0] E-invoice (IRN) generate / view / cancel
- **Route:** `/dashboard/tax/einvoices`
- **Steps:** Open /dashboard/tax/einvoices; read the amber 'Stub provider active' banner. → Use the Pending tab; on a PENDING B2B document click 'Generate IRN'. → Confirm the success banner shows a minted IRN + ack number, and the row flips to GENERATED with a 24h cancel-window countdown. → Within 24h click 'Cancel', pick a CBIC cancel code (1–4), enter a reason, confirm; row reflects the cancellation. → On a FAILED row, click 'Retry IRN'; on a >24h GENERATED row, confirm the action shows 'Past 24h' (cancel disabled). → Open the underlying order's tax-invoice (seller/franchise download or PDF) and confirm the IRN + Ack No + Ack Date + QR block renders on GENERATED docs only.
- **Expected:** IRN mints instantly; GENERATED rows show IRN/ack/cancel-window; cancel within 24h succeeds; past 24h is correctly gated to a Credit Note path; the printed invoice shows the e-invoice/IRN block for GENERATED documents.
- **Verify:** POST /admin/tax/einvoices/:id/generate returns irn+ackNo; status flips PENDING->GENERATED; cancel POST flips to CANCELLED; KPI strip recomputes (Awaiting IRN, Active IRNs, Cancellable now); invoice HTML template renderEinvoiceBlock only appears when einvoiceStatus=GENERATED.
- ⚠️ **Caveat:** EINVOICE_PROVIDER defaults to stub: IRNs are DETERMINISTIC 64-char hex per (supplier, document, date), not real NIC IRP IRNs. A stub IRN/QR is the expected dev output — do not flag it as fake. Real NIC needs EINVOICE_PROVIDER=nic + adapter.

#### [P0] E-way-bill generate / view / cancel / override
- **Route:** `/dashboard/tax/eway-bills`
- **Steps:** Open /dashboard/tax/eway-bills; read the amber stub-provider banner. → Filter to the REQUIRED tab; on a consignment >₹50,000 open 'Generate' and submit transport/vehicle details. → Confirm the row flips to GENERATED with an EWB number and a validity window. → Cancel a GENERATED EWB within 24h via the reason modal; confirm cancellation. → On a REQUIRED/FAILED row that cannot get an EWB, use 'Override' with a reason; confirm 'Override stamped — ship guard will allow dispatch'. → Check KPIs: Action needed, Active EWBs, Expiring <24h, Overrides.
- **Expected:** EWB generates with a number + validity; cancel and admin-override both update the row and the ship-guard; overrides are audit-stamped with the admin id/reason.
- **Verify:** POST /admin/tax/eway-bills/:id/generate|cancel|override updates status; overrideAdminId is set on overridden rows; the sub-order ship-guard reflects GENERATED-or-overridden so dispatch is allowed; KPI counts recompute.
- ⚠️ **Caveat:** EWAY_BILL_PROVIDER defaults to stub: numbers are EWB-STUB-<uuid> placeholders, not real NIC e-Waybills. Stub EWBs are the expected dev output. Override is a deliberate break-glass path, not an error.

#### [P1] GSTR-1 export (per-seller §4 B2B + section CSV)
- **Route:** `/dashboard/tax (Filings → GSTR-1 / GSTR-3B card)`
- **Steps:** Scroll to 'GSTR-1 / GSTR-3B — Per-seller'. → Enter a Seller ID (uuid) and filing period (YYYY-MM). → Click '§4 B2B CSV' and confirm a CSV downloads. → Pick a section (B2C-large §5, B2C-small §7, Credit Notes §9B, HSN §12, Docs §13) and click 'Section CSV'. → Open the CSVs and confirm the columns mirror the official GSTR-1 template for that section.
- **Expected:** Per-section CSVs download with the correct official column headers and per-invoice/aggregated rows for the chosen seller+period; an invalid/empty seller or period disables the buttons.
- **Verify:** GET /admin/tax/reports/gstr1.csv?sellerId=…&filingPeriod=… and /admin/tax/reports/gstr1/<section> stream a CSV; B2B rows carry IRN + IRN-date columns (NULL under stub provider); rate-0 lines are back-calculated; CSV cells are escaped against formula injection.
- ⚠️ **Caveat:** IRN/IRN-date columns will be NULL/blank because EINVOICE_PROVIDER=stub. §6 Exports / §8 Nil-rated sections may be empty where supplyTaxability isn't populated on older seed data.

#### [P1] GSTR-3B export (per-seller summary)
- **Route:** `/dashboard/tax (Filings → GSTR-1 / GSTR-3B card)`
- **Steps:** In the same per-seller card, with Seller ID + period filled, click 'GSTR-3B CSV'. → Open the CSV and confirm §3.1 (a)/(b)/(c)/(e) outward-supply lines and §3.2 inter-state breakdown are populated. → Confirm debit notes add to §3.1(a) and credit-note sign handling looks correct. → Note the outward-only disclaimer (ITC/inward §4/§5 sections are out of scope of platform data).
- **Expected:** GSTR-3B CSV downloads with the consolidated §3.1 / §3.2 outward-supply summary for the seller+period; zero/negative values are clamped with a warning rather than producing garbage.
- **Verify:** GET /admin/tax/reports/gstr3b.csv?sellerId=…&filingPeriod=… returns the §3.x summary; §3.1(a) is the consolidated net (B2B/B2C split is a GSTR-1 concept, intentionally absent here); inward ITC sections carry the disclaimer (platform lacks seller purchase data).
- ⚠️ **Caveat:** GSTR-3B is outward-only by design; §4 ITC / §5 / §6.x inward sections are intentionally blank with a disclaimer (no seller purchase data on the platform). Same stub-IRN caveat as GSTR-1.

#### [P1] GSTR-8 / TCS lifecycle (load → file → pay → certify → reverse + CSV/JSON)
- **Route:** `/dashboard/tax#gstr8 (Filings → GSTR-8 card)`
- **Steps:** Pick a completed filing period (future months are blocked) and click 'Load summary'. → Review per-supplier rows (gross/net/TCS, status) and the totals + carry-forward + rate-variance warnings. → Select rows, enter the GSTN ARN, click 'Mark FILED'; then enter a CIN/UTR and click 'Mark PAID_TO_GOVT'. → Select PAID rows, set a cert prefix, click 'Issue certificates'; open a CERTIFICATE_ISSUED row's cert number link to view the §52(5) certificate. → Use per-row 'Reverse' with a reason for a correction; download CSV and JSON for the period.
- **Expected:** Status flows COMPUTED→FILED→PAID_TO_GOVT→CERTIFICATE_ISSUED; ARN required to file; CIN/UTR required to pay; skipped (wrong-state) rows are listed; CSV and JSON download with the official GSTR-8 columns; §52(5) certificate renders.
- **Verify:** POST /admin/tax/tcs/mark-filed (echoes nicArn + flipped/requested + skipped[]), /tcs/mark-paid, /tcs/mark-certificates-issued; GET /admin/tax/reports/gstr8.csv and .json; GET /admin/tax/tcs/certificate/:id renders HTML cert; reverse posts a reason and flips to REVERSED; carry-forward + rate-variance warnings surface when present.
- ⚠️ **Caveat:** ARN/CIN are operator-entered free text in dev (no NIC validation). The operator GSTIN on the JSON is resolved server-side from the default PlatformGstProfile — if none is set, expect a readiness blocker (platform.gst_profile_missing).

#### [P2] §194-O TDS (Form 26Q deposit + Form 16A) lifecycle
- **Route:** `/dashboard/tax/tds194o`
- **Steps:** Open /dashboard/tax/tds194o and load a filing period/quarter. → Review withheld-but-undeposited TDS rows. → Mark rows DEPOSITED with a challan reference; then Mark Form 16A certificate issued. → Download the Form 26Q CSV for the quarter; download a Form 16A for an issued row. → Cross-check the affiliate portal /dashboard/tax-documents shows the matching quarterly TDS + Form 16A becomes downloadable.
- **Expected:** TDS rows progress withheld→deposited→certificate-issued; Form 26Q CSV and per-recipient Form 16A download; affiliate-facing Form 16A unlocks only after the certificate is issued.
- **Verify:** GET /admin/tax/tds194o?filingPeriod=…; POST /admin/tax/tds194o/mark-deposited and /mark-certificate-issued; GET /admin/tax/reports/form26q.csv and /reports/form16a/:id; affiliate page canDownloadForm16A flips true post-issuance.
- ⚠️ **Caveat:** §194-O determination + historical 10% correction are pending finance/legal sign-off (config-default section). Challan refs are operator-entered; no real TIN-Protean submission in dev.

#### [P1] Credit-note register + partial-coverage flags
- **Route:** `/dashboard/tax/credit-notes`
- **Steps:** Open /dashboard/tax/credit-notes. → Filter by filing period, status (PDF_PENDING/GENERATED/FAILED, PARTIALLY/FULLY_REVERSED), and optionally Seller ID; click Refresh. → Inspect rows: CN number, date, original invoice, buyer GSTIN, taxable/tax/cess/total, status, and customer-notified state. → Hover a 'PARTIAL' badge to read how many approved lines lacked a snapshot. → Confirm B2C rows show 'B2C' instead of a GSTIN and a 'Notified' marker appears once the customer was emailed.
- **Expected:** All §34 credit notes for the filter are listed with correct money amounts and status; partial-coverage CNs are flagged; customer-notified state is visible.
- **Verify:** GET /admin/tax/credit-notes?filingPeriod=&status=&sellerId=&limit=200 returns items with partialCoverageLineCount, customerNotifiedAt, and proportional cess; amounts match the originating return; CN generation itself is driven from the return/dispute flow (advisory-locked to avoid duplicates).
- ⚠️ **Caveat:** Credit notes are GENERATED by the return/QC + STRICT-snapshot flow, not minted from this register page (read-only). Legacy orders missing a tax snapshot show PARTIAL coverage by design.

#### [P2] HSN / UQC master management
- **Route:** `/dashboard/tax/hsn-master and /dashboard/tax/uqc-master`
- **Steps:** Open /dashboard/tax/hsn-master; search an HSN code. → Create a new HSN with an effective-dated GST rate; edit an existing one (rate change carries an effective date + version/OCC). → Deactivate then reactivate an HSN row and confirm the active flag toggles. → Repeat the create/edit/activate flow on /dashboard/tax/uqc-master for a Unit Quantity Code. → Confirm changes are reflected where products/invoices read HSN/UQC (and clear the related readiness blockers product.missing_hsn / product.missing_uqc after products are re-attested).
- **Expected:** HSN/UQC rows create/edit/activate with optimistic-concurrency (expectedVersion) and audit history; effective-dated rate changes apply at invoice time; masters drive the product attestation gate.
- **Verify:** POST /admin/tax/hsn, PATCH /admin/tax/hsn/:id (and /uqc equivalents) with expectedVersion succeed and bump version; a stale version is rejected (OCC); audit/history rows are written; readiness blockers for missing HSN/UQC drop after products consume the new codes.

#### [P1] Seller-GSTIN verification decision (+ 194-O exemption)
- **Route:** `/dashboard/tax/seller-gstins`
- **Steps:** Open /dashboard/tax/seller-gstins on the Unverified tab. → Pick an active seller GSTIN row and click 'Verify'; read the outcome banner (verified status, or 'legal-name mismatch'). → Confirm the row moves out of Unverified and the verifiedAt/verifiedBy/notes columns stamp. → Use the MISMATCH tab to find legal-name mismatches surfaced by the fuzzy name match. → Open the §194-O exemption modal on a seller, choose grant/revoke, enter a ≥8-char reason, save; confirm the success banner.
- **Expected:** Verify stamps isVerified + provider/status/notes (or flags a mismatch without marking verified); the dashboard's seller.missing_gstin / legal_name_mismatch blockers reflect the result; 194-O exemption requires an explicit choice + documented reason for both grant and revoke.
- **Verify:** POST /admin/tax/seller-gstins/:id/verify returns {verified, status, legalNameMismatch}; persisted isVerified/legalNameMismatch are queryable; POST /admin/tax/sellers/:id 194-O exemption records the reason + audit; counts (Verified/Unverified/Mismatch/Primary) recompute.
- ⚠️ **Caveat:** GSTN_PROVIDER defaults to stub: verification is a local Mod-36 checksum (well-formed GSTIN passes), NOT a real GSTN-portal lookup. A 'verified' stub result is expected dev behavior; legal-name match is fuzzy. STRICT mode hard-gates checkout on unverified seller GSTINs.

#### [P2] Platform-GST profile config (default + activate/deactivate)
- **Route:** `/dashboard/tax/platform-gst`
- **Steps:** Open /dashboard/tax/platform-gst on the Active tab. → Create a new platform GSTIN profile (state, GSTIN, registration type). → Promote a non-default profile to default via the reason modal; confirm the previous default is demoted but stays active. → Try to deactivate the current default and confirm it is blocked ('promote another first'); deactivate a non-default with a reason; reactivate it. → Confirm exactly one default exists and it drives OWN_BRAND/SPORTSMART supply identity.
- **Expected:** Set-default and deactivate both require a reason and are audited; the default profile cannot be deactivated; a single DB-enforced default remains; the platform.gst_profile_missing readiness blocker clears once a default exists.
- **Verify:** GET /admin/tax/platform-gst lists rows; POST /admin/tax/platform-gst/:id/set-default (reason) demotes prior default; PATCH /admin/tax/platform-gst/:id {isActive,deactivationReason,expectedVersion} with OCC; deactivating the default is rejected; audit/history rows written.

---