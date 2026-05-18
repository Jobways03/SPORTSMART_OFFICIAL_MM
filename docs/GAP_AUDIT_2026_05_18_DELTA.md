# SportSmart Marketplace — Gap Audit Delta (2026-05-18)

**Audit Date:** 2026-05-18
**Baseline:** `docs/GAP_AUDIT_2026_05_16.md` (166 items)
**Method:** 4 parallel deep-dive sweeps re-verifying every cited file:line against current code, plus fresh-look gap analysis in each agent's scope.
**Files changed since 05-16:** 346

## TL;DR — Status Counts (vs. 05-16 baseline, updated post 05-18 session work)

| Bucket | Count | Notes |
|---|---:|---|
| **RESOLVED** (baseline item is no longer present) | **~48** | ~33 from pre-session audit + ~15 closed in the 05-18 session — see "Major Wins" |
| **STILL OPEN** (baseline item confirmed present in current code) | **~80** | Mostly medium/low items + a handful of CRITs |
| **PARTIAL** (mitigated but not fully closed) | **~10** | E.g. wallet idempotency race narrowed but not eliminated; franchise procurement gets tax-invoice link but no per-line snapshot |
| **CHANGED** (file refactored — finding may not apply, replacement opaque) | **~5** | Inventory use-cases removed; replacement is via commands/services but writes need functional verification |
| **NEW gaps found** | **~15** | Mix of fresh sweep + new dead-code stubs introduced post-05-16 |

Numbers are approximate — agent classifications had some inconsistencies which I reconciled where I spot-verified (see "Conflicts I Resolved" at bottom).

---

## Major Wins Since 05-16 (high-confidence RESOLVED)

These were significant audit findings and they're now demonstrably fixed:

1. **All 8 frontends now have `error.tsx` + `not-found.tsx`.** Previously a §8.x complaint across the board. Verified all 8 directories.
2. **Email XSS in order + return templates fixed.** Both now use a `safeHtml` tagged-template literal that escapes interpolated values. (`notifications/order-notification.handler.ts:83-94`, `returns/return-notification.handler.ts:78-143`)
3. **16 production-required spec files added** in `apps/api/test/unit/*-prod-required.spec.ts`. These boot-time gates enforce critical env flags as `true` in production:
   - `WALLET_LEDGER_RECON_ENABLED`, `REFUND_GATEWAY_RECON_ENABLED`, `PERMISSIONS_GUARD_STRICT`, `OUTBOX_ENABLED`, `REFUND_SAGA_ENABLED`, `AUDIT_CHAIN_ANCHOR_ENABLED`, `INTEGRITY_VERIFIER_ENABLED`, `ERASURE_PROCESSOR_ENABLED`, `CRON_HEARTBEAT_ENABLED`, `COD_REFUND_PENDING_ENABLED`, `RETENTION_ENFORCER_ENABLED`, `EVENT_DEDUP_ENABLED`, `SLA_BREACH_DETECTOR_ENABLED`, plus money/saga/CORS/JWT-TTL/idempotency policy specs.
   - Note: `env.schema.ts` defaults are now `true` for those that need to be on by default. Closes a *huge* class of "off-by-default in prod" gaps.
4. **Search reindex fully implemented** — was a stub. Now streams catalog in 500-product pages with per-product retry. (`search/application/facades/search-public.facade.ts:139-220`)
5. **Refund split calculator fully implemented** — 4-branch logic (wallet-only / gateway-only / split / no-order) with leg-suffix idempotency. (`refund-instructions/application/services/refund-split-calculator.service.ts:61-205`)
6. **Audit module write path refactored** — dead use-cases replaced with `AuditPublicFacade.writeAuditLog` / `writeEventLog`. (`audit/application/facades/audit-public.facade.ts:12-36`)
7. **Seller onboarding wired end-to-end** — `submit-seller-onboarding`, `approve-seller`, `reject-seller` all implemented with PAN↔GSTIN validation, profile completion percent, event publish.
8. **Graceful SIGTERM/SIGINT shutdown** — explicit handlers with 30s grace, in-flight drain, lock release. (`main.ts:42-97`)
9. **Dockerfile base image digest pinned** — `sha256:689c11043dad…` instead of placeholder. Reproducible builds restored.
10. **HSTS now enabled in production AND staging**; `'unsafe-inline'` removed from `styleSrc` CSP. (`main.ts:144,163`)
11. **Admin escalation email env-driven** — `ADMIN_ESCALATION_EMAIL` with fallback + warning log instead of hardcoded `admin@sportsmart.com`. (`returns/return-notification.handler.ts:32-41`)
12. **Wallet admin UI now formats paise correctly** — `formatPaise()` delegates to `paiseToRupeesString()` from shared-utils. (`web-admin-storefront/services/admin-wallet.service.ts:142-153`, `dashboard/wallets/page.tsx:39,143`)
13. **WhatsApp 24h conversation window enforced** — template required outside window. (`integrations/whatsapp/adapters/whatsapp.adapter.ts:75-106`)
14. **Inventory `Uxxxx` stubs removed** — directory now has only `.gitkeep` (see CHANGED-with-concern below).

**Plus the 05-18 session deliveries (this doc's session):**

15. **Procurement `PENDING` → `SUBMITTED` enum fix** — franchise dashboard was sending invalid enum value causing 500s every minute. (`web-franchise/.../dashboard/page.tsx:83`)
16. **Three new `POST /api/v1/{admin,seller,franchise}/auth/refresh` endpoints** with rotating tokens — closes the 5-frontends-broken-refresh gap discovered during session. Each uses the correct per-actor JWT secret (`JWT_{ADMIN,SELLER,FRANCHISE}_SECRET`). End-to-end verified.
17. **Tax UI sweep — 10 items closed** in one session:
    - **CRITICAL #1 Franchise POS GST** — schema +10 columns (`hsn_code`, `gst_rate_bps`, `taxable_amount`, `cgst/sgst/igst_amount` on sale + items), tax-engine wired into `recordSale`, ViewSaleModal + success modal show full breakdown. Section 31 CGST Act compliance restored.
    - **CRITICAL #2 Customer checkout/order tax** — checkout shows "GST — Included in price" line, customer order detail page now shows full CGST/SGST/IGST breakdown card. Backend `getCustomerOrder` extended to return `taxSnapshots` + `taxSummary`.
    - **HIGH #3 Seller-admin order tax** — `DiscountGstBreakdownCard` ported into web-admin, mounted on order detail page.
    - **HIGH #4 Affiliate self-TDS** — new `GET /affiliate/me/tds` endpoint + `/dashboard/tds` page + nav entry. Affiliate can now see Form-26Q-ready cumulative deductions per FY.
    - **HIGH #5 Franchise invoice list** — new `franchise/tax-documents` controller (filters via `subOrder.franchiseId` since franchise tax docs have `sellerId=null`), `tax-document-download.service.ts` scope check widened to recognise franchise, new `/dashboard/tax/invoices` page + sidebar entry.
    - **HIGH #6 Franchise procurement tax** — context note + invoice link on franchise + admin procurement detail pages. **Partial:** per-line tax snapshot still deferred (procurement schema has no tax columns).
    - **HIGH #7 Franchise-admin tax oversight** — new `GET /admin/franchises/:id/tax-summary` (GSTIN/state + aggregate CGST/SGST/IGST + recent docs), new "Tax / GST" tab on franchise detail page.
    - **MED #8 Seller sidebar Tax Invoices link** — page existed at `/dashboard/tax/invoices` but only reachable via order detail; now in main nav.
    - **MED #9 Cart estimated-tax placeholder** — "Estimated tax — Calculated at checkout" replaced with "GST — Included in price" (truthful given inclusive-pricing reality).
    - **MED #10 HSN per-product chips** — seller my-products page now shows HSN + GST rate + UQC chips per row (amber warning when missing). Backend my-products DTO extended.
18. **Download scope-check bug fix** — `tax-document-download.service.ts` previously rejected every franchise download (`doc.sellerId === actor.id` never matched because franchise docs store `sellerId=null`). Widened to look up `subOrder.franchiseId` for FRANCHISE actors.
19. **GSTIN mandatory policy** (2026-05-18 policy change):
    - Backend: `submit-seller-onboarding.use-case.ts` throws if GSTIN missing or `UNREGISTERED`; `approve-seller.use-case.ts` refuses approval without GSTIN + PAN.
    - Frontend onboarding: `UNREGISTERED` option removed from dropdown; GSTIN + state code always required.
    - **Schema unchanged** — `gstin` stays nullable. Legacy `UNREGISTERED` sellers in the DB keep operating; policy applies forward. The admin seller detail page surfaces an amber "Policy gap" warning for these.
20. **Seller profile Tax/GST visibility** — `GetSellerProfileUseCase` now returns 9 GST/PAN fields; new "Tax / GST" card on `/dashboard/profile` shows Legal name, Registration type, GSTIN, State code, PAN (masked), verification badges. Closes the "I submitted GSTIN on onboarding but can never see it again" gap.
21. **Admin seller detail Tax/GST visibility** — `AdminGetSellerUseCase` now returns 11 tax fields; new "Tax / GST identity" Section on `/dashboard/sellers/[id]` with 6 `<TaxField>` chips. Amber policy-gap warning when GSTIN/PAN missing.

---

## CHANGED — needs functional verification

**Inventory write path (was D4-11 — top CRITICAL on 05-16).**
The four obfuscated stubs (`UsetUvariantUstockUseCase`, etc.) are removed. New `set-variant-stock.command.ts`, `reserve-stock.command.ts`, `release-stock.command.ts`, `deduct-stock.command.ts`, `adjust-stock.command.ts` exist alongside services. Controllers exist too. But **no static analysis confirms the commands actually write to the variant stock row inside a transaction**. Risk: same critical, different shape. Recommend: place a real order through checkout, confirm `variant.stockOnHand` decrements and a reservation row appears. If it doesn't, this is still CRITICAL.

---

## Still-Open CRITICAL items (top priorities)

1. **`PERMISSIONS_GUARD_STRICT` is `default('true')` in env.schema.ts**, but the live admin panel may still have it overridden in `.env`. Verify the running API actually runs strict — if it falls back to "log-only," any user with a JWT but no permissions row can still hit admin endpoints. Test: hit `/admin/dashboard/kpis` with a low-privilege admin token and confirm 403.
2. **Dispute email XSS unresolved [D6-9].** `disputes/presentation/controllers/admin-disputes.controller.ts:100-135` — admin's free-form reply text is interpolated into the customer email without escaping. Confirmed still open. Exploitable today: any admin can inject HTML/JS into a customer's inbox.
3. **In-app + SMS notifications never dispatch [D6-3].** `notifications/application/use-cases/{send,enqueue}-notification.use-case.ts` are 1-line `Not implemented` stubs. However — `notification-router.service.ts` + `notification-worker.service.ts` + per-channel handlers DO exist. So actual dispatch happens via the event-handler path, not the use-cases. Verdict: stubs are dead code, but **need to confirm** in-app and SMS channels are wired into `notification-channel.service.ts`. If they're email-only, customers genuinely miss in-app/SMS notifications.
4. **COD UPI refund stuck in `MANUAL_REQUIRED` [D3-4].** `cod/refund-method-selector.ts:100-103` — UPI refund branch returns `requiresManualConfirmation=true` for what should be auto-NEFT/IMPS. Finance has to manually wire every UPI refund.
5. **Saga compensation idempotency [D3-10].** `payments-saga/refund-saga.service.ts:120-140` — no unique constraint guards against double-compensation. A retried compensation can refund twice.
6. **Stuck-saga sweep not implemented.** `payments-saga/jobs/stuck-saga-sweep.cron.spec.ts` references a service that doesn't exist. Sagas stuck `IN_PROGRESS` > 30 min are never resumed.
7. **Currency math `Number(BigInt)` at boundary [D3-11].** `payments-public.facade.ts:107-108` — for amounts > ~₹9 lakh in paise, the precision drift returns. The `shared-utils/money.ts` improvements help inside the calc, but the boundary cast is still there.

---

## Still-Open HIGH items (notable, prioritized)

| Domain | Title | File:Line |
|---|---|---|
| Auth | No customer / seller / franchise logout endpoints (server-side revocation) | `identity/application/**` |
| Auth | Refresh-token reuse detection missing for 3 new actor refresh endpoints we added today | Per-actor session tables need `previous_refresh_token` column (schema change) |
| Auth | MFA TOTP code valid for 30s window (anti-replay incomplete) | `admin-mfa/.../verify-challenge.use-case.ts:59-62` |
| Auth | Admin role list hardcoded, not synced from Prisma | `core/guards/admin-auth.guard.ts:16-22` |
| Tax | Tax Invoice PDF QR code stored but not embedded in template | `tax/.../tax-document-pdf.service.ts:145` |
| Tax | PDF storage adapter returns HTML, real binary path not wired | `tax-document-pdf.service.ts:69` |
| Tax | DPDP data export endpoint missing; consent tracking absent | identity / customer modules |
| Payments | Razorpay orphaned payment confirmation TODO | `payment-status-poller.service.ts:243-249` |
| Payments | Wallet bypassBlock has no audit row of who/why | `wallet.service.ts:48-50` |
| Payments | Wallet idempotency race — P2002 caught but txn#2 may apply mid-ledger | `wallet.service.ts:106-122` |
| Payments | Settlements period locking missing — retrospective adjustments unguarded | settlements module |
| Payments | Payouts can fire to unverified sellers (KYC not gated) | payouts module |
| Payments | Commission cron runs unconditionally (no env gate) | `commission-processor.service.ts:39-43` |
| Payments | Outbox publisher lock TTL 60s — mid-publish crash leaks lock for ~60s | `outbox-publisher.service.ts` |
| Commerce | Cart `moveToCart` race — item can sell between check & move | `cart.service.ts:106-114` |
| Commerce | Checkout allocation+reserve race | `checkout.service.ts:129-225` |
| Commerce | FSM allows DRAFT→ACTIVE skip on VariantStatus | `core/fsm/status-transitions.ts:274` |
| Commerce | Multi-seller discount not reversed on order reassignment | `orders.service.ts:1500-1660` |
| Commerce | No global reservation-expiry sweep cron | `inventory-public.facade.ts` |
| Commerce | SKU uniqueness not enforced — two sellers can share a SKU | `prisma-variant.repository.ts` |
| Commerce | Discount not reversed on partial return — customer keeps it | `discount-allocation.service.ts:844-848` |
| Commerce | Wishlist over-broad P2002 catch — future constraints silently swallowed | `wishlist.service.ts:102-130` |
| Commerce | Storefront menu reorder race — no parent/position lock | `storefront-menu/services/menu.service.ts:149-163` |
| Logistics | Shiprocket / iThink write ops not idempotent — duplicate shipments on retry | shipping adapters |
| Logistics | iThink webhook has no signature verification — forgeable | iThink webhook controller |
| Logistics | iThink credentials in request body — log capture risk | iThink integration |
| Returns | Dispute reply text unescaped in customer email | `disputes/.../admin-disputes.controller.ts:100-135` |
| Support | Support SLA ignores business hours — tickets penalized after-hours | support module |
| Support | Support replies not HTML-escaped in notifications | support module |
| Affiliate | Attribution not idempotent — same click counts commission twice | `affiliate-attribution.service.ts` |
| AI | Gemini hardcoded; no Anthropic fallback | `ai-content.controller.ts:8,125` |
| Comms | WhatsApp opt-out tracking missing, no idempotency, template-name not verified | `integrations/whatsapp/**` |
| Comms | Email lacks plain-text fallback, no bounce/DSN handling, no SMTP retry | `notifications/order-notification.handler.ts:88` |

---

## NEW Gaps Discovered (not in 05-16 audit)

| Sev | Type | Title | File:Line | Impact |
|---|---|---|---|---|
| LOW | DEAD-CODE | 8 orphaned `Uxxxx` obfuscated stub use-cases | `affiliate/application/use-cases/*.use-case.ts` (4 files), `franchise/application/use-cases/{create-franchise-profile,record-franchise-fee}.use-case.ts`, `notifications/application/use-cases/{send,enqueue}-notification.use-case.ts` | Verified zero references outside their own files. Real logic lives in `commands/` and `services/`. Should be deleted — same code-quality smell as the old inventory U-stubs. Not actively broken. |
| HIGH | SECURITY | Token storage in `sessionStorage` across all 7 authenticated frontends | `web-{admin,admin-storefront,seller,franchise,franchise-admin,affiliate,affiliate-admin}/src/lib/api-client.ts` | XSS exfiltration vector. The shared `apiClient` factory pattern reads/writes tokens from sessionStorage. Consistent across apps but uniformly insecure. Migrating to httpOnly cookies requires backend support. |
| HIGH | BUG | Admin-storefront orders page silently swallows API errors | `web-admin-storefront/src/app/dashboard/orders/page.tsx:140` | `.catch(() => {})` — when the API fails on initial load, page hangs on "Loading…" with no error UI, no retry. (We hit this earlier today in the browser.) |
| MED | A11Y | Modal overlays have onClick but no keyboard handlers (Escape close, focus trap) | `web-admin-storefront/.../products/components/delete-modal.tsx:36-37`, similar pattern across web-admin | Keyboard-only users can't dismiss modals. |
| MED | RESPONSIVE | 3 apps have zero Tailwind responsive breakpoints | `web-franchise-admin/**`, `web-affiliate/**`, `web-affiliate-admin/**` | 0 matches for `md:` / `lg:` classes. Dashboards are desktop-only — unusable below 1024px. |
| MED | CONFIG | API URL falls back to `http://localhost:8000/api/v1` if `NEXT_PUBLIC_API_URL` unset | `web-affiliate/src/lib/api.ts`, `web-affiliate-admin/src/lib/api.ts` | If env var missing in prod build, traffic never leaves the user's browser. Other apps have the same fallback but enforce the env via the shared-utils `resolveApiBase()` which throws in production — verify these two follow that. |
| MED | SEO | No `generateMetadata` per product page | `web-storefront/src/app/products/[slug]/page.tsx` | All product pages share root metadata. `robots.ts` + `sitemap.ts` exist but dynamic product routes aren't enumerated. |
| MED | PATTERN | 52 instances of `.catch(() => {})` across frontends | various | No unified error-handling pattern. Some legit (non-blocking wallet fetch), some hide real bugs (orders page hang). |
| MED | BUG | Settlement rounding tolerance hardcoded ±0.01 | settlement.service.ts | On ₹10M+ cycles can mask calc bugs or falsely reject valid cycles. |
| MED | GAP | No per-category commission override UI; only the 20% global fallback is surface-accessible | `web-admin-storefront/commission dashboard` | Commission fallback fires silently. |
| MED | SECURITY | Commission fallback (20%) has no audit row of which orders used it | `commission-processor.service.ts:110` | No retrospective view of how often the fallback fires or which sellers it affected. |
| HIGH | SECURITY | (Re-confirms a 05-16 finding but adds new context) Order notification `safeHtml` not applied to every interpolation path | `notifications/order-notification.handler.ts` | Some payment/courier fields still concatenated directly — needs a careful read; XSS partially mitigated. |
| MED | BUG | Notification dispatch for in-app + SMS channels unclear | `notifications/application/services/notification-channel.service.ts` | Need to confirm both channels are registered and actually transmit. If only email is wired, the audit's D6-3 stub finding morphs into a "channels not implemented" gap. |
| LOW | DEAD-CODE | Many `*.use-case.ts` files orphaned by command/service refactor | various modules under `application/use-cases/` | Cleanup opportunity. |
| LOW | SEO | Other (non-storefront) apps lack `robots.ts` — but probably intentional (no need to index admin panels) | most web-* | Verify intent. |

---

## Cross-Cutting Frontend Patterns (worth a focused PR each)

- **Token storage migration** — move all 7 auth'd apps from sessionStorage to httpOnly cookies. Requires backend cookie-issuing + CSRF tokens. One coordinated change, big security win.
- **Unified error-handling pattern** — replace `.catch(() => {})` with either a logged `.catch((err) => console.warn(...))` for non-blocking calls or proper error UI for blocking ones. 52 sites.
- **Modal accessibility hardening** — Escape-to-close, focus trap, return focus to opener. Single shared component across apps.
- **Responsive-everywhere pass** — add `md:` / `lg:` breakpoints to the 3 desktop-only apps.
- **`confirm()` → modal** — staff workflows break on mobile. Replace native confirms with the existing modal component.
- **`<img>` → `next/image`** on the customer-facing storefront for CLS prevention + WebP.

---

## Conflicts I Resolved Between Agents

1. **`PERMISSIONS_GUARD_STRICT` default.** Agent 1 said `false`, Agent 2 said `true`. I checked `apps/api/src/bootstrap/env/env.schema.ts:385` — `default('true')`. Agent 2 wins; the schema is authoritative over `.env.example`.
2. **`WALLET_LEDGER_RECON_ENABLED` default.** Same story — schema line 309 is `default('true')`. RESOLVED.
3. **`REFUND_GATEWAY_RECON_ENABLED` default.** Schema line 311 is `default('true')`. RESOLVED.
4. **Affiliate / franchise "NEW CRITICAL stubs".** Agent 3 flagged 6 newly-discovered stubs as CRITICAL blockers. I verified they're orphans (`grep` shows 0 references outside their own file) and the real logic lives in `affiliate/application/services/affiliate-commission.service.ts`, `franchise/application/services/`, etc. **Downgraded to LOW (dead code cleanup).** Not a blocked flow.

---

## Recommended Attack Order (compressed, updated post 05-18 session)

1. **Verify inventory writes work end-to-end** (place a test order, watch the stock row). If they don't, this is CRITICAL again.
2. **Fix dispute email XSS** [D6-9] — small change, real security exposure.
3. **Add `previous_refresh_token` column** to the 3 actor session tables, enable reuse-detection for the refresh endpoints shipped this session.
4. **Verify the 16 prod-required env gates actually fire on boot** — start the API with one of them set to `false` and confirm it refuses to boot.
5. **Fix COD UPI refund selector** [D3-4] — finance team is doing manual work for what should be automatic.
6. **Confirm in-app + SMS channels are wired in `notification-channel.service.ts`** — if they aren't, that's a real customer-facing gap.
7. **Fix the orders-page hang on API error** in web-admin-storefront — `.catch(() => {})` → user-visible error + retry button.
8. **Delete the 8 orphaned `Uxxxx` stubs** to make the codebase honest about what's implemented.
9. **Settlement saga: implement stuck-saga sweep, fix compensation idempotency.**
10. **Token-storage migration** (sessionStorage → httpOnly cookies) — coordinated backend + frontend PR.
11. **Procurement per-line tax snapshot** — finish item #6 properly: add tax columns to `procurement_request_items`, wire tax engine at approve/dispatch, render per-line CGST/SGST on procurement detail. The 05-18 session added context notes + invoice link; this is the structural follow-up.
12. **Backfill or block legacy `UNREGISTERED` sellers** — the 05-18 GSTIN-mandatory policy applies forward. Either re-prompt existing sellers to add GSTIN, or admin-side bulk action to soft-suspend until they comply.
13. **Admin edit-seller form: add GST/PAN fields** — admin can view GSTIN on the detail page now, but `admin-edit-seller.dto.ts` doesn't accept those fields. Admin can't fix a typo without making the seller redo onboarding.

---

## Notes on Verification Confidence

- CRITICAL and HIGH items were verified by reading the cited file and checking the specific function/symbol against current code.
- MEDIUM items got a spot-check pass — many were verified but a handful are trusted from the baseline.
- LOW items are largely passed through from the baseline without re-verification (the cost/benefit doesn't justify it).
- Where an agent's classification disagreed with my own spot-check, I noted it in "Conflicts I Resolved" above.

For full per-item granularity, the 05-16 audit (`docs/GAP_AUDIT_2026_05_16.md`) is still the canonical reference. This delta document tells you what's changed.
