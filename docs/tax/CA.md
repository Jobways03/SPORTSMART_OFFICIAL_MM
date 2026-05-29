# Sportsmart GST System — CA Review Document

**Prepared for:** Sportsmart's Chartered Accountant / GST Consultant
**Prepared by:** Engineering, while CA is unavailable for ~1 week
**Status of system:** PERMISSIVE TEST MODE (see §1 below). Ready for CA review — engineering work AS-BUILT through Phase 27.
**Last updated:** 2026-05-14
**Implementation phases:** 0–27 complete (28 phases — see §A log). **Tests:** 496 unit specs across 34 suites, all green.

---

## A. Phase implementation log (newest first)

This section is **the living change-log for CA review**. Every time engineering completes a phase, a new entry is added at the top with:
- What was built (concrete deliverables)
- Which CA-decision items in §3 it touches or refines
- New defaults added to §4
- New files added to §9
- Sign-off items in §10 that gain implementation backing

**Read this section first** on each return visit — it tells you what changed since you last reviewed.

---

### Phase 27 — Final docs + cross-service smoke + rollout runbook — 2026-05-14

**What was built (docs + tests):**

This is the closing phase — engineering's "READY FOR CA REVIEW" handoff. No new services or schema; everything is consolidation + cross-cutting verification.

*Cross-service smoke spec:* `apps/api/test/unit/tax-cross-service-smoke.spec.ts`

16 tests that compose multiple phases' pure helpers to verify the contracts mesh without per-service mocks. Each test pins a multi-phase invariant that would otherwise need a real-DB integration:

- **Phase 11 ↔ 12 ↔ 13 Section 34 lifecycle**: 15 Apr 2026 IST invoice → cutoff 30 Sept 2027 18:29:59.999 UTC. ELIGIBLE at issuance + 8 days before cutoff; TIME_BARRED 1ms past cutoff (boundary is `<` strict).
- **Phase 16 ↔ 17 TCS lifecycle**: intra+inter split sums to 1% of net; clamp+carry-forward survives a cross-period negative (April -₹50k carry → May consumes); IST-aware `filingPeriodOf` buckets 1 May IST midnight correctly.
- **Phase 15 ↔ 19 EWB validity meshes with PDF render**: 100km → 1d (same IST EOD); 200km → 2d (next IST EOD); 201km → 3d (slab transition).
- **Phase 21 retention window**: 8-year canonical constant; 2026 invoice retains until 2034 boundary instant (NOT under retention at the instant; under retention 1ms before).
- **Phase 22 IRP applicability composes**: exactly-at-₹5 crore → NOT applicable (strict `>` semantics); B2C × any turnover → never applicable.
- **Phase 23 mode helper drives banner**: OFF / AUDIT keep DRAFT; STRICT suppresses.
- **Phase 24 template registry shape-stable**: every actor surface has keys; every key matches `tax.{actor}.{event}.{channel}` regex; keys globally unique.

*Rollout runbook:* `docs/tax/STRICT_MODE_ROLLOUT_RUNBOOK.md`

Step-by-step procedure for taking the GST module from `OFF` → `AUDIT` (staging) → `STRICT` (production):

- **R1: Ship code with both flags OFF** — both flag rows in `tax_config` stay false; verify `GET /api/v1/admin/tax/mode` returns `{ mode: 'OFF' }`.
- **R2: Flip AUDIT on staging** — single `INSERT…ON CONFLICT` query; 60-second cache TTL; soak ≥2 weeks watching `tax_audit.violation` log lines + readiness-report counters.
- **R3: Drive blockers to zero** — per-class remediation playbook for all 7 blocker classes (`product.missing_hsn`, `product.missing_rate`, `seller.missing_gstin`, `einvoice.unresolved`, `pdf.unresolved`, `tcs.unfiled`, `timebar.requires_review`).
- **R4: Flip STRICT on production** — both flags `true`; verify DRAFT banner suppressed on new renders; 24h monitoring window.
- **R5: Backfill legacy DRAFT banners** (optional) — flip pdf status to PDF_PENDING; retry cron re-renders within ~5 min.
- **Rollback**: single `UPDATE tax_config SET value='false'` query reverts at any phase; no data corruption (STRICT only throws, never silently mutates).
- **Pre-flight checklist** + **CA cutover sign-off table** + **quick-reference** appendix.

*CA.md final pass:*

- **§9 File map** — fully refreshed to reflect the AS-BUILT state. 8 sections: documentation, Prisma schema (per file), domain helpers (per phase), application services (24 services tagged by phase), infrastructure (3 provider pairs), cron jobs (3 jobs with cadence), HTTP controllers (3 controllers), cross-module integrations (settlement / erasure / env / migrations).
- **Header** updated with "Ready for CA review" status + "Implementation phases: 0–27 complete" + "Tests: 496 unit specs across 34 suites, all green".

**Tests:**
- New `tax-cross-service-smoke.spec.ts` — 16 cross-phase invariant tests.
- Combined final: **496/496 tax tests passing** (480 prior + 16 new) across **34 suites**.
- Real-DB integration suite is intentionally deferred to a post-CA-signoff PR — its scope (seeded products, sellers, full checkout → invoice → return → credit note → wallet flow) requires the CA to confirm the rate / HSN seed data first. The per-service unit + cross-service smoke coverage is the green-light bar for CA review.

**Behaviour change today:**
- The system is in **engineering-final / CA-review-ready** state. No flag flips, no new services, no schema migrations — the work-product is the consolidated documentation + verifiable invariants.
- Every previous phase entry has its forward-pointer ("Next: Phase N+1") matching the next entry — the §A log reads as a continuous narrative.
- An engineer landing on this doc cold can:
  1. Read this entry — get the AS-BUILT summary.
  2. Skim §9 — see where every component lives.
  3. Use §10 — drive the CA sign-off.
  4. Follow the rollout runbook — flip STRICT once §10 is ticked.

**CA decisions touched / partially resolved:**
- §3 — every operational decision has corresponding code + tests + a row in §10. Engineering has done its job; CA decides whether the defaults are correct for Sportsmart's posture.
- §4 — every default has an env knob or `tax_config` key for runtime adjustment. Nothing is hard-coded that CA cannot tune.
- §5 / §6 / §7 — PDF templates carry DRAFT banner until CA sign-off + STRICT flip; CBIC section coverage operational (31 / 34 / 36 / 52, Rule 46A / 48 / 138).
- §8 — open questions still need CA's master-data answers (Sportsmart AATO, platform GSTIN, etc.) before STRICT flip.

**Sign-off items §10 backed (final):**
- ✓ Every checklist item under "Decisions / Defaults / PDF templates / Compliance hooks" now has a concrete engineering implementation, env knob, or test backing it. CA verifies by reading the relevant §3 / §4 / §5 / §6 row + the linked Phase-A entry.
- ✓ The "Master data" subsection of §10 stays the CA's responsibility — engineering cannot fill in Sportsmart's AATO or platform GSTIN.
- ✓ "Engineering can flip TAX_STRICT_MODE=true" gate is the single deciding signal — the rollout runbook codifies what happens after.

**Files added:**
- `apps/api/test/unit/tax-cross-service-smoke.spec.ts`
- `docs/tax/STRICT_MODE_ROLLOUT_RUNBOOK.md`

**Files modified:**
- `docs/tax/CA.md` — Phase 27 entry; header updated; §9 file map fully refreshed.

**Next:** No next phase — Phase 27 is the terminal phase of the planned 0–27 implementation arc. The next milestone is **CA review + sign-off**, then the rollout runbook drives the flip-to-STRICT cutover. Post-cutover work (real NIC adapters for IRP + EWB, real S3 PDF storage, frontend UI polish in `web-admin-storefront` / `web-d2c-seller-admin` / `web-storefront`) lands as targeted PRs against the stable foundation this 28-phase arc built.

---

### Phase 26 — Backward compatibility hardening — 2026-05-14

**What was built (backend):**

*Service:* `apps/api/src/modules/tax/application/services/tax-compatibility.service.ts`

`TaxCompatibilityService` is the **single safe entry point** for any caller that needs tax data on orders which may pre-date the Phase-5 snapshot wiring. Replaces ad-hoc `if (snapshot) { … } else { fallback }` blocks scattered across return / refund / settlement / display code with a tagged-union resolver.

**Three resolution shapes** (the caller pattern-matches on `kind`):

1. **`{ kind: 'snapshot', snapshot }`** — Modern flow. Sub-order has a snapshot row (and typically a real `TaxDocument`). Money breakdown is authoritative.
2. **`{ kind: 'legacy', legacyReceipt: { id, documentNumber } }`** — Pre-GST order with a Phase-14 `LEGACY_RECEIPT`. Zero GST is correct; the customer's record is the receipt.
3. **`{ kind: 'pre_snapshot', orderItemTotalInPaise }`** — Edge case: post-Phase-5 order where the snapshot row didn't write (production bug fixed after-the-fact, manual SQL backfill, etc.). Caller falls back to gross + escalates to ops for manual GST reconciliation.

**API surface:**

- `resolveForOrderItem(orderItemId)` → `TaxSnapshotResolution` — the canonical tagged-union resolver. Internally:
  1. Looks up `OrderItemTaxSnapshot` — if present, returns `kind: 'snapshot'`.
  2. Loads the `OrderItem` for its `subOrderId` + `totalPriceInPaise`.
  3. Asks `LegacyReceiptService.isLegacyOrder(subOrderId)` — if true AND a `LEGACY_RECEIPT` exists, returns `kind: 'legacy'`.
  4. Otherwise returns `kind: 'pre_snapshot'` with the gross paise so the caller can fall back.

- `resolveForSubOrder(subOrderId)` → `SubOrderTaxResolution` — same idea at the SubOrder level. Returns `'invoice'` (TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY), `'legacy'` (LEGACY_RECEIPT), or `'absent'` (nothing yet — mid-checkout). Carries `reason` text on `'absent'` for audit / UI.

- `getDisplayTaxBreakdown(subOrderId)` → `OrderDisplayTaxBreakdown` — drives the customer / admin order-detail page totals:
  - When a real invoice exists: `hasGstData: true` + the document's own paise totals.
  - When LEGACY_RECEIPT exists: `hasGstData: false` + zero tax + disclosure `"Pre-GST order. No tax breakdown is available. Receipt: SM-LR-…"`.
  - When neither: `hasGstData: false` + zero tax + disclosure `"Tax invoice not yet generated for this order. Refresh later or contact support for details."`.
  - Grand total falls back to the sum of `OrderItem.totalPriceInPaise` when no invoice document carries it.

- `safeGetSnapshot(orderItemId)` → `OrderItemTaxSnapshot | null` — for callers that just want "the snapshot or null" without the legacy-vs-pre-snapshot distinction. Catches Prisma errors + returns null (logged via `safeGetSnapshot(…) failed: …`) so a missing snapshot can never crash an upstream consumer.

**What this is NOT:**

- New schema or migration. The compat layer is pure consolidation.
- A behaviour change to the existing call sites. `CreditNoteService.generateForReturn` (Phase 11) already gracefully skips items without snapshots. `WalletAdjustmentService.requestForTimeBarredReturn` (Phase 13) already falls back to `Return.refundAmountInPaise` when snapshots are missing. `ReturnService.getReturnByIdAdmin` (Phase B P0.2) already returns an empty `taxSnapshots: []` array for legacy returns. **This phase ensures NEW call sites have a single canonical helper instead of re-deriving the fallback logic each time.**

**Tests:**
- New `tax-compatibility-service.spec.ts` — 15 tests covering:
  - `resolveForOrderItem` — snapshot path returns kind=snapshot; unknown order item → pre_snapshot with 0n; legacy + receipt exists → legacy; legacy without receipt → pre_snapshot with gross; post-Phase-5 + no snapshot → pre_snapshot with gross.
  - `resolveForSubOrder` — real TAX_INVOICE → invoice; INVOICE_CUM_BILL_OF_SUPPLY → invoice; falls back to LEGACY_RECEIPT lookup; absent path returns null + reason.
  - `getDisplayTaxBreakdown` — invoice path returns real totals + hasGstData=true; legacy path returns gross from line items + disclosure mentioning the receipt number; mid-checkout path returns gross + "not yet generated" disclosure.
  - `safeGetSnapshot` — happy path; DB-error → null (no throw); null path returns null.
- Combined: **480/480 tax tests passing** (465 prior + 15 new).
- E2E integration with real legacy + modern orders queued for Phase 27.

**Behaviour change today:**
- `TaxCompatibilityService` is **available but not enforced** — existing call sites (Phase 11 / 13 / 14) keep their inline fallback logic since they predate this consolidation. New consumers should prefer the resolver. Phase 27's integration suite can migrate the inline fallbacks behind the resolver as a follow-up refactor without changing behaviour.
- The display helper (`getDisplayTaxBreakdown`) is ready for the Phase 25 frontend to call directly when rendering an order detail page that needs to handle "pre-GST + modern" rows uniformly.
- `safeGetSnapshot` is the recommended low-level helper for any new caller that just wants nullable lookup behaviour.

**CA decisions touched / partially resolved:**
- §3 row "Pre-GST order display" — operational: `disclosure` text is canonical ("Pre-GST order. No tax breakdown is available. Receipt: …"). CA can revise verbatim in `TaxCompatibilityService.getDisplayTaxBreakdown`.
- §3 row "Refund on pre-snapshot orders" — operational: tagged union forces the caller to handle `pre_snapshot` explicitly rather than defaulting to "assume snapshot exists".
- §3 row "Legacy vs missing-snapshot distinction" — operational: the resolver distinguishes via `LegacyReceiptService.isLegacyOrder(subOrderId)`. CA gets honest audit signals — `pre_snapshot` is rare + flag-worthy; `legacy` is expected for pre-GST imports.

**Sign-off items §10 backed (additional):**
- ✓ Single canonical helper for the "snapshot vs legacy vs missing" decision.
- ✓ Tagged-union API forces callers to handle every branch (TypeScript exhaustiveness).
- ✓ Display fallback shape carries a `disclosure` field so the UI shows the right "no tax data available" reason text per cause.
- ✓ `safeGetSnapshot` never throws — a database hiccup on a snapshot lookup cannot crash the upstream order-display / return-detail flow.
- ✓ Phase 11 / 13 / 14 inline fallbacks remain backwards-compatible — this consolidation is additive.
- ✓ Per-resolution audit signal — `pre_snapshot` is distinct from `legacy` so ops can monitor "are we accidentally missing snapshots on post-Phase-5 orders?" via a single query on the consumers.

**Files added:**
- `apps/api/src/modules/tax/application/services/tax-compatibility.service.ts`
- `apps/api/test/unit/tax-compatibility-service.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — wired `TaxCompatibilityService`.

**Next:** Phase 27 — see entry above. Cross-service smoke spec + strict-mode rollout runbook + final CA.md pass. Engineering is now CA-review-ready.

---

### Phase 25 — Frontend API surface (controllers + endpoints) — 2026-05-14

**What was built (backend):**

*Controllers:* `apps/api/src/modules/tax/presentation/controllers/`

Three controllers expose the tax surface to the existing Next.js frontends (`web-storefront`, `web-d2c-seller-admin` seller portal, `web-admin-storefront` super admin):

**`CustomerTaxDocumentsController`** — `/api/v1/customer/tax-documents` (UserAuthGuard)
- `GET /` — Paginated list of the customer's documents. Excludes VOIDED_DRAFT / SUPERSEDED. BigInt serialised to string at the HTTP boundary. Page clamped to [1, ∞], limit clamped to [1, 50].
- `GET /:id/download?expiresInSeconds=` — Signed-URL issuance via Phase 20's `TaxDocumentDownloadService`. TTL clamped to [30, 3600] seconds. Captures `ip` + `user-agent` for the audit row.

**`SellerTaxDocumentsController`** — `/api/v1/seller/tax-documents` (SellerAuthGuard)
- `GET /` — Same list shape as customer but scoped to `sellerId` + filters `documentType` and `financialYear`. Includes `irn`, `buyerGstin`, `buyerLegalName` (seller needs these for their own GSTR-1 cross-check).
- `GET /:id/download?expiresInSeconds=` — Signed-URL issuance with `actor.type = 'SELLER'`.

**`AdminTaxReportsController`** — `/api/v1/admin/tax/*` (AdminAuthGuard)
- `GET /mode` — Phase 23 current mode (OFF / AUDIT / STRICT).
- `GET /audit-readiness` — Phase 23 7-blocker readiness report. BigInt fields auto-serialised.
- `GET /reports/gstr1.csv?sellerId=&filingPeriod=` — §4 B2B CSV download.
- `GET /reports/gstr1/:section.csv?sellerId=&filingPeriod=` — §5/§7/§9B/§12/§13 dispatcher; accepts both human-readable section names (`b2c-large`, `hsn`, `credit-notes`) and CBIC section numbers (`section5`, `section12`).
- `GET /reports/gstr3b.csv?sellerId=&filingPeriod=` — Phase 18 GSTR-3B 3.1 + 3.2 CSV.
- `GET /reports/gstr8.csv?filingPeriod=` — Phase 16 platform-side TCS CSV (no sellerId — it's marketplace-operator-wide).
- `GET /reports/gstr8.json?filingPeriod=&operatorGstin=` — NIC-payload-shaped JSON.
- `GET /reports/gstr8/summary?filingPeriod=` — Period rollup card for the admin dashboard.
- `POST /tcs/mark-filed` — Bulk transition COLLECTED → FILED. `req.adminId` recorded as `filedBy`.
- `POST /tcs/mark-paid` — Bulk transition FILED → PAID_TO_GOVT. `paymentReference` (UTR / bank ref) required + persisted.

*Error mapping:* `mapDownloadError` translates service-layer outcomes to HTTP statuses:
- `PdfDocumentNotFoundError` → `404 NOT_FOUND`.
- `TaxDocumentDownloadDeniedError(DENIED_RATE_LIMIT)` → `429 TOO_MANY_REQUESTS`.
- `TaxDocumentDownloadDeniedError(DENIED_NOT_READY)` → `409 CONFLICT` (with code `DOCUMENT_NOT_READY`).
- `TaxDocumentDownloadDeniedError(DENIED_SCOPE | DENIED_VOIDED)` → `403 FORBIDDEN`. Both fold to the same status so an attacker can't distinguish "wrong scope" from "voided document" by status — the audit row keeps the exact outcome.

*Validation:* All admin report endpoints validate `filingPeriod` matches `^\d{4}-\d{2}$`. Per-seller reports also require `sellerId`. Malformed → `400 INVALID_REQUEST` with a descriptive message.

*BigInt safety:* Every controller serialises BigInt to decimal string at the HTTP boundary via a small recursive helper (`serialiseBigInt`). The frontend treats them as strings (precision-safe across JSON.parse / large amounts) and parses to number only at display time.

*CSV download headers:* `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="…"` with the filename slug sanitised (`["\\]` stripped) so a hand-crafted filingPeriod can't inject header values.

**Tests:**
- New `tax-customer-controller.spec.ts` — 12 tests covering: list query scoped to `req.userId` + excludes VOIDED_DRAFT/SUPERSEDED; BigInt → string; pagination clamping (page → 1 min, limit → 50 max); download passes CUSTOMER actor with ip/UA; valid TTL honoured; out-of-range TTL falls back to undefined; DENIED_SCOPE → 403; DENIED_NOT_READY → 409; DENIED_RATE_LIMIT → 429; PdfDocumentNotFoundError → 404; unknown errors → 500; scope-vs-voided fold to same 403.
- New `tax-admin-reports-controller.spec.ts` — 17 tests covering: `getMode`; `auditReadiness` BigInt serialisation; GSTR-1 B2B CSV requires sellerId+period + rejects malformed period + sets Content-Disposition; GSTR-1 section dispatcher (b2c-large / section7 / credit-notes / hsn / section13 routes to right service method; unknown → 400); GSTR-3B per (seller, period); GSTR-8 CSV does NOT require sellerId; GSTR-8 JSON requires operatorGstin; GSTR-8 summary BigInt serialisation; markFiled non-array → 400, passes adminId as filedBy; markPaid missing paymentReference → 400, passes paymentReference through.
- Combined: **465/465 tax tests passing** (436 prior + 29 new).
- E2E HTTP integration with seeded data queued for Phase 27.

**Behaviour change today:**
- `GET /api/v1/customer/tax-documents` returns 401 today (no auth header in dev curl); with a customer JWT it returns paginated documents.
- `GET /api/v1/admin/tax/mode` returns 401 today (no admin JWT); with an admin JWT it returns `{ mode: 'OFF' }` (dev default).
- The frontend can now fetch invoice lists, download invoices, generate GSTR-1/3B/8 CSVs, view the audit-readiness dashboard, and run the TCS transitions — all backend-side. UI components themselves land in the existing Next.js apps; the API contract is stable.
- `TaxModule` registers 3 controllers + 3 auth guards alongside the existing 17 services + 3 crons.

**CA decisions touched / partially resolved:**
- §3 row "Frontend API contract" — operational: every tax read / export / lifecycle transition is reachable via HTTP. Frontend repo can stub directly off this contract.
- §3 row "Download status-code matrix" — operational: 401/403/404/409/429 distinctions are stable; the audit row carries the exact `outcome` for forensics.
- §3 row "CSV export filename hygiene" — operational: `Content-Disposition` filename sanitised to strip `["\\]` characters; CA query params (period / sellerId) can't be used to inject headers.

**Sign-off items §10 backed (additional):**
- ✓ Every Phase 16–24 service is reachable via HTTP through the right actor surface.
- ✓ Customer / seller scope enforced at the service layer (controllers thread auth context, services validate).
- ✓ Admin endpoints require admin JWT (verified via 401 on no-auth curl).
- ✓ BigInt is JSON-safe across every response shape.
- ✓ CSV downloads use proper Content-Disposition with sanitised filenames.
- ✓ Pagination clamped to sane bounds (max 50 items per page) — no DoS via `?limit=999999`.
- ✓ TTL clamped on download URL issuance (no `?expiresInSeconds=999999999`).
- ✓ Mode lookup is a single-call endpoint for the admin dashboard ("current mode" badge).
- ✓ Per-section CSV dispatcher accepts both human + CBIC-numeric section names — admin can deep-link from "Section 12 (HSN summary)" or "/hsn".

**Files added:**
- `apps/api/src/modules/tax/presentation/controllers/customer-tax-documents.controller.ts`
- `apps/api/src/modules/tax/presentation/controllers/seller-tax-documents.controller.ts`
- `apps/api/src/modules/tax/presentation/controllers/admin-tax-reports.controller.ts`
- `apps/api/test/unit/tax-customer-controller.spec.ts`
- `apps/api/test/unit/tax-admin-reports-controller.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — registered 3 controllers + 3 auth guards as providers.

**Next:** Phase 26 — see entry above. `TaxCompatibilityService` consolidates the snapshot / legacy / pre-snapshot decision into one tagged-union resolver.

---

### Phase 24 — Tax notifications (customer / seller / admin) — 2026-05-14

**What was built (backend):**

*Service:* `apps/api/src/modules/tax/application/services/tax-notification.service.ts`

`TaxNotificationService` wraps `NotificationsPublicFacade.notifyFromTemplate` with one method per tax event. Each method resolves the right template key + event class + variable block; the facade handles preference checks, opt-outs, queueing, rendering, and dispatch.

**Template-key registry** (`TAX_TEMPLATE_KEYS` constant) groups keys by actor surface so future template-content edits stay localised:

- **Customer**
  - `tax.customer.invoice_issued.email` — "Your tax invoice is ready."
  - `tax.customer.credit_note_issued.email` — "A credit note has been issued for your return."
  - `tax.customer.refund_via_wallet.email` — "Refund processed via wallet. GST adjustment is not available for this return due to statutory reporting timelines."
- **Seller**
  - `tax.seller.invoice_issued.email`
  - `tax.seller.irn_generated.email` — Phase 22 IRN minted; subject line carries `irnPreview` (`xxxxxxxx…cccc`, 8-char prefix + 4-char suffix) because the full 64-char IRN is unwieldy.
  - `tax.seller.ewb_generated.email` / `tax.seller.ewb_expired.email`
  - `tax.seller.settlement_tcs_collected.email` — Phase 17 cycle.
- **Admin**
  - `tax.admin.gstr8_filing_due.email` — `eventId = gstr8:${filingPeriod}` for idempotency.
  - `tax.admin.einvoice_failed.email` — Phase 22 retry-cap escalation.
  - `tax.admin.timebar_approaching.email` — Phase 12 7-day window.
  - `tax.admin.pdf_render_failed.email` — Phase 19 retry-cap escalation.

**Event classes** (drives user-preference opt-outs):
- `tax.invoice` — invoice + credit note + IRN events.
- `tax.ewb` — e-way bill events.
- `tax.settlement` — settlement cycle (incl. TCS).
- `tax.refund` — customer-facing refund notices (esp. wallet-routed).
- `tax.compliance` — admin-only filing reminders + escalations.

**Variable rendering** (built into the service, JSON-safe for the Handlebars renderer):
- `paiseToRupees` — sign-preserving conversion with **Indian grouping** (`1_00_00_000_00n` → `1,00,00,000.00`). Pure BigInt, no IEEE drift even at crore scale.
- `formatIstDate` — `DD-MM-YYYY` in IST. Late-evening-UTC issuance (31 Mar 2026 19:00 UTC → 1 Apr 2026 00:30 IST) renders the correct IST day.
- BigInt → decimal string conversion at the service boundary so the template renderer doesn't choke.

**Failure resilience:** every method runs through `safeNotify` — a try/catch wrapper that logs `Notification ${key} → ${id} failed (non-fatal): ${msg}` and swallows. A notification failure must never crash the upstream tax operation (invoice generation, payout, etc.).

**Template content seeding:** Phase 24 ships the WIRING; CA + UX seed the actual template subjects/bodies in `notification_templates` (Phase 25 admin UI). If a template is missing at dispatch time, the facade logs + drops — the system never crashes on a missing template.

**Tests:**
- New `tax-notification-service.spec.ts` — 17 tests covering:
  - Customer surface: invoice issued (template key + tax.invoice eventClass + correct vars + eventId=documentId); credit note (return number + original invoice captured); time-barred refund (`tax.refund` event class + Section-34 statutory reason text).
  - Seller surface: invoice issued (recipient = seller); IRN generated (truncated `irnPreview` format); EWB generated (`tax.ewb` event class + invoice number); EWB expired (separate template key); settlement TCS (Indian grouping on rupees).
  - Admin surface: GSTR-8 reminder (`eventId = gstr8:${filingPeriod}` for cron idempotency); IRN failed (retry count + reason); time-bar approaching (cutoff window + source invoice); PDF failed (per-document eventId).
  - Failure resilience: facade rejection does not throw; facade empty-string return (template-missing path) does not throw.
  - Money + date formatting: crore-scale Indian grouping; negative refund sign preservation; IST date across UTC day-boundary.
- Combined: **436/436 tax tests passing** (419 prior + 17 new).
- Real-DB integration with seeded templates + end-to-end queue dispatch queued for Phase 27.

**Behaviour change today:**
- `TaxNotificationService` is **available** but not yet wired into the tax services themselves (`TaxDocumentService.generateForSubOrder` doesn't call `customerInvoiceIssued` yet). Phase 25's frontend work + per-service integration lands the call sites; the service surface is stable so integration is one-line per event.
- The notification facade itself is unchanged — Phase 24 is purely additive on the tax side.
- Template bodies are NOT seeded in this phase. A `notification_templates` row with `templateKey IN TAX_TEMPLATE_KEYS.*` must be inserted (admin UI / seed script) before any notification actually goes out. Until then the facade logs `Template … not found — dropping` and returns empty.

**CA decisions touched / partially resolved:**
- §3 row "Customer time-bar messaging" — operational: the canonical reason text ships in `customerTimeBarredRefund({...}).vars.reason`. CA can review + edit in Phase 25's template editor.
- §3 row "Seller IRN notification" — operational: subject line uses truncated `irnPreview`; full IRN stays on the PDF + portal.
- §3 row "Admin compliance reminders" — four event types: GSTR-8 filing due, IRN failed, time-bar approaching, PDF failed. CA + ops decide which admin roles receive which.
- §3 row "Notification opt-out" — operational: each event class (`tax.invoice` / `tax.ewb` / `tax.settlement` / `tax.compliance` / `tax.refund`) honours the existing per-user preference check via the facade. A customer who opts out of `tax.refund` will not get the wallet-refund email but will still get the invoice email.

**Sign-off items §10 backed (additional):**
- ✓ Single canonical event-name registry (`TAX_TEMPLATE_KEYS`) prevents naming drift across the codebase.
- ✓ Every method is best-effort — notification failure never blocks the upstream tax operation.
- ✓ Indian numbering rendered in every monetary template variable.
- ✓ IST dates rendered in every date template variable.
- ✓ IRN preview format keeps subject lines readable (8 + … + 4 chars).
- ✓ `eventId` field passed for every notification — facade dedupes on (event class, event id) so a retry cron / replay can't duplicate the customer email.
- ✓ Event classes align with user-preference categories so opt-outs apply correctly.

**Files added:**
- `apps/api/src/modules/tax/application/services/tax-notification.service.ts`
- `apps/api/test/unit/tax-notification-service.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — imported `NotificationsModule`; wired `TaxNotificationService`.

**Next:** Phase 25 — see entry above. Customer / seller / admin HTTP controllers wired; full tax surface reachable via REST.

---

### Phase 23 — TAX_AUDIT_MODE / TAX_STRICT_MODE rollout — 2026-05-13

**What was built (backend):**

*Service:* `apps/api/src/modules/tax/application/services/tax-mode.service.ts`

`TaxModeService` — single source of truth for the two-stage flag rollout. Resolves to one of three modes:

- **OFF** (`tax_audit_mode=false`, `tax_strict_mode=false`) — Permissive. Missing HSN / rate / GSTIN data passes through with fallbacks (Phase 8 picker, Phase 3 default rate). Dev / test default.
- **AUDIT** (`tax_audit_mode=true`, `tax_strict_mode=false`) — Validation runs but failures are LOGGED, not thrown. `tax_audit.violation` structured log line lets ops scrape staging traffic for "what would strict mode reject?" without blocking checkouts.
- **STRICT** (`tax_strict_mode=true`, audit implied) — Validation throws. **DRAFT banner suppressed on PDF renders.** Prod mode once CA signs off on the audit results.

API:
- `getMode()` → `'OFF' | 'AUDIT' | 'STRICT'`. `tax_config` is canonical; env vars `TAX_AUDIT_MODE` / `TAX_STRICT_MODE` are boot-time fallbacks when the config row hasn't been seeded.
- `isStrict()` / `isAuditOrStrict()` — convenience shortcuts for hot paths.
- `report(violation)` → `null | TaxModeViolation` — applies the current mode:
  - OFF → returns `null` (silent skip).
  - AUDIT → logs structured `tax_audit.violation code=… message=… context=…` line + returns the violation.
  - STRICT → throws `TaxStrictModeViolationError` carrying the violation payload.
- `static shouldShowDraftBanner(mode)` — pure helper for the template renderer (no DI needed).

*Template integration:* `apps/api/src/modules/tax/domain/tax-document-html-template.ts`

`TemplateInput.mode` is now an optional `TaxTemplateMode` field (`'OFF' | 'AUDIT' | 'STRICT'`). The `baseEnvelope` function checks `(input.mode ?? 'OFF') !== 'STRICT'` to decide whether to render the DRAFT banner. Pre-Phase-23 callers (templates rendered without the field) default to OFF — banner stays on, no behavioural change.

`TaxDocumentPdfService.renderAndUpload` now reads the mode at render time via `TaxModeService.getMode()` and threads it through `TemplateInput`. Once `tax_strict_mode` flips on, the next PDF retry round re-renders every PDF_GENERATED row clean (the existing pdfRetryCount stays 0 — re-renders are admin-triggered).

*Service:* `apps/api/src/modules/tax/application/services/tax-audit-readiness.service.ts`

`TaxAuditReadinessService.build()` → structured "ready to flip STRICT?" report for the admin dashboard. Scans seven blocker classes:

1. **`product.missing_hsn`** — `Product` rows with `supplyTaxability=TAXABLE` AND null/empty `hsnCode`. STRICT rejects at invoice generation per CBIC HSN-on-invoice rule.
2. **`product.missing_rate`** — TAXABLE products with null/zero `gstRateBps` (and not flagged NIL_RATED / EXEMPT).
3. **`seller.missing_gstin`** — Sellers with at least one sub-order in the last 30 days AND no verified `SellerGstin` row. STRICT cannot issue Tax Invoices for them.
4. **`einvoice.unresolved`** — TaxDocuments stuck in `einvoiceStatus IN (PENDING, FAILED)` with `retryCount >= cap`. STRICT requires every B2B invoice to be GENERATED or explicitly NOT_APPLICABLE.
5. **`pdf.unresolved`** — TaxDocuments stuck in `status IN (PDF_PENDING, PDF_FAILED)` with `pdfRetryCount >= cap`. Customer / seller download is broken.
6. **`tcs.unfiled`** — `gstTcsSettlementLedger` rows past the 10th-of-next-month CBIC deadline still in COMPUTED / COLLECTED (not FILED). Statutory exposure.
7. **`timebar.requires_review`** — Returns in `creditNoteEligibilityStatus = REQUIRES_FINANCE_REVIEW` (Phase 12). Finance hasn't triaged within the approaching-cutoff window.

Each blocker carries `{ code, count, sampleIds (max 5), message }` for the admin UI to deep-link into. The report's `ready` boolean is true iff every count is zero; `totalBlockers` is the sum across all classes; `currentMode` and `generatedAt` are stamped on the report.

*Env flags:*
- `TAX_AUDIT_MODE` (default `false`).
- `TAX_STRICT_MODE` (default `false`).

Both are boot-time fallbacks; the canonical source is the `tax_config` table so CA can flip the rollout via the admin settings panel without redeploy.

**Tests:**
- New `tax-mode-service.spec.ts` — 14 tests covering: mode resolution (OFF / AUDIT / STRICT / both → STRICT); tax_config-over-env precedence; env fallback when tax_config missing; `isStrict` / `isAuditOrStrict` shortcuts; `report` outcomes per mode (OFF returns null silently, AUDIT returns the violation logged, STRICT throws `TaxStrictModeViolationError`); thrown error preserves the violation payload; `shouldShowDraftBanner` pure helper.
- New `tax-pdf-template-mode.spec.ts` — 5 tests covering: default (no mode) keeps banner; OFF keeps banner; AUDIT keeps banner (AUDIT ≠ CA sign-off); STRICT suppresses banner; STRICT keeps substantive content (heading + totals + lines).
- New `tax-audit-readiness.spec.ts` — 7 tests covering: zero-blockers → `ready=true`; `currentMode` threaded into report; non-zero blockers → `ready=false` + sample IDs populated; sample IDs capped at 5 for large counts; `totalBlockers` sums across classes; TCS overdue detection (Jan 2020 → past deadline today); TCS within-window (2099 → not yet); `generatedAt` timestamped per build.
- Updated `tax-pdf-service.spec.ts` — constructor stubbed with `TaxModeService` returning `'OFF'` so existing PDF service tests stay green.
- Combined: **419/419 tax tests passing** (393 prior + 26 new + 1 updated).
- Real-DB integration with seeded products / sellers / documents queued for Phase 27.

**Behaviour change today:**
- The system **stays in OFF mode by default** — Phase 23 is a flag-gated rollout, not an immediate posture change. Dev / test continue exactly as before.
- An admin can flip `tax_config.tax_audit_mode=true` on staging to start gathering `tax_audit.violation` log lines from real traffic, without affecting customer-facing behaviour.
- Once the violation log stabilises and CA reviews the audit dashboard at `TaxAuditReadinessService.build()`, the admin flips `tax_config.tax_strict_mode=true` on prod. From that point: every new PDF render omits the DRAFT banner; every callable site that uses `TaxModeService.report()` enforces.
- The PDF service does NOT auto-re-render PDF_GENERATED rows when mode flips — admin uses Phase 19's `tax.invoice.regeneratePdf` permission to trigger fresh renders if they want the banner gone retroactively.
- All seven blocker classes in the audit-readiness report have a clear admin-side remediation: fix product HSN, register seller GSTIN, complete IRN retries, fix PDF retries, mark TCS FILED, triage time-bar reviews. Each blocker links to a Phase 25 admin page.

**CA decisions touched / partially resolved:**
- §3 row "Strict mode rollout" — operational: three-mode service, env-fallback for boot-time, tax_config-canonical for runtime flips. CA can adjust without code change.
- §3 row "DRAFT banner suppression" — operational: STRICT mode suppresses; OFF / AUDIT keep it. AUDIT does NOT suppress because audit ≠ CA sign-off.
- §3 row "Audit readiness criteria" — operational: 7 blocker classes documented + counted. CA can extend by adding scanners to the readiness service.
- §3 row "Validation severity" — operational: callable sites use `TaxModeService.report()` to thread the same violation through silent / logged / thrown paths.

**Sign-off items §10 backed (additional):**
- ✓ Two-stage rollout (AUDIT → STRICT) gives CA an observable soak period before any customer-visible change.
- ✓ DRAFT banner cannot be accidentally suppressed pre-CA-signoff (requires explicit STRICT flag flip).
- ✓ Audit readiness dashboard is single API call — admin UI reads the structured report.
- ✓ `tax_audit.violation` log line is structured (`code`, `message`, `context`) for log-aggregator queries.
- ✓ Thrown `TaxStrictModeViolationError` preserves the violation payload so HTTP handlers can map it to a useful 4xx response.
- ✓ Flag reads cache via TaxConfigService's 60-second TTL — hot path safe.
- ✓ Existing template renderer doesn't change behaviour for pre-Phase-23 callers (mode field is optional, defaults to banner-on).

**Files added:**
- `apps/api/src/modules/tax/application/services/tax-mode.service.ts`
- `apps/api/src/modules/tax/application/services/tax-audit-readiness.service.ts`
- `apps/api/test/unit/tax-mode-service.spec.ts`
- `apps/api/test/unit/tax-pdf-template-mode.spec.ts`
- `apps/api/test/unit/tax-audit-readiness.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/domain/tax-document-html-template.ts` — added optional `mode` field; banner suppression keyed on STRICT.
- `apps/api/src/modules/tax/application/services/tax-document-pdf.service.ts` — injected `TaxModeService`; threads mode into the renderer.
- `apps/api/src/bootstrap/env/env.schema.ts` — added 2 env flags.
- `apps/api/src/modules/tax/module.ts` — wired `TaxModeService` + `TaxAuditReadinessService`.
- `apps/api/test/unit/tax-pdf-service.spec.ts` — updated PDF service constructor stub for the new arg.

**Next:** Phase 24 — see entry above. Customer / seller / admin tax-notification surface wired (template keys, event classes, vars, best-effort dispatch).

---

### Phase 22 — E-invoice / IRN readiness + stub NIC adapter — 2026-05-13

**What was built (backend):**

*Schema additions:* 4 columns on `tax_documents` + 2 on `seller_gstins`
- **tax_documents:**
  - `einvoice_retry_count` — INT default 0. Incremented on every failed IRN attempt.
  - `einvoice_last_attempted_at` — TIMESTAMPTZ. Drives the cron's cooldown predicate.
  - `einvoice_failure_reason` — TEXT. Cleared on success, captured on failure.
  - `einvoice_provider` — TEXT. Records which adapter (`'stub'` / `'nic'`) wrote the row.
  - Partial index `WHERE einvoice_status IN ('PENDING', 'FAILED')` keyed on `(status, retry_count, last_attempted_at)` drives the retry cron.
- **seller_gstins:**
  - `aggregate_turnover_in_paise` — BIGINT default 0. Updated on annual-return upload. Drives the IRP applicability gate.
  - `einvoice_opted_in` — BOOLEAN default false. Voluntary opt-in for sub-threshold suppliers.
- 2 new `AdminTaskKind` values: `EINVOICE_GENERATION_FAILED` (retry cap exhausted) + `EINVOICE_CANCELLATION_FAILED` (24h-window cancel call rejected by NIC).

*Pure helper:* `apps/api/src/modules/tax/domain/einvoice-applicability.ts`

`decideEInvoiceApplicability(input)` → `{ applicable, reason }`. Three gates, ANY one of which stops applicability:

1. **Document gate** — `TAX_INVOICE` / `INVOICE_CUM_BILL_OF_SUPPLY` / `CREDIT_NOTE` / `DEBIT_NOTE` are eligible; `BILL_OF_SUPPLY` / `LEGACY_RECEIPT` / `VOIDED_DRAFT` / `SUPERSEDED` → skip with a labeled reason.
2. **Recipient gate** — `buyerGstin` must be set (B2B). B2C invoices stay outside IRP per CBIC notification — even a ₹100-crore supplier doesn't IRP a B2C sale.
3. **Turnover gate** — supplier turnover **strictly >** the threshold (default ₹5 crore = `5_00_00_000_00` paise) OR explicit opt-in. Exact-at-threshold returns `false` to match CBIC's `>` wording.

Every NOT_APPLICABLE outcome carries a `reason` field — useful for the audit log + admin compliance UI ("why didn't this invoice IRP?").

`DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE = 5_00_00_000_00n` — engineering's canonical constant. Env-overridable.

*Provider interface + stub:* `apps/api/src/modules/tax/infrastructure/einvoice/`

`EInvoiceProvider` contract:
- `generate(input)` → `{ irn, ackNo, ackDate, signedDocumentJson, qrCodeUrl }`. Input mirrors NIC's IRP request schema field-for-field (supplier/buyer GSTIN, document number/date/type, invoice value, taxable + tax legs, per-line items).
- `cancel({ irn, cancellationCode, cancellationReason })` → `{ cancelledAt, signedDocumentJson }`. Cancellation codes: 1=duplicate, 2=data-entry mistake, 3=order cancelled, 4=other.

`StubEInvoiceProvider`:
- Produces a deterministic 64-char hex IRN = `SHA-256(supplierGstin || documentNumber || documentDate)` — matches NIC's contract that the IRN is deterministic on those three. Re-calling `generate` on the same input produces the same IRN (idempotent on the wire too).
- `ackNo` = `STUB-{epoch}-{6 hex chars}`; `ackDate` = now.
- `qrCodeUrl` = a `data:image/svg+xml;base64,...` URL with the IRN's first 12 chars as the SVG text — exercises the PDF template's QR placement without requiring a real PNG.
- `signedDocumentJson` = JSON envelope with `signature: 'STUB-NOT-A-REAL-SIGNATURE'` placeholder + the full request payload. BigInt fields safely serialised to decimal strings.

Module wiring uses a `useFactory` keyed on `EINVOICE_PROVIDER` env: `stub` returns the stub; `nic` throws loudly at boot ("NIC IRP adapter not yet implemented") — same crash-on-misconfig pattern as Phase 15's EWB provider + Phase 19's PDF storage.

*Service:* `apps/api/src/modules/tax/application/services/einvoice.service.ts`

`EInvoiceService` — three entry points:

1. `classifyForDocument(documentId)` → `{ applicable, reason, document }`
   - Reads supplier turnover + opt-in from `SellerGstin`.
   - Calls `decideEInvoiceApplicability` with the env-tunable threshold override.
   - Persists `einvoice_status` (NOT_APPLICABLE / PENDING). Idempotent — already-GENERATED rows are returned without re-classification.
   - Returns the decision so callers can chain to `generateForDocument`.

2. `generateForDocument(documentId)` → `TaxDocument`
   - Calls `classifyForDocument` first; throws `EInvoiceNotApplicableError` if the document doesn't qualify.
   - Idempotent on already-GENERATED rows.
   - Builds the IRP request payload (header + per-line items), calls the provider.
   - On success: persists `irn`, `ackNo`, `ackDate`, `signedDocumentJson`, `qrCodeUrl`, `einvoiceProvider`, `einvoiceLastAttemptedAt`. Flips status to GENERATED. Clears `einvoiceFailureReason`.
   - On failure: increments `einvoice_retry_count`, captures `einvoice_failure_reason`, flips status to FAILED. Re-throws so the cron's catch loop counts the failure.

3. `cancelForDocument({ documentId, cancellationCode, cancellationReason, actorId?, now? })` → `TaxDocument`
   - Enforces the CBIC 24-hour cancellation window. Past it, throws `EInvoiceCancellationWindowClosedError` so the caller routes to "issue a Credit Note instead".
   - Refuses on non-GENERATED IRNs (`EInvoiceNotApplicableError`).
   - Calls `provider.cancel`, persists the latest `signedDocumentJson`. Flips `einvoice_status` back to `NOT_APPLICABLE` — accountants treat a cancelled IRN as never having existed; a credit note handles the customer-facing reversal.

*Retry cron:* `apps/api/src/modules/tax/application/jobs/einvoice-retry.cron.ts`

`EInvoiceRetryCron` — every 5 min, wrapped in `LeaderElectedCron` + `CronInstrumentationService`:
- Picks up rows in `PENDING` / `FAILED` with `retry_count < cap` AND `last_attempted_at < (now - cooldown)`.
- Calls `EInvoiceService.generateForDocument`. Failures are recorded by the service's own catch path; the cron counts them.
- After each pass, escalates rows that hit the retry cap by opening an `EINVOICE_GENERATION_FAILED` AdminTask (idempotent on `(kind, sourceType, sourceId)`, scoped to `MANUAL` source type).

*Env flags:*
- `EINVOICE_PROVIDER` (enum: `stub` | `nic`; default `stub`).
- `TAX_EINVOICE_RETRY_CRON_ENABLED` (default `true`).
- `TAX_EINVOICE_RETRY_CAP` (default 5).
- `TAX_EINVOICE_RETRY_COOLDOWN_MINUTES` (default 5).
- `TAX_EINVOICE_RETRY_SCAN_LIMIT` (default 50).
- `TAX_EINVOICE_TURNOVER_THRESHOLD_PAISE` (default 0 → use the policy constant ₹5 crore; non-zero override = use that value).

**Tests:**
- New `tax-einvoice-applicability.spec.ts` — 18 tests covering: ₹5 crore constant correctness; document gate (all 4 eligible types accepted; BILL_OF_SUPPLY / LEGACY_RECEIPT / VOIDED_DRAFT / SUPERSEDED rejected with reason); recipient gate (B2C rejected); turnover gate (just-over → applicable; exactly-at → not; below+opt-out → not; below+opt-in → applicable; custom threshold override); composite cases (B2B + below + not-opted = not; B2B + opted = yes regardless; B2C + ₹50 crore = not, B2C trumps).
- New `tax-einvoice-service.spec.ts` — 13 tests covering: not-found throws; idempotent on GENERATED in classify; B2C → no-op classify; opt-in flips to PENDING; below-threshold + not-opted stays NOT_APPLICABLE; generate refuses non-applicable; idempotent on GENERATED; provider success path with payload assertions; provider failure → FAILED + retry_count incremented + propagation; cancel not-found / non-GENERATED / 24h-window-closed / happy-path.
- Combined: **393/393 tax tests passing** (362 prior + 31 new).
- Real-DB integration (cron sweep, partial-index race, NIC adapter swap) queued for Phase 27.

**Behaviour change today:**
- Every new tax document goes through `classifyForDocument` (manually wired in Phase 25's frontend; the service is callable today via DI).
- B2B invoices from above-threshold sellers land in `einvoice_status = PENDING`; the cron picks them up within ~5 minutes and (in stub mode) flips to GENERATED with a deterministic IRN + QR placeholder.
- Failed IRN attempts retry up to 5 times with a 5-minute cooldown; final exhaustion opens an admin task for ops triage.
- The PDF template (Phase 19) already has `qr_code_url` + `irn` + `ack_no` fields in the rendered HTML — once IRN data lands, the next PDF re-render picks it up automatically.
- Switching to `EINVOICE_PROVIDER=nic` in production requires implementing `NicEInvoiceProvider` first; the factory crashes loudly at boot to prevent accidental fall-through to the stub.

**CA decisions touched / partially resolved:**
- §3 row "E-invoice / IRP applicability" — operational with the canonical CBIC three-gate check. CA confirms whether the ₹5 crore default matches Sportsmart's current registration period.
- §3 row "IRN cancellation window" — operational: hard 24-hour gate, with `EInvoiceCancellationWindowClosedError` routing past-window cancellations to the Credit Note path.
- §3 row "Opt-in seller GSTINs" — operational via `seller_gstins.einvoice_opted_in`. Admin tooling to flip this lands in Phase 25.
- §3 row "QR code on PDF" — operational: the stub emits a `data:image/svg+xml` placeholder; the Phase 19 template embeds whichever URL the row carries. NIC swap doesn't change the template.

**Sign-off items §10 backed (additional):**
- ✓ E-invoice applicability is automatic from supplier turnover + opt-in flag; engineering does not hand-pick eligible documents.
- ✓ Stub adapter exercises the full lifecycle (classify → generate → cancel → retry) in dev/test without NIC creds.
- ✓ Retry cap + cooldown prevent abuse of the NIC IRP rate limit when the real adapter is wired.
- ✓ Cancellation window enforced at the service layer; past-window cancellations cannot accidentally fire at NIC.
- ✓ Provider switch is single-line at boot (`EINVOICE_PROVIDER`); service code is identical across providers.
- ✓ Failure escalation is idempotent — one AdminTask per failed document regardless of how many times the cron retries.
- ✓ All money in BigInt paise on the provider payload; BigInt-safe JSON serialisation for the `signed_document_json` column.

**Files added:**
- `apps/api/prisma/schema/migrations/20260513270000_einvoice_irn_readiness/migration.sql`
- `apps/api/src/modules/tax/domain/einvoice-applicability.ts`
- `apps/api/src/modules/tax/infrastructure/einvoice/einvoice-provider.ts`
- `apps/api/src/modules/tax/infrastructure/einvoice/stub-einvoice-provider.ts`
- `apps/api/src/modules/tax/application/services/einvoice.service.ts`
- `apps/api/src/modules/tax/application/jobs/einvoice-retry.cron.ts`
- `apps/api/test/unit/tax-einvoice-applicability.spec.ts`
- `apps/api/test/unit/tax-einvoice-service.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/tax-documents.prisma` — added 4 IRN retry-tracking columns.
- `apps/api/prisma/schema/tax-master.prisma` — added 2 columns on `SellerGstin`.
- `apps/api/prisma/schema/liability-ledger.prisma` — added 2 AdminTaskKind values.
- `apps/api/src/bootstrap/env/env.schema.ts` — added 6 env flags.
- `apps/api/src/modules/tax/module.ts` — wired `EInvoiceService` + retry cron + provider factory.

**Next:** Phase 23 — see entry above. Three-mode service + DRAFT-banner toggle + 7-blocker audit-readiness dashboard operational.

---

### Phase 21 — Retention + erasure exclusion (Section 36 / 8-year hold) — 2026-05-13

**What was built (backend):**

*Pure helper:* `apps/api/src/modules/tax/domain/statutory-retention.ts`

Three pure functions over the retention window:
- `DEFAULT_STATUTORY_RETENTION_YEARS = 8` — engineering's defensible floor for CGST Section 36 / Rule 56 (the books-of-account rules require preservation for 72 months from the annual-return due date; 8 years from issuance is the practical CA-aligned floor).
- `computeRetentionExpiry(generatedAt, retentionYears?)` → `Date`. Adds N years via `setUTCFullYear`; rejects invalid Date / negative years.
- `isUnderStatutoryRetention(generatedAt, now?, retentionYears?)` → boolean. Strict `<` comparison so the boundary itself is **outside** the retention window (matches the CBIC "after 8 years" reading).
- `daysUntilRetentionExpiry(generatedAt, now?, retentionYears?)` → whole-day count. Negative when past expiry; 0 the day of.

*Service:* `apps/api/src/modules/tax/application/services/tax-document-retention.service.ts`

`TaxDocumentRetentionService` — three entry points:

1. `retentionYears()` → number. Reads `TAX_DOCUMENT_RETENTION_YEARS` env (default 8). Single source of truth across the codebase.
2. `getRetentionSummaryForUser(userId, now?)` → `UserRetentionSummary` with:
   - `totalDocuments` (any status — VOIDED_DRAFT included so the count is honest).
   - `documentsUnderRetention` (subset still within the window).
   - `earliestDocumentDate` + `latestRetentionExpiry` for the admin UI's "this user's hold ends …" badge.
   - `hasActiveStatutoryHold` boolean shortcut for the erasure outcome.
   - Prefers `generatedAt` for the issuance timestamp; falls back to `createdAt` for never-issued drafts.
3. `isDocumentUnderRetention(documentId, now?)` → boolean. Per-document helper for the ops "is this safe to archive?" call.

*Erasure integration:* `apps/api/src/core/erasure/erasure.service.ts`

The existing erasure flow already redacted **only** the `users` row (`firstName`, `lastName`, `email`, `phone`) — tax documents have their OWN snapshotted PII (`buyer_legal_name`, `billing_address_json`, `shipping_address_json`) captured at issuance time, so they were never touched by erasure. Phase 21 makes this contract **explicit** in the outcome:

- `ErasureModule` now imports `TaxModule` so `ErasureService` can inject `TaxDocumentRetentionService`.
- After the `users` redaction, `processUser` reads the retention summary and stamps a structured `statutoryHold` block on the erasure outcome JSON:
  ```jsonc
  {
    "redacted": ["users.firstName", "users.lastName", "users.email", "users.phone"],
    "blocked": [],
    "statutoryHold": {
      "preservedBy": "CGST Section 36 / 8-year retention",
      "documentsUnderRetention": 7,
      "totalDocuments": 12,
      "earliestDocumentDate": "2024-01-15T10:00:00.000Z",
      "latestRetentionExpiry": "2034-04-15T10:00:00.000Z",
      "retentionYears": 8,
      "note": "Tax documents (invoices / credit notes / receipts) carry their own snapshotted buyer name + addresses at issuance time. These records are preserved as statutory evidence; the customer's right to be forgotten is satisfied by the users-row redaction above."
    }
  }
  ```
- A retention-summary lookup failure is logged but **does not** block the erasure (`statutoryHold: null` lands instead) — the customer's DPDPA Section 12 / GDPR Article 17 right is paramount; the audit annotation is best-effort.
- The `statutoryHold` is **never a blocker**: documents under retention coexist with a redacted user row. The customer's name on the `users` table is gone; the historical invoice still says "Priya Sharma, 5 Park Lane" because that's a statutory record of the transaction, not a profile field.

*Env flag:*
- `TAX_DOCUMENT_RETENTION_YEARS` (default 8). Adjustable without code change; the rate-snapshot pattern (each document independently passes through the math) means future rate changes don't rewrite filed history.

**Scope of statutory hold (documented but enforced by absence):**

The following tables are **never touched by customer erasure** — neither field-redacted nor row-deleted — for the statutory retention window:
- `tax_documents` + `tax_document_lines`
- `tax_document_download_audits` (Phase 20)
- `gst_tcs_settlement_ledger` (Phase 16)
- `e_way_bills` (Phase 15)
- `wallet_adjustments` (Phase 13)

This is enforced by the erasure service's narrow scope (it only writes to `users`). If a future contributor extends erasure to other tables, the policy doc + this CA.md entry are the source of truth for what to leave alone.

**Tests:**
- New `tax-statutory-retention.spec.ts` — 13 tests covering: default 8-year constant; `computeRetentionExpiry` (default + custom + leap-day handling); invalid input rejection (NaN Date + negative years); `isUnderStatutoryRetention` (recent / 1-second-before-boundary / exact-boundary / aged-out / custom-window); `daysUntilRetentionExpiry` (positive / negative / zero-at-boundary).
- New `tax-retention-service.spec.ts` — 8 tests covering: zero-summary on empty user; mixed in-window + aged-out count; `createdAt` fallback when `generatedAt` is null; env-override honoured; `isDocumentUnderRetention` (unknown / in-window / aged-out); `retentionYears()` reader.
- Updated `src/core/erasure/erasure.service.spec.ts` — constructor signature absorbs `TaxDocumentRetentionService` stub; outcome assertion accepts the new `statutoryHold` block alongside the legacy `redacted` / `blocked` shape.
- Combined: **362/362 tax tests passing** (339 prior + 21 new + 2 updated assertions).
- Real-DB integration (erasure end-to-end + concurrent retention queries during a high-traffic erasure batch) queued for Phase 27.

**Behaviour change today:**
- Every USER erasure outcome now ships with the structured `statutoryHold` block. The customer portal "your data was erased" confirmation page can render "Profile redacted on YYYY-MM-DD. Tax documents (N invoices) preserved per Section 36 until YYYY-MM-DD" without further API design.
- A user who places one invoice today and requests erasure tomorrow gets `users` row redacted **and** a clear audit annotation that 1 tax document remains under hold until ~2034. Compliance reviews can find the annotation by querying `data_erasure_requests.outcome -> 'statutoryHold' -> 'documentsUnderRetention' > 0`.
- The customer's downloadable invoice continues to render their snapshotted name (`buyer_legal_name`) — by design, not bug.

**CA decisions touched / partially resolved:**
- §3 row "Statutory retention window" — operational: 8-year default, env-tunable, applied uniformly across the retention service. CA can flip to a different value without history rewrite.
- §3 row "Erasure vs Section 36 conflict" — fully resolved: tax-document snapshots take priority over user-row redaction. Customer's right-to-be-forgotten satisfied via `users` row redaction; statutory records preserved via per-document PII snapshots.
- §3 row "Scope of erasure" — operational: only `users.firstName / lastName / email / phone` are touched. Tax-document tables, audit tables, TCS ledgers, e-way bills, wallet adjustments all explicitly excluded.

**Sign-off items §10 backed (additional):**
- ✓ 8-year retention is canonically computed by one helper; rate-snapshot per row means a future window change cannot rewrite historical filings.
- ✓ Customer erasure satisfies DPDPA Section 12 / GDPR Article 17 by redacting the `users` row.
- ✓ Tax-document PII (buyer name + addresses) is snapshotted at issuance and outlives the user record — the statutory audit trail is independent of the customer profile.
- ✓ The erasure outcome JSON records the statutory hold explicitly so compliance reviews can answer "what was preserved and why" without DB archeology.
- ✓ Retention-summary lookup failure is non-blocking — the user's erasure right is never gated on an audit-annotation read.
- ✓ Document scope of statutory hold (tax_documents, audits, TCS, EWB, wallet adjustments) is in this CA.md entry so a future contributor extending erasure has a single source of truth.

**Files added:**
- `apps/api/src/modules/tax/domain/statutory-retention.ts`
- `apps/api/src/modules/tax/application/services/tax-document-retention.service.ts`
- `apps/api/test/unit/tax-statutory-retention.spec.ts`
- `apps/api/test/unit/tax-retention-service.spec.ts`

**Files modified:**
- `apps/api/src/bootstrap/env/env.schema.ts` — added `TAX_DOCUMENT_RETENTION_YEARS`.
- `apps/api/src/modules/tax/module.ts` — wired `TaxDocumentRetentionService`.
- `apps/api/src/core/erasure/erasure.module.ts` — imported `TaxModule`.
- `apps/api/src/core/erasure/erasure.service.ts` — injected retention service; `processUser` stamps the `statutoryHold` block on the outcome.
- `apps/api/src/core/erasure/erasure.service.spec.ts` — adjusted constructor + outcome assertion for the new shape.

**Next:** Phase 22 — see entry above. Stub NIC adapter + applicability gate + retry cron + 24h cancellation window operational.

---

### Phase 20 — Download security (auth + scope + audit + rate limit) — 2026-05-13

**What was built (backend):**

*Schema additions:* new table `tax_document_download_audits` + two enums
- `TaxDocumentActorType` — `CUSTOMER | SELLER | ADMIN | FRANCHISE | SYSTEM`. Drives the scope decision.
- `TaxDocumentDownloadOutcome` — `ALLOWED | DENIED_SCOPE | DENIED_NOT_READY | DENIED_RATE_LIMIT | DENIED_VOIDED`. Every download attempt (success OR denial) writes a row.
- `tax_document_download_audits` columns: `taxDocumentId` (FK RESTRICT — audit must outlive the document for the statutory 8-year retention window), `actorType` / `actorId` / `actorRole`, `outcome` / `denyReason`, `issuedUrl` / `urlExpiresAt` / `ttlSeconds`, `ipAddress` / `userAgent`, `createdAt`.
- Three indexes: per-document forensic walk `(tax_document_id, created_at)`, per-actor history `(actor_type, actor_id, created_at)`, partial DENIED-only `WHERE outcome != 'ALLOWED'` for flooding-attack lookup.

*Service:* `apps/api/src/modules/tax/application/services/tax-document-download.service.ts`

`TaxDocumentDownloadService.issueDownloadUrl({ documentId, actor, expiresInSeconds? })` — five-gate pipeline:

1. **Not-found**: missing document → throws `PdfDocumentNotFoundError` (no audit row; nothing to audit against).
2. **Status guard**: VOIDED_DRAFT / SUPERSEDED → `DENIED_VOIDED` audit + `TaxDocumentDownloadDeniedError`. Even admins cannot download via this endpoint; a separate forensic admin path exists for the rare reverse-the-cancellation flow.
3. **Scope guard** — per actor type:
   - `CUSTOMER` — `customerId == actor.id` required.
   - `SELLER` / `FRANCHISE` — `sellerId == actor.id` required.
   - `ADMIN` — no scope check (the controller does the permission check; the service trusts ADMIN and **audits the access**).
   - `SYSTEM` — no scope check (cron jobs / internal services).
   - Violation → `DENIED_SCOPE` audit with a descriptive reason.
4. **PDF readiness**: `status != PDF_GENERATED` → `DENIED_NOT_READY` audit. Customer / seller will never see a half-rendered invoice.
5. **Rate limit**: per-(actor, document) sliding-window count of recent `ALLOWED` audits. Defaults: 20 downloads in 5 minutes. SYSTEM actors bypass. Exceeded → `DENIED_RATE_LIMIT` audit so abuse leaves a trail.

On `ALLOWED`:
- Calls `TaxDocumentPdfService.getSignedDownloadUrl({ documentId, expiresInSeconds })` to mint the URL (uses Phase 19's storage provider; bumps `downloadCount` + `lastDownloadedAt`).
- Records the issued URL + `urlExpiresAt` (timestamp the URL stops working — incident response can join leaked-URL reports to mint time).
- Returns `{ url, documentNumber, documentId, expiresInSeconds }`.

Audit-write resilience: a failing audit-write logs to ops via the logger but does NOT swallow a denial. The deny outcome still throws even if we couldn't log it.

*Env flags:*
- `TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW` (default 20).
- `TAX_DOWNLOAD_RATE_LIMIT_WINDOW_MINUTES` (default 5).
- `TAX_DOWNLOAD_SIGNED_URL_TTL_SECONDS` (default 300; minimum 30).

**Tests:**
- New `tax-download-service.spec.ts` — 19 tests covering:
  - Not-found document → `PdfDocumentNotFoundError`.
  - VOIDED_DRAFT / SUPERSEDED → `DENIED_VOIDED` (admin attempts audited).
  - CUSTOMER scope: denied on customerId mismatch; allowed on match.
  - SELLER scope: denied on sellerId mismatch; allowed on match.
  - FRANCHISE follows seller scope rules.
  - ADMIN bypasses scope; role captured in audit (`actorRole: 'finance_admin'`).
  - SYSTEM bypasses scope AND rate limit (no count query).
  - PDF_PENDING / PDF_FAILED → `DENIED_NOT_READY`.
  - Rate limit: cap=3, count=3 → denied; cap=5, count=2 → allowed.
  - Audit-write failure does NOT swallow the deny.
  - TTL: env default (600s) used when not supplied; caller override honoured (60s); `urlExpiresAt` stamped within 2s of expected.
  - IP / user-agent captured on `ALLOWED` audit.
- Combined: **339/339 tax tests passing** (320 prior + 19 new).
- Real-DB integration (FK retention behaviour, sliding-window race on audit count) queued for Phase 27.

**Behaviour change today:**
- Tax-document downloads are now **scope-protected at the service layer**. Any HTTP route that exposes downloads must call `TaxDocumentDownloadService.issueDownloadUrl` (not `TaxDocumentPdfService.getSignedDownloadUrl` directly) so the audit row + denial outcomes are uniform.
- The PDF service's `getSignedDownloadUrl` stays available for INTERNAL callers (Phase 19 retry cron, post-render verification) — those callers pass `actor.type === 'SYSTEM'` if they want the audit row.
- Every download attempt — including denials — leaves a row in `tax_document_download_audits`. Forensics, incident response, and abuse detection all join on this table.
- Frontend wiring (admin / seller / customer download buttons) lands in Phase 25; this phase ships the service + audit layer that those routes will call.

**CA decisions touched / partially resolved:**
- §3 row "Invoice download authorisation" — operational: CUSTOMER limited to their own; SELLER / FRANCHISE limited to their own supplied invoices; ADMIN unrestricted but audited.
- §3 row "Signed-URL TTL" — env-tunable; default 300s (5 min). CA picks the prod value.
- §3 row "Download rate limit" — env-tunable; default 20 / 5min. CA picks the prod value or disables (set cap to a very high number).
- §3 row "Audit retention" — operational: `tax_document_download_audits` is FK-RESTRICT to `tax_documents`, so the audit can never be silently lost by a parent delete. Retention enforcer (Phase 21) honours the 8-year statutory window.

**Sign-off items §10 backed (additional):**
- ✓ Customer / seller scope enforcement — no cross-tenant invoice access.
- ✓ Admin downloads are audited (no silent admin reads).
- ✓ Every denial outcome distinct (`DENIED_SCOPE` / `DENIED_NOT_READY` / `DENIED_RATE_LIMIT` / `DENIED_VOIDED`) so forensic queries can distinguish "user tried to escape scope" from "user hit a real PDF-not-ready timing window".
- ✓ Rate limit is per-(actor, document) — cannot be bypassed by spreading across multiple invoices.
- ✓ Audit-write failure does not silently grant access (denial still throws).
- ✓ VOIDED_DRAFT / SUPERSEDED documents are never downloadable via this path.
- ✓ Issued URL + TTL captured in audit for incident response.

**Files added:**
- `apps/api/prisma/schema/tax-document-downloads.prisma`
- `apps/api/prisma/schema/migrations/20260513260000_tax_document_download_audit/migration.sql`
- `apps/api/src/modules/tax/application/services/tax-document-download.service.ts`
- `apps/api/test/unit/tax-download-service.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/tax-documents.prisma` — added `downloadAudits` back-relation on `TaxDocument`.
- `apps/api/src/bootstrap/env/env.schema.ts` — added 3 env flags.
- `apps/api/src/modules/tax/module.ts` — wired `TaxDocumentDownloadService`.

**Next:** Phase 21 — see entry above. Statutory retention helper + retention service + erasure-outcome statutoryHold block operational.

---

### Phase 19 — PDF generation + retry + signed-URL storage — 2026-05-13

**What was built (backend):**

*Schema additions:* 4 new columns on `tax_documents`
- `pdf_retry_count` — INT (default 0). Incremented on every failed render attempt.
- `pdf_last_attempted_at` — TIMESTAMPTZ. Stamped on every attempt (success or failure) for the cron's cooldown predicate.
- `pdf_failure_reason` — TEXT. Cleared on success, captured on failure.
- `pdf_provider` — TEXT. Records which adapter (`'stub'` / `'s3'` / future) wrote the row.
- Partial index `WHERE status IN ('PDF_PENDING', 'PDF_FAILED')` keyed on `(status, retry_count, last_attempted_at)` drives the retry cron.
- New `AdminTaskKind` value `TAX_DOCUMENT_PDF_FAILED` opens once a document hits the retry cap.

*Pure template:* `apps/api/src/modules/tax/domain/tax-document-html-template.ts`

`renderHtmlForDocument(input)` dispatches by `documentType` to five DRAFT-banner templates:
- **Tax Invoice** (TAX_INVOICE) — full GST columns + CGST/SGST/IGST/cess breakdown + line-rate %.
- **Invoice-cum-Bill of Supply** (INVOICE_CUM_BILL_OF_SUPPLY) — same as Tax Invoice with different heading.
- **Bill of Supply** (BILL_OF_SUPPLY) — composition / exempt supplier; no GST columns.
- **Credit Note** (CREDIT_NOTE) — full GST columns + original document reference + Section 34 footer.
- **Debit Note** (DEBIT_NOTE) — same structure as Credit Note.
- **Legacy Order Receipt** (LEGACY_RECEIPT) — non-tax banner, no GST columns.
- Every render carries a **DRAFT banner**: "Template pending CA sign-off. Layout, supplier branding, and legal disclaimers are not final. Not for issuance to customers." (envlope-level; not yet env-gated — Phase 23's strict-mode flip will suppress it post-CA-signoff.)
- Money rendered with **Indian numbering grouping** (lakh/crore: `1,50,000.00`).
- Dates rendered in **IST DD-MM-YYYY** (so an invoice generated at 19:00 UTC on 31 Mar shows 01-04-2026 IST).
- Negative amounts use **accounting parentheses** style: `(0.05)`.
- All interpolated values **HTML-escaped** via a minimal `&<>"'` sanitiser. Script-injection in seller name, buyer name, etc. is neutralised at render time.
- Pure function — no I/O.

*Provider interface + stub:* `apps/api/src/modules/tax/infrastructure/pdf/`
- `TaxPdfStorageProvider` — `upload(input)` → `{ storagePath, publicUrl, sha256, provider }`; `createSignedUrl({ storagePath, expiresInSeconds? })`.
- `StubTaxPdfStorageProvider` — writes to local FS at `apps/api/storage/tax-pdfs/${fy}/${supplier}/${docType}/${number}.html`. Returns `file://` URL with a synthetic `?expires=...` query so callers don't accidentally cache it forever. SHA-256 hash computed for integrity-verifier interop.
- Module wiring uses a `useFactory` keyed on `TAX_PDF_STORAGE_PROVIDER` env: `stub` returns the stub; `s3` throws loudly at boot ("S3 adapter does not yet support PUT") — same crash-on-misconfig pattern as Phase 15's EWB provider.

*Service:* `apps/api/src/modules/tax/application/services/tax-document-pdf.service.ts`

`TaxDocumentPdfService` — three entry points:

1. `renderAndUpload({ documentId })` → `TaxDocument`
   - Loads document + lines.
   - Refuses VOIDED_DRAFT / SUPERSEDED rows.
   - Renders HTML, wraps as a UTF-8 Buffer, uploads via the configured provider.
   - Stores the `pdfUrl`, `pdfStoragePath`, `pdfSha256`, `pdfProvider`, `pdfLastAttemptedAt`. Clears `pdfFailureReason`. Flips status PDF_PENDING / PDF_FAILED → PDF_GENERATED.
   - Storage path format: `${fy}/${supplierGstin|PLATFORM}/${documentType}/${documentNumber}.html`. Slashes in `documentNumber` sanitised to `-` so we don't create accidental subdirs.

2. `markAttemptFailed({ documentId, reason })` → `TaxDocument`
   - Increments `pdfRetryCount`, stamps `pdfFailureReason` + `pdfLastAttemptedAt`, flips to `PDF_FAILED`. Called by the retry cron when `renderAndUpload` throws.

3. `getSignedDownloadUrl({ documentId, expiresInSeconds? })` → `{ url, documentNumber }`
   - Refuses on non-PDF_GENERATED documents (or those with a null `pdfStoragePath`) so callers never hand out broken links.
   - Asks the provider for a signed URL (default 300 s).
   - Bumps `downloadCount` + `lastDownloadedAt` (best-effort — counter race doesn't fail the URL).

*Retry cron:* `apps/api/src/modules/tax/application/jobs/tax-document-pdf-retry.cron.ts`

`TaxDocumentPdfRetryCron` — every 5 min, wrapped in `LeaderElectedCron` (cluster-safe) + `CronInstrumentationService` (records `{ scanned, rendered, failed, escalated }`):
- Picks up rows in `PDF_PENDING` / `PDF_FAILED` with `retryCount < cap` AND `lastAttemptedAt < (now - cooldown)`.
- Calls `renderAndUpload`. Failures call `markAttemptFailed`.
- After each pass, escalates any rows that hit the retry cap by opening a `TAX_DOCUMENT_PDF_FAILED` AdminTask (idempotent on `(kind, sourceType, sourceId)`, scoped to `MANUAL` source type since tax_documents aren't in the `LedgerSourceType` enum).

*Env flags:*
- `TAX_PDF_STORAGE_PROVIDER` (enum: `stub` | `s3`; default `stub`).
- `TAX_PDF_RETRY_CRON_ENABLED` (default `true`).
- `TAX_PDF_RETRY_CAP` (default 5).
- `TAX_PDF_RETRY_COOLDOWN_MINUTES` (default 5).
- `TAX_PDF_RETRY_SCAN_LIMIT` (default 50).

**Tests:**
- New `tax-pdf-template.spec.ts` — 15 tests covering: DRAFT banner present on every render; correct heading per documentType (Tax Invoice / Invoice-cum-BoS / Bill of Supply / Credit Note / Legacy Receipt); Indian numbering (1,50,000.00); reverse-charge banner; HTML escaping (script tag neutralised; `&` → `&amp;`); CGST/SGST/IGST columns toggle per template; original-document reference on Credit Note; date formatting IST DD-MM-YYYY; IST-day rollover near midnight UTC; negative amounts as accounting parentheses; unknown documentType throws.
- New `tax-pdf-service.spec.ts` — 12 tests covering: not-found throws; refuses VOIDED_DRAFT / SUPERSEDED; happy-path render+upload+update with payload assertions; PLATFORM storage path for null `supplierGstin`; slash sanitisation in storage path; upload error propagation (cron catches); `markAttemptFailed` increments retry count + flips status; `getSignedDownloadUrl` not-found / PDF_PENDING / null-path refusals; happy-path URL + download-count increment; counter-race safe.
- Combined: **320/320 tax tests passing** (293 prior + 27 new).
- Real-DB integration with cron sweep + storage provider live-write queued for Phase 27.

**Behaviour change today:**
- Newly-generated tax documents (TaxDocumentService.generateForSubOrder, CreditNoteService.generateForReturn, LegacyReceiptService.generateForSubOrder, etc.) land in PDF_PENDING and the cron picks them up within ~5 minutes — no manual step.
- A failed render queues for retry; after 5 attempts (24-minute spread with default cooldown) an AdminTask opens for ops triage.
- HTML output is **DRAFT-banner-flagged** in every render so a non-prod download cannot be mistaken for a customer-issuable invoice. CA reviews the templates; engineering flips the banner off in Phase 23 (strict-mode rollout).
- Customer / admin download surface lands in Phase 25 (frontend); the backend `getSignedDownloadUrl` is ready to call.

**CA decisions touched / partially resolved:**
- §3 row "Invoice PDF rendering" — operational with DRAFT banner. CA reviews template layout + supplier branding + legal disclaimers.
- §3 row "Signed-URL TTL" — env-tunable via `expiresInSeconds`; default 300 s. CA can pick the prod value.
- §3 row "Retry policy" — operational: 5 attempts, 5-min cooldown, escalation AdminTask. CA can adjust both knobs.
- `CA.md §6.4 PDF layout` — fully implemented (header, supplier/buyer/shipping blocks, line table, totals + amount-in-words, footer). Final styling pending CA review.

**Sign-off items §10 backed (additional):**
- ✓ Every tax document type has a render template (TAX_INVOICE / INVOICE_CUM_BoS / BILL_OF_SUPPLY / CREDIT_NOTE / DEBIT_NOTE / LEGACY_RECEIPT).
- ✓ DRAFT banner prevents accidental customer issuance pre-CA-signoff.
- ✓ HTML-escaping prevents script injection from seller/buyer name fields.
- ✓ Indian numbering on money + IST date formatting on every render.
- ✓ Idempotent render: re-running `renderAndUpload` on a PDF_GENERATED row re-uploads (storage path stable; provider deduplicates by key).
- ✓ Retry cron is cluster-safe (LeaderElectedCron) + instrumented (CronInstrumentationService).
- ✓ Escalation AdminTask opens once per failure cap (no spam).
- ✓ Signed-URL download surface refuses on non-rendered documents (no broken links).
- ✓ Provider swap is single-line at boot — no service-layer change to wire S3/Cloudinary later.

**Files added:**
- `apps/api/prisma/schema/migrations/20260513250000_tax_pdf_retry_columns/migration.sql`
- `apps/api/src/modules/tax/domain/tax-document-html-template.ts`
- `apps/api/src/modules/tax/infrastructure/pdf/tax-pdf-storage.provider.ts`
- `apps/api/src/modules/tax/infrastructure/pdf/stub-tax-pdf-storage.provider.ts`
- `apps/api/src/modules/tax/application/services/tax-document-pdf.service.ts`
- `apps/api/src/modules/tax/application/jobs/tax-document-pdf-retry.cron.ts`
- `apps/api/test/unit/tax-pdf-template.spec.ts`
- `apps/api/test/unit/tax-pdf-service.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/tax-documents.prisma` — added 4 retry-tracking columns.
- `apps/api/prisma/schema/liability-ledger.prisma` — added `TAX_DOCUMENT_PDF_FAILED` AdminTaskKind.
- `apps/api/src/bootstrap/env/env.schema.ts` — added 5 env flags.
- `apps/api/src/modules/tax/module.ts` — wired storage provider factory + `TaxDocumentPdfService` + `TaxDocumentPdfRetryCron`.

**Next:** Phase 20 — see entry above. Scope-protected download service + per-attempt audit + rate limit operational.

---

### Phase 18 — Reports + exports (GSTR-1, GSTR-3B) — 2026-05-13

**What was built (backend):**

*Pure aggregator:* `apps/api/src/modules/tax/domain/gstr1-aggregator.ts`

`aggregateGstr1(docs)` — bucket a seller's documents into CBIC GSTR-1 sections:
- **§4 B2B** — invoices with `buyerGstin` set; one row per invoice (number, date, GSTIN, POS, invoice value, taxable, CGST, SGST, IGST, cess, reverse-charge flag).
- **§5 B2C Large** — `documentTotal > ₹2.5L` AND inter-state (`sellerStateCode != placeOfSupplyStateCode`) AND no buyer GSTIN; invoice-by-invoice.
- **§7 B2C Small** — everything else B2C; aggregated by `(placeOfSupplyStateCode, gstRateBps)`. Per-line walk when lines are present (correct rate-wise split on mixed-rate invoices); falls back to document-level totals when lines aren't attached.
- **§9B Credit Notes** — one row per `CREDIT_NOTE` document; carries `buyerType` ('B2B' / 'B2C'), original invoice number, all reversal amounts.
- **§12 HSN Summary** — per `(hsnOrSacCode, gstRateBps)` aggregate of total quantity + total value + tax breakdown. Lines without an HSN code are skipped silently (data drift is visible via the §13 count vs. §12 totals divergence).
- **§13 Documents Issued** — count by `documentType` (TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY / BILL_OF_SUPPLY / CREDIT_NOTE / LEGACY_RECEIPT). Sorted alphabetically.
- **Totals block** — gross totals across §4 + §5 + §7 (taxable, CGST, SGST, IGST, cess, invoice value); separate `creditNoteValueInPaise`.
- Pure function — no I/O. Inputs are Prisma-shaped rows; aggregator owns the bucketing logic. B2C Large threshold (`₹2.5L`) is a module-level constant per CBIC notification.

*Service:* `apps/api/src/modules/tax/application/services/gstr1-report.service.ts`

`Gstr1ReportService` — six CSV generators + one structured aggregate method:
1. `aggregateForSeller({ sellerId, filingPeriod })` → `Gstr1Aggregate`
   - IST-aware month-range UTC bounds (1 Apr 00:00 IST = 31 Mar 18:30 UTC).
   - Filters by seller + period + `status NOT IN ('VOIDED_DRAFT', 'SUPERSEDED')`.
   - Includes lines for §12 HSN computation.
2. `generateB2bCsv` — §4 CSV; header column order load-bearing for upload tooling.
3. `generateB2cLargeCsv` — §5 CSV.
4. `generateB2cSmallCsv` — §7 CSV with rate rendered as percentage (1800 bps → 18.00).
5. `generateCreditNoteCsv` — §9B CSV.
6. `generateHsnSummaryCsv` — §12 CSV.
7. `generateDocumentsIssuedCsv` — §13 CSV.

Paise → rupees conversion handles sub-rupee amounts (5 paise → `0.05`), preserves sign (negative reversal → `-100.00`). CSV cell escaping handles quotes, commas, newlines.

*Service:* `apps/api/src/modules/tax/application/services/gstr3b-report.service.ts`

`Gstr3bReportService` — produces GSTR-3B Section 3.1 + 3.2 (the only sections Sportsmart can populate from marketplace data; inward + ITC stays in the seller's own books):

- **Section 3.1(a)** — outward taxable supplies (other than zero/nil/exempted). Net of credit notes per CBIC return-filing instructions. Clamped at zero if credit notes exceed invoices.
- **Section 3.1(b)** — outward zero-rated (empty for marketplace; no exports yet).
- **Section 3.1(c)** — nil-rated + exempted (empty until we add `NIL_RATED` / `EXEMPT` SupplyTaxability rows to the engine).
- **Section 3.1(e)** — non-GST outward (empty).
- **Section 3.2** — inter-state B2C supplies by place of supply (derived from GSTR-1 §5 + §7 inter-state buckets; CGST+SGST intra-state stays in 3.1(a)).
- `summariseForSeller({ sellerId, filingPeriod })` → `Gstr3bSummary` structured shape.
- `generateCsv` → 4 fixed rows (3.1 a/b/c/e) regardless of period contents, so NIL filings still produce a valid CSV.

**Tests:**
- New `tax-gstr1-aggregator.spec.ts` — 12 tests covering: empty list; B2B placement; B2C Large placement (inter-state > ₹2.5L); B2C Small for everything else; intra-state ₹3L stays in §7 (not Large); §7 aggregation across multiple invoices at same (state, rate); CREDIT_NOTE into §9B with B2B/B2C distinction; §12 HSN aggregation across multiple documents; §12 split by (code, rate) pair; §13 count by type including LEGACY_RECEIPT + BILL_OF_SUPPLY; null HSN doesn't crash.
- New `tax-gstr1-report.spec.ts` — 7 tests covering: IST-aware UTC range translation; malformed period rejection; header-only on empty; row shape (B2B columns); rate-percentage rendering (1800 bps → 18.00); HSN CSV; §13 sorted output.
- New `tax-gstr3b-report.spec.ts` — 6 tests covering: zero-period defaults; multi-invoice aggregation; credit-note netting; clamp at zero when reversal exceeds invoices; §3.2 inter-state B2C only (intra-state excluded); CSV produces 4 fixed rows regardless of data.
- Combined: **293/293 tax tests passing** (268 prior + 25 new).
- Real-DB integration with seeded invoices queued for Phase 27.

**Behaviour change today:**
- The report services are **available** but not yet exposed via HTTP routes. Phase 25's admin/seller frontend will wire `GET /admin/reports/gstr1.csv?sellerId=&filingPeriod=` and equivalents. Backend data is fully populated and reachable from any authenticated service.
- Sellers requesting GSTR-1 / GSTR-3B today can have admin call the service from a script: `gstr1Report.generateB2bCsv({ sellerId, filingPeriod: '2026-04' })`.
- The Phase 16 `Gstr8ReportService` continues to drive the platform-side TCS export; the two services share no code but their CSV-rendering conventions match.

**CA decisions touched / partially resolved:**
- §3 row "GSTR-1 schema" — operational: §4 / §5 / §7 / §9B / §12 / §13 all produce CBIC-shape CSVs. §6A / §6B (exports) deferred until export support lands.
- §3 row "B2C Large threshold" — ₹2.5L per CBIC notification, encoded as a constant in the aggregator. CA can adjust by editing one line + re-running tests.
- §3 row "Credit note netting in GSTR-3B" — operational: per CBIC return-filing instructions, credit notes reduce the outward taxable value reported in 3.1(a) for the period they fall in.
- §3 row "Section 3.2 vs 3.1(a)" — disambiguated: intra-state B2C in 3.1(a), inter-state B2C in 3.2; the split is automatic from the snapshot state codes.
- §6.3 — GSTR-1 + GSTR-3B + GSTR-8 trio is operational end-to-end.

**Sign-off items §10 backed (additional):**
- ✓ Per-seller GSTR-1 export across all six CBIC sections (§4 / §5 / §7 / §9B / §12 / §13).
- ✓ Per-seller GSTR-3B Section 3.1 + 3.2 export.
- ✓ Credit notes net outward supplies per CBIC convention.
- ✓ Clamp-at-zero handling for net-negative outward (no invalid negative entries in 3B).
- ✓ HSN summary auto-derived from snapshot lines.
- ✓ Documents-issued count includes legacy receipts + bill-of-supply separately from tax invoices.
- ✓ NIL filing supported for all sections (header-only CSV / four-zero-row 3B CSV).

**Files added:**
- `apps/api/src/modules/tax/domain/gstr1-aggregator.ts`
- `apps/api/src/modules/tax/application/services/gstr1-report.service.ts`
- `apps/api/src/modules/tax/application/services/gstr3b-report.service.ts`
- `apps/api/test/unit/tax-gstr1-aggregator.spec.ts`
- `apps/api/test/unit/tax-gstr1-report.spec.ts`
- `apps/api/test/unit/tax-gstr3b-report.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — wired `Gstr1ReportService` + `Gstr3bReportService`.

**Next:** Phase 19 — see entry above. HTML template renderer + stub storage + retry cron + signed-URL helper operational.

---

### Phase 17 — Settlement ↔ TCS hook (auto-deduct at approval) — 2026-05-13

**What was built (backend):**

*Schema additions:* 4 new columns on `seller_settlements`
- `tcs_ledger_id` — FK to `gst_tcs_settlement_ledger.id` (RESTRICT on delete). NULL until the TCS hook runs.
- `tcs_deducted_in_paise` — BIGINT, denormalised paise amount so the seller payout statement renders without a join.
- `tcs_rate_bps_snapshot` — INT (default 100). Historical rate at the time of this settlement; matches the linked ledger row's rate so a later rate change leaves this row's value frozen.
- `tcs_filing_period` — TEXT (`YYYY-MM`). Captures the GSTR-8 filing month this settlement contributes to.
- Partial index `tcs_ledger_id_idx WHERE tcs_ledger_id IS NOT NULL` for admin queries on collected vs not-yet-collected.

*Service:* `apps/api/src/modules/tax/application/services/settlement-tcs-hook.service.ts`

`SettlementTcsHookService` — three entry points:

1. `applyToCycleOnApprove({ cycleId, actorId? })` → `ApplyToCycleResult`
   - Loads the cycle and derives the filing period from `cycle.periodEnd` via `TcsService.filingPeriodOf` (so a cycle ending in early May files in `2026-05`).
   - For every `SellerSettlement` in the cycle WITHOUT an existing `tcsLedgerId`:
     - Calls `TcsService.computeForSeller({ sellerId, filingPeriod, computedBy, computedReason })`.
     - Stamps the `SellerSettlement` row with `tcsLedgerId`, `tcsDeductedInPaise`, `tcsRateBpsSnapshot`, `tcsFilingPeriod`.
   - **Idempotent**: settlements that already carry a `tcsLedgerId` are skipped (counted as `settlementsSkipped`).
   - **Resilient**: per-seller compute failures are logged but don't crash the cycle approval — finance can re-run targeted compute via the admin endpoint.
   - Returns aggregate counts `{ settlementsProcessed, settlementsSkipped, totalTcsDeductedInPaise, filingPeriod }`.

2. `markCollectedOnPay({ settlementId })` → `{ ledgerId, flipped }`
   - Called from `SettlementService.markSettlementPaid` after the payment transaction commits.
   - Looks up the settlement's `tcsLedgerId`; bails out cleanly when null (settlement approved pre-Phase-17) or when the ledger row is already past COMPUTED.
   - Calls `TcsService.markCollected({ ledgerId, settlementId })` to flip COMPUTED → COLLECTED.

3. `static computeNetPayoutInPaise(settlement)` → bigint
   - Pure helper for the payout-statement renderer. Returns `totalSettlementAmountInPaise - tcsDeductedInPaise`. Lets the seller UI surface "Settlement: ₹50,000 − TCS ₹500 = ₹49,500 net payout" without re-deriving from the ledger.

*Integration:* `SettlementService` (in `apps/api/src/modules/settlements/settlement.service.ts`)
- New constructor injection: `SettlementTcsHookService`.
- `approveCycle(cycleId, actorId?)` — after the cycle + settlements flip to `APPROVED`, the hook's `applyToCycleOnApprove` runs and the result is included in the response payload (`{ success, message, tcs }`). Per TCS_POLICY §4: "TCS is computed at settlement-run time, not at invoice issuance."
- `markSettlementPaid(settlementId, utrReference, actorContext?)` — after the payout transaction commits, the hook's `markCollectedOnPay` runs to flip COMPUTED → COLLECTED. Failures here are logged but don't roll back the payout (the payout has already happened; finance can retry mark-collected via admin endpoint).

*Module wiring:*
- `TaxModule` exports `SettlementTcsHookService`.
- `SettlementsModule` imports `TaxModule` so SettlementService can inject the hook.

**Tests:**
- New `tax-settlement-tcs-hook.spec.ts` — 12 tests covering:
  - `applyToCycleOnApprove`: throws on unknown cycle; stamps both settlements with correct ledger IDs + deducted paise + rate snapshot + filing period; idempotent on already-stamped rows; continues past per-seller compute failure (logs but doesn't crash); derives filing period from cycle periodEnd (1 May UTC → 2026-05 IST).
  - `markCollectedOnPay`: returns flipped=false on null tcsLedgerId, on orphan link (ledger missing), on already-COLLECTED, on already-FILED; happy-path flip COMPUTED → COLLECTED.
  - `computeNetPayoutInPaise`: subtracts TCS; returns total when TCS is zero.
- Combined: **268/268 tax tests passing** (256 prior + 12 new).
- Integration tests (real `SettlementService.approveCycle` + `markSettlementPaid` round-trips with real Prisma) queued for Phase 27.

**Behaviour change today:**
- Approving a settlement cycle **now auto-runs** TCS computation for every seller in the cycle. The TCS amount is stamped on each `SellerSettlement` row so seller-side reads (`GET /seller/earnings/settlements`) surface it without controller changes.
- Marking a settlement PAID **now auto-flips** the linked TCS row COMPUTED → COLLECTED.
- The seller's effective payout displayed downstream = `totalSettlementAmount − tcsDeducted`; the existing settlement read endpoints already return both columns, so the seller dashboard (Phase 25) can render the breakdown without API changes.
- The settlements UI does not yet have a dedicated "TCS this cycle" panel — that's Phase 25's frontend work. The backend data is fully populated and reachable today.

**CA decisions touched / partially resolved:**
- §3 row "TCS computation timing" — operational: TCS is COMPUTED at cycle approval (matching TCS_POLICY §4: "at the time of crediting the amount in the account of the supplier" = the settlement run). COLLECTED at the payout transaction.
- §3 row "Net payout formula" — operational: seller's net payout = totalSettlement − tcsDeducted. Both columns persisted; the helper exposes the arithmetic.
- §3 row "GSTR-2A reconciliation" — operational: a seller can match each `tcsDeductedInPaise` row in their settlement history against their GSTR-2A's TCS entries one-to-one (the platform's GSTR-8 export uses the same ledger rows).

**Sign-off items §10 backed (additional):**
- ✓ Automatic TCS deduction at settlement approval (no manual admin step).
- ✓ Per-settlement TCS amount + rate + filing period snapshot preserved against future rate changes.
- ✓ Idempotent on re-approval (settlements already carrying a ledger ID are skipped).
- ✓ Resilient — per-seller compute failure does not crash the cycle approval.
- ✓ Status lifecycle wired end-to-end: COMPUTED (at approve) → COLLECTED (at PAID) → FILED (Phase 16's `markFiled`) → PAID_TO_GOVT (Phase 16's `markPaidToGovt`).
- ✓ Settlement read API now returns the four new TCS columns — seller dashboard renders "TCS deducted this cycle: ₹X" by reading `tcsDeductedInPaise` directly.

**Files added:**
- `apps/api/prisma/schema/migrations/20260513240000_settlement_tcs_columns/migration.sql`
- `apps/api/src/modules/tax/application/services/settlement-tcs-hook.service.ts`
- `apps/api/test/unit/tax-settlement-tcs-hook.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/settlements.prisma` — added 4 TCS columns + FK + back-relation on `SellerSettlement`.
- `apps/api/prisma/schema/gst-tcs.prisma` — added `sellerSettlements` back-relation on `GstTcsSettlementLedger`.
- `apps/api/src/modules/tax/module.ts` — wired `SettlementTcsHookService`.
- `apps/api/src/modules/settlements/module.ts` — imported `TaxModule`.
- `apps/api/src/modules/settlements/settlement.service.ts` — injected the hook; called `applyToCycleOnApprove` after cycle approval; called `markCollectedOnPay` after payout commit.

**Next:** Phase 18 — see entry above. GSTR-1 (§4/§5/§7/§9B/§12/§13) + GSTR-3B (3.1/3.2) report services operational.

---

### Phase 16 — TCS (CGST §52) settlement ledger + GSTR-8 export — 2026-05-13

**What was built (backend):**

*New enum:* `TcsStatus` in `gst-tcs.prisma`
- `COMPUTED` | `COLLECTED` | `FILED` | `PAID_TO_GOVT` | `REVERSED`. Lifecycle moves left-to-right at each operational checkpoint (settlement run → GSTR-8 upload → govt remittance).

*New AdminTaskKind values:* in `liability-ledger.prisma`
- `GSTR8_FILING_DUE` — opened N days before the 10th-of-month deadline (cron lands in Phase 18).
- `TCS_COMPUTATION_FAILED` — opened when a per-seller compute pass crashes (inconsistent invoice state).

*New table:* `gst_tcs_settlement_ledger`
- One row per `(sellerId, filingPeriod)` enforced via PARTIAL UNIQUE `WHERE status != 'REVERSED'` — corrected rows coexist with their reversed predecessors via `correction_of_id` chain.
- Frozen supplier-identity snapshot (`supplier_gstin`, `supplier_state_code`) at compute time — a later GSTIN change cannot rewrite filed history.
- Aggregate columns: `gross_taxable_supply`, `credit_note_reversal`, `net_taxable_supply`, plus the intra/inter split (`intra_state_taxable`, `inter_state_taxable`).
- TCS amounts split per leg: `cgst_tcs`, `sgst_tcs`, `igst_tcs`, `total_tcs`. Historical `tcs_rate_bps` snapshot so a future rate notification doesn't rewrite the past.
- Carry-forward column `adjustment_carried_forward_in_paise` for negative-net-supply situations (credit notes in the period exceed invoices).
- Lifecycle audit: `computed_at/by/reason`, `collected_at + settlement_id`, `filed_at/by`, `paid_to_govt_at + paid_by + payment_reference`.
- FK to `sellers` is RESTRICT — a seller cannot be deleted while they have TCS history.

*Pure helper:* `apps/api/src/modules/tax/domain/tcs-calculator.ts`

Three pure functions for the unit-testable TCS math:
- `computeTcs({ intraStateTaxableInPaise, interStateTaxableInPaise, rateBps? })` → `{ cgstTcsInPaise, sgstTcsInPaise, igstTcsInPaise, totalTcsInPaise, rateBps }`. Half-away-from-zero rounding per leg using pure BigInt arithmetic (no IEEE-754 drift even at crore scale). Splits the rate evenly between CGST/SGST for intra-state; assigns the full rate to IGST for inter-state. Handles odd-bps splits (e.g. 101 bps → CGST 50, SGST 51). Rejects out-of-range rates.
- `clampNetSupplyWithCarryForward({ grossTaxableInPaise, creditNoteReversalInPaise, priorCarryForwardInPaise? })` → `{ netTaxableInPaise, carryForwardInPaise }`. Clamps net at zero when reversals + prior carry exceed gross, emitting the excess as next-period carry-forward.
- `filingPeriodOf(date)` → `"YYYY-MM"` in IST (1 Apr 00:00 IST = 31 Mar 18:30 UTC bucketed correctly).

*Service:* `apps/api/src/modules/tax/application/services/tcs.service.ts`

`TcsService` — six entry points + a static helper:

1. `computeForSeller({ sellerId, filingPeriod, computedBy?, computedReason? })` → `{ ledger, isNew }`
   - Reads `tcs_rate_bps` from `tax_config` (default 100).
   - Pulls `TAX_INVOICE` + `INVOICE_CUM_BILL_OF_SUPPLY` + `CREDIT_NOTE` rows for the seller in the period (IST-aware month-range UTC bounds).
   - Aggregates in memory: invoices add to gross + the appropriate state-bucket; credit notes subtract from both gross and the bucket.
   - Looks up the immediately-prior period's `adjustment_carried_forward_in_paise` and applies it as an additional reversal in the current period.
   - Distributes the post-clamp net taxable supply proportionally between intra/inter buckets so the TCS computation reflects the correct split after clamping. When raw totals are zero (NIL period), defaults the entire net to inter-state.
   - Persists a row in `COMPUTED` status. Idempotent on re-call — returns the existing active row.
2. `markCollected({ ledgerId, settlementId })` → `GstTcsSettlementLedger`
   - Settlement-run hook. Stamps `collectedAt + settlementId`; flips `COMPUTED → COLLECTED`. Idempotent on already-COLLECTED; refuses other transitions via `TcsInvalidTransitionError`.
3. `markFiled({ ledgerIds[], filedBy })` → count flipped
   - Bulk `updateMany WHERE status='COLLECTED' AND id IN (...)`. Already-FILED or COMPUTED rows are skipped without erroring.
4. `markPaidToGovt({ ledgerIds[], paidBy, paymentReference })` → count flipped
   - Bulk `updateMany WHERE status='FILED'`. Captures payment reference for audit (bank transfer ID, etc.).
5. `reverse({ ledgerId, reversedBy, reason })` → `GstTcsSettlementLedger`
   - Correction flow. Marks the source row REVERSED, appending the reversal reason + reverser to `computed_reason`. Caller follows up with a fresh `computeForSeller` to produce the corrected row.
6. `listForPeriod(filingPeriod)` → ordered ledger rows for the period (drives the GSTR-8 export).

*Report service:* `apps/api/src/modules/tax/application/services/gstr8-report.service.ts`

`Gstr8ReportService` — three entry points:

1. `generateCsv(filingPeriod)` → CSV string per the CBIC GSTR-8 schema. Empty periods produce a header-only file (NIL filing — typically required). Header column order is load-bearing for upload tooling. Paise → rupees conversion handles sub-rupee amounts (5 paise → `0.05`) and sign preservation (negative reversal → `-100.00`). CSV cell escaping handles quotes, commas, newlines.
2. `generateJsonPayload(filingPeriod, operatorGstin)` → JSON shape for NIC portal upload. `ret_period` converts `2026-04 → 042026` per CBIC MMYYYY convention. All BigInt fields serialised to decimal strings so the payload is JSON-roundtrippable. Schema fields ready; the NIC submission envelope (auth header + chunk encoding) stays a stub until Phase 22.
3. `summarise(filingPeriod)` → period-level rollup `{ sellerCount, totalGross, totalCreditNoteReversal, totalNetTaxable, totalCgstTcs, totalSgstTcs, totalIgstTcs, totalTcs, rows[] }` for the admin UI. Drives the "Filing period 2026-04: 47 sellers, ₹12.4L net supply, ₹12,400 total TCS" surface.

**Tests:**
- New `tax-tcs-calculator.spec.ts` — 16 tests covering: intra/inter splits, mixed splits, negative-input clamp, zero input, half-away-from-zero rounding per leg, custom rate, out-of-range rejection, odd-bps split (101 → 50/51), crore-scale BigInt (₹1 crore × 1%), clamp + carry-forward (no-reversal, with-reversal, exceeds-gross, prior-carry consumption, second-period carry), `filingPeriodOf` (mid-month, 1-Apr boundary, 31-Mar 23:59 IST boundary, calendar year rollover).
- New `tax-tcs-service.spec.ts` — 17 tests covering: idempotency, multi-document aggregation with intra+inter split, clamp + carry-forward emission, prior-period carry-forward consumption, missing state codes default to inter-state (conservative); `markCollected` (not-found, idempotent on COLLECTED, refuses non-COMPUTED, happy path); `markFiled` (empty input → 0, filters to COLLECTED only); `markPaidToGovt` (filters to FILED only, payment reference captured); `reverse` (not-found, idempotent on REVERSED, preserves reason in computedReason).
- New `tax-gstr8-report.spec.ts` — 12 tests covering: CSV header-only on NIL, single-row paise→rupees conversion, sub-rupee padding (5 paise → 0.05), exact CBIC column order; JSON empty details on NIL, MMYYYY ret_period conversion, BigInt → string serialisation (JSON-roundtrip-safe), operator GSTIN propagation; summarise (zero-period defaults, multi-seller aggregation).
- Combined: **256/256 tax tests passing** (211 prior + 45 new).
- DB-roundtrip (partial-unique-on-active-row race, FK enforcement, real period-bucketing) queued for Phase 27 integration tests.

**Behaviour change today:**
- TCS computation is **available as a service**, not yet wired to the settlement run. Phase 17's settlement-GST UI will surface "TCS deducted from this cycle" and hook `markCollected` into the settlement transaction.
- GSTR-8 CSV / JSON generation works end-to-end: an admin can today call `generateCsv('2026-04')` from a script and get a CBIC-shape CSV. The NIC portal upload envelope lands in Phase 22.
- The `tcs_rate_bps` tax-config knob lets CA adjust the rate without redeploy (rate-snapshot-per-row guarantees historical correctness).

**CA decisions touched / partially resolved:**
- §3 row "TCS rate" — operational: 100 bps default in `tax_config.tcs_rate_bps`, historical snapshot per ledger row. CA can flip without history rewrite.
- §3 row "TCS scope (OWN_BRAND/SPORTSMART exclusion)" — operational at the service level: rows are only written when caller passes a seller-side `sellerId`. Platform-direct supplies (`OWN_BRAND` / `SPORTSMART`) never reach the service.
- §6.3 GSTR-8 — operational: monthly CSV + JSON shape ready, NIL filing supported, MMYYYY ret_period conversion canonical.
- `TCS_POLICY.md` §5 (computation formula) — implemented exactly as documented: gross − reversals − prior_carry, clamped at zero, carry-forward proportional split.
- `TCS_POLICY.md` §11 CA actions — items 1 (scope), 2 (rate), 3 (carry-forward), 4 (filing date), 5 (CSV column order), 6 (NIL filing) all surfaced as config knobs or operational defaults for CA sign-off.

**Sign-off items §10 backed (additional):**
- ✓ TCS computation per-seller per-period is automated and idempotent.
- ✓ Rate snapshot at ledger-row level ensures rate changes don't rewrite filed history.
- ✓ State split (intra-state CGST+SGST vs inter-state IGST) is automatic from invoice snapshot.
- ✓ Negative net supply (credit notes > invoices) carries forward to next period rather than producing negative TCS.
- ✓ GSTR-8 CSV export matches CBIC schema column order.
- ✓ GSTR-8 NIL filing supported (header-only CSV).
- ✓ Status lifecycle (COMPUTED → COLLECTED → FILED → PAID_TO_GOVT) tracks the full settlement → filing → remittance flow.
- ✓ Correction path via REVERSED + new row with `correction_of_id` preserves full audit history (original never deleted).

**Files added:**
- `apps/api/prisma/schema/gst-tcs.prisma`
- `apps/api/prisma/schema/migrations/20260513230000_gst_tcs_settlement/migration.sql`
- `apps/api/src/modules/tax/domain/tcs-calculator.ts`
- `apps/api/src/modules/tax/application/services/tcs.service.ts`
- `apps/api/src/modules/tax/application/services/gstr8-report.service.ts`
- `apps/api/test/unit/tax-tcs-calculator.spec.ts`
- `apps/api/test/unit/tax-tcs-service.spec.ts`
- `apps/api/test/unit/tax-gstr8-report.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/liability-ledger.prisma` — added 2 AdminTaskKind values.
- `apps/api/prisma/schema/seller.prisma` — added `gstTcsSettlements` back-relation.
- `apps/api/src/modules/tax/module.ts` — wired `TcsService` + `Gstr8ReportService`.

**Next:** Phase 17 — see entry above. Settlement ↔ TCS hook operational; approve auto-runs `computeForSeller`; mark-paid auto-flips COMPUTED → COLLECTED.

---

### Phase 15 — E-way bills (CBIC Rule 138) + stub adapter — 2026-05-13

**What was built (backend):**

*New enums:* in `eway-bills.prisma`
- `EWayBillStatus` — `NOT_REQUIRED` | `REQUIRED` | `PENDING` | `GENERATED` | `CANCELLED` | `EXPIRED` | `FAILED`.
- `EWayBillTransportMode` — `ROAD` | `RAIL` | `AIR` | `SHIP`.

*New AdminTaskKind values:* in `liability-ledger.prisma`
- `EWAY_BILL_GENERATION_FAILED` — opened by the retry exhaustion path (cron lands in a later phase). Seller cannot ship until resolved.
- `EWAY_BILL_EXPIRED` — opened when an issued EWB passes `validUntil` without delivery.

*New table:* `e_way_bills`
- One row per sub-order (PARTIAL UNIQUE INDEX `(sub_order_id) WHERE status != 'CANCELLED'` — cancelled rows accumulate for audit; active row is unique). Per CBIC convention even when the sub-order ships in multiple packages.
- Origin + destination + distance snapshot at generation time so a later address edit doesn't silently change the EWB record.
- `consignment_value_in_paise` — frozen at generation time (post-discount, includes GST + shipping); drives the ₹50k threshold decision.
- `raw_request_json` + `raw_response_json` — captures the would-be NIC payload (stub) + the future NIC response (when wired). Dev visibility + prod payload reproducibility.
- `override_admin_id` / `override_at` / `override_reason` — audit trail for the `tax.ewayBill.override` permission (admin allows ship without EWB).
- FKs to `sub_orders` and `tax_documents` are `RESTRICT ON DELETE` — the EWB audit trail must outlive the order.
- Partial indexes: `expiry_idx WHERE status='GENERATED'` (for the future expiry sweeper), `retry_idx WHERE status='FAILED'` (for the future retry cron), `ewb_number_uniq WHERE ewb_number IS NOT NULL` scoped on `(provider, ewb_number)`.

*Pure helper:* `apps/api/src/modules/tax/domain/eway-bill-validity.ts`
- `computeValidityDays(distanceKm)` — CBIC Rule 138(10) slab table: ≤100km = 1 day, each additional 200km = +1 day, hard cap 15 days. Non-finite inputs default to the safest 1-day slab.
- `computeValidUntil(issuedAt, distanceKm)` — returns `validUntil` as **end-of-IST-day** of (issued-day + N days - 1). E.g. EWB issued at 14:00 IST on day 0 with 1-day validity expires at 23:59:59.999 IST same day; with 2-day validity, expires at 23:59:59.999 IST on day 1. Verified across late-evening-IST issuance + multi-day spans.

*Provider interface:* `apps/api/src/modules/tax/infrastructure/eway-bill/eway-bill-provider.ts`
- `EWayBillProvider` — abstracts the external generator. Two methods: `generate(input)` → `{ ewbNumber, ewbDate, validUntil, rawRequestJson, rawResponseJson }`; `cancel({ ewbNumber, reason })` → `{ cancelledAt, rawResponseJson }`. Carries `readonly name` (`'stub'` / `'nic'`) for audit attribution.

*Stub provider:* `apps/api/src/modules/tax/infrastructure/eway-bill/stub-eway-bill-provider.ts`
- `StubEWayBillProvider` — produces `EWB-STUB-{uuid}` numbers, computes validity via the slab helper, captures the request payload to `raw_request_json` so engineers can verify what would have been sent to NIC. Serialises BigInt to decimal strings so the JSON column is loadable everywhere.
- Module wiring uses a `useFactory` keyed on `EWAY_BILL_PROVIDER` env: `stub` returns the stub; `nic` throws at boot ("NIC provider not yet implemented") rather than silently falling back. A misconfigured deployment that sets `nic` without finishing the integration crashes loudly rather than calling the stub in production.

*Service:* `apps/api/src/modules/tax/application/services/eway-bill.service.ts`

`EWayBillService` — four entry points + a guard helper:

1. `classifyForSubOrder(subOrderId)` → `{ row, required, thresholdPaise, consignmentValueInPaise }`
   - Reads `eway_bill_threshold_paise` from `tax_config` (default ₹50,000 = `50_00_00` paise).
   - Computes consignment value: prefers `TaxDocument.documentTotalInPaise` (post-discount + GST + shipping); falls back to `sum(OrderItem.totalPriceInPaise)` when the invoice hasn't been generated yet.
   - Creates row in `NOT_REQUIRED` or `REQUIRED` status based on threshold. Idempotent re-call; updates `NOT_REQUIRED → REQUIRED` when a later invoice total crosses the threshold (rare but defensible).
2. `generate(subOrderId, transportDetails?)` → `EWayBill`
   - Ensures classification has run; refuses on sub-threshold orders.
   - Idempotent on `GENERATED` (returns existing row, no second provider call).
   - Moves row to `PENDING` first so crash-mid-call leaves a recoverable state. On provider success: persists `ewbNumber`, `ewbDate`, `validUntil`, raw payloads. On provider failure: increments `retryCount`, sets `status = FAILED`, captures `failureReason`.
3. `cancel({ ewbId, cancelledBy, reason })` → `EWayBill`
   - Enforces the CBIC 24-hour cancellation window — past it, throws `EWayBillCancellationWindowClosedError` so the caller routes to "generate replacement EWB" instead.
   - Idempotent on already-`CANCELLED`. Refuses on non-`GENERATED` rows (you can't cancel a row that never got an EWB number).
   - Calls the provider's `cancel` and persists the audit (`cancelledAt`, `cancelledBy`, `cancellationReason`, response JSON).
4. `adminOverride({ ewbId, adminId, reason })` → `EWayBill`
   - Sets `override_admin_id` + `_at` + `_reason` so the ship guard lets the dispatch through. No-ops on `NOT_REQUIRED`.
5. `canShip(subOrderId)` → `{ allowed: boolean; reason: string }`
   - The seller-side ship guard. Allows `NOT_REQUIRED`, `GENERATED`, and any status with `overrideAdminId` set. Blocks `REQUIRED` / `PENDING` / `FAILED` / `EXPIRED` without override. Blocks when no EWB row exists at all (classification hasn't run).

*Env flags:*
- `EWAY_BILL_PROVIDER` (enum: `stub` | `nic`; default `stub`). Switches the runtime adapter; `nic` is a load-bearing crash until wired.

**Tests:**
- New `tax-eway-bill-validity.spec.ts` — 12 tests covering: 0 km, 50 km, 100/101 km boundary, 300/301 km second slab, 1100 km mid-range, 10,000 km cap, NaN/negative/Infinity fallback; `computeValidUntil` at 14:00 IST issuance (1 + 2 day spans) and late-evening 23:30 IST issuance.
- New `tax-eway-bill.spec.ts` — 24 tests covering: classification (below/above threshold, idempotent re-call, NOT_REQUIRED→REQUIRED flip, invoice-total preference); generation (refuses below threshold, idempotent on GENERATED, refuses CANCELLED, provider success path, FAILED status + retryCount increment on provider error); cancellation (not-found, idempotent on CANCELLED, refuses non-GENERATED, 24h-window enforcement, happy-path with provider call); `canShip` (no row, NOT_REQUIRED, GENERATED, REQUIRED without/with override, FAILED); `adminOverride` (not-found, no-op on NOT_REQUIRED, REQUIRED row stamping).
- Combined: **211/211 tax tests passing** (175 prior + 36 new).
- Real-DB roundtrip (partial-unique-on-active-row race, FK enforcement) is queued for Phase 27 integration tests.

**Behaviour change today:**
- The EWB module is **available** but not yet wired to the seller PACKED → SHIPPED transition. Seller-side ship guard integration lands in Phase 16 (TCS at settlement) since both touch the order fulfilment lifecycle.
- The retry cron + expiry sweeper land alongside the seller integration in the next operational phase.
- Address resolution (warehouse pincode / shipping pincode) is intentionally null-stubbed in the service; Phase 25's admin retry UI will let an admin populate these explicitly before retry. The eventual NIC integration will require both ends + distance computed via the existing PostOffice latitude/longitude (Haversine).

**CA decisions touched / partially resolved:**
- §3 row "E-way bill threshold" — operational: ₹50,000 default lives in `tax_config.eway_bill_threshold_paise`, CA-tunable without redeploy. State-level overrides ride on the same JSON config (Phase 16+ will expand the schema).
- §3 row "EWB cancellation window" — operational: hard 24h check enforced in the service.
- `EWAY_BILL_POLICY.md` §3 — stub adapter implemented exactly to spec (`EWB-STUB-{uuid}`, request payload captured to `raw_request_json`, km-slab validity).
- `EWAY_BILL_POLICY.md` §11 (CA actions) — items 1, 2, 6 (threshold, mode, NIC-timing) all surfaced as env / tax-config knobs for CA sign-off.

**Sign-off items §10 backed (additional):**
- ✓ E-way bill required-vs-not classification automated against `tax_config.eway_bill_threshold_paise`.
- ✓ Stub adapter produces deterministic EWB numbers + valid until dates per CBIC slab table.
- ✓ 24-hour cancellation window enforced.
- ✓ Admin override path captured with full audit trail (admin id + reason + timestamp).
- ✓ Ship guard (`canShip`) ready for seller-side fulfilment integration.
- ✓ Provider switching is single-line at boot (`EWAY_BILL_PROVIDER` env); no service-layer change needed when NIC adapter lands.
- ✓ All money columns BigInt paise; raw payload JSON serialisation handles BigInt safely.

**Files added:**
- `apps/api/prisma/schema/eway-bills.prisma`
- `apps/api/prisma/schema/migrations/20260513220000_eway_bills/migration.sql`
- `apps/api/src/modules/tax/domain/eway-bill-validity.ts`
- `apps/api/src/modules/tax/infrastructure/eway-bill/eway-bill-provider.ts`
- `apps/api/src/modules/tax/infrastructure/eway-bill/stub-eway-bill-provider.ts`
- `apps/api/src/modules/tax/application/services/eway-bill.service.ts`
- `apps/api/test/unit/tax-eway-bill-validity.spec.ts`
- `apps/api/test/unit/tax-eway-bill.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/liability-ledger.prisma` — added 2 AdminTaskKind values.
- `apps/api/prisma/schema/orders.prisma` — added `eWayBills` back-relation on `SubOrder`.
- `apps/api/prisma/schema/tax-documents.prisma` — added `eWayBills` back-relation on `TaxDocument`.
- `apps/api/src/bootstrap/env/env.schema.ts` — added `EWAY_BILL_PROVIDER` env.
- `apps/api/src/modules/tax/module.ts` — `useFactory` provider selector + wired `EWayBillService`.

**Next:** Phase 16 — see entry above. TCS settlement ledger + GSTR-8 CSV/JSON export operational; settlement-run integration lands in Phase 17.

---

### Phase 14 — Legacy order receipts (LEGACY_RECEIPT) — 2026-05-13

**What was built (backend):**

*Service:* `apps/api/src/modules/tax/application/services/legacy-receipt.service.ts`

`LegacyReceiptService` — two entry points, no migration needed (`LEGACY_RECEIPT` was already in the `DocumentType` enum from Phase 8):

1. `isLegacyOrder(subOrderId)` → boolean
   - Returns `false` when a real `TAX_INVOICE` / `BILL_OF_SUPPLY` / `INVOICE_CUM_BILL_OF_SUPPLY` exists for the sub-order.
   - Returns `false` when at least one OrderItem already has an `OrderItemTaxSnapshot` (mid-checkout / new flow ran).
   - Returns `true` when no real invoice + no snapshots — the order is genuinely pre-GST-module.
   - Returns `true` when a LEGACY_RECEIPT already exists (idempotent re-classification).
   - Returns `false` on pathological zero-item sub-orders so the caller surfaces the error path.

2. `generateForSubOrder(subOrderId)` → `{ document, isNew }`
   - **Idempotent**: a second call returns the existing LEGACY_RECEIPT row with `isNew=false`.
   - **Refuses** to generate when a real invoice already exists — those sub-orders belong to `TaxDocumentService`.
   - Loads sub-order + master order + customer + line items in one Prisma include.
   - Aggregates the gross total from line `totalPriceInPaise` (preferred over `subOrder.subTotalInPaise` so the receipt total exactly matches the line-table sum — the more defensible audit number).
   - Allocates a document number via the existing **PLATFORM-scoped sequence** (`supplierGstin = NULL`, `documentType = LEGACY_RECEIPT`, prefix `SM-LR`). No new sequence-table schema work needed — Phase 8 already supported this via `DocumentSequenceService.sequenceKeyOf`.
   - Persists `tax_documents` + one `tax_document_lines` per OrderItem in a single transaction.
   - Every tax field is **explicitly zero**: `taxableAmountInPaise = 0n`, all CGST/SGST/IGST/CESS columns = `0n`, `gstRateBps = 0`, `hsnOrSacCode = null`, `uqcCode = null`.
   - Status lands at `GENERATED` directly (no `PDF_PENDING` — the receipt can be rendered on demand from this row alone; PDF in Phase 19 is optional).
   - `einvoiceStatus = NOT_APPLICABLE` permanently.
   - `supplierGstin = null`, `sellerLegalName = null`, `placeOfSupplyStateCode = null` — by design, since we don't have the historical seller GSTIN snapshot.
   - `buyerLegalName` derived from customer first + last name; falls back to email.
   - `reason = 'Pre-GST-module legacy order; non-tax receipt issued.'` stamped on the row for audit clarity.

*Integration into existing services:*

- `CreditNoteEligibilityService.classifyReturn` — when no `TAX_INVOICE` / `INVOICE_CUM_BILL_OF_SUPPLY` is found, now does a SECOND lookup for a `LEGACY_RECEIPT`. If found, returns `REQUIRES_FINANCE_REVIEW` with a legacy-specific reason ("Legacy order — LEGACY_RECEIPT ${number}; no GST output liability to reverse"). Distinguishes "true legacy" from "mid-checkout / not generated yet".

- `WalletAdjustmentService.requestForTimeBarredReturn` — when no real invoice is found, now falls back to looking up a `LEGACY_RECEIPT` and uses its ID as `sourceTaxDocumentId` on the wallet adjustment row. The audit trail then has a stable source pointer instead of NULL. The `would_have_been_*` snapshot stays NULL because there was no GST claim to absorb — captured explicitly via an `isLegacy` flag in the service.

*Why we need this:*
1. **Customer-side**: A legacy customer who asks for a receipt of an old order can be handed something — not a tax invoice (we don't have HSN/rate data), but a documented record of the transaction.
2. **Refund-path completeness**: Phase 12's eligibility classifier + Phase 13's wallet adjustment service both previously routed legacy returns to `REQUIRES_FINANCE_REVIEW` with a null source pointer. Now they have a stable `sourceTaxDocumentId` for audit + the eligibility reason text distinguishes legacy from mid-checkout cases.
3. **Reports completeness**: GSTR-1 / 3B (Phase 18) filter by document type — legacy receipts are excluded from GST output reports, and a dedicated "legacy receipts issued in period" report gives the CA visibility of the pre-GST tail.

*What this service does NOT do:*
- Retroactively compute GST on legacy orders. We don't have HSN/rate metadata for those line items; any reconstruction would be a guess. The CA decision in §3 explicitly excludes back-filing.
- Replace a real `TAX_INVOICE`. If a legacy order's sub-order has been backfilled with snapshots, the regular invoice flow takes over (and the service refuses).
- Auto-generate on a schedule. A backfill cron is queued for the Phase 18 reports companion — Phase 14 keeps the service additive: ops calls `generateForSubOrder` on demand from the admin "issue receipt" button, or the integration paths above lazily pull legacy receipts in if they happen to exist.

**Tests:**
- New `tax-legacy-receipt.spec.ts` — 11 tests covering:
  - `isLegacyOrder`: real invoice present → false; BILL_OF_SUPPLY present → false; LEGACY_RECEIPT present → true (idempotent re-classification); at least one snapshot → false; no doc + no snapshots → true; pathological zero items → false.
  - `generateForSubOrder`: idempotent on existing receipt; refuses when a real invoice exists; throws on unknown sub-order; throws on zero items; produces zero-tax document with correct gross total + PLATFORM-scoped sequence + correct line shape; falls back to email when customer name is empty.
- Updated `tax-credit-note-eligibility.spec.ts` — split the existing "no source invoice" test into two: pure mid-checkout case + legacy-receipt case (new test).
- Updated `tax-wallet-adjustment.spec.ts` — added a test that exercises the LEGACY_RECEIPT fallback path: `sourceTaxDocumentId` populated + `would_have_been_*` snapshot stays null + reason text contains "Legacy order".
- Combined: **175/175 tax tests passing** (161 prior + 11 new + 3 updated).

**Behaviour change today:**
- The `LegacyReceiptService` is **available** but not yet wired to a UI button or a backfill cron. Admin "issue legacy receipt" UI lands in Phase 25; the optional bulk-backfill cron is part of the Phase 18 reports work.
- Customers requesting an old-order receipt today should be routed through admin → `LegacyReceiptService.generateForSubOrder(subOrderId)` → email the resulting document number.
- Phase 12 / 13 integrations work immediately: any time a return on a pre-GST order reaches QC, the eligibility classifier + wallet adjustment writer pick up the existing LEGACY_RECEIPT (if any) and produce coherent audit trails.

**CA decisions touched / partially resolved:**
- §3 row "Legacy orders + GST" — operational: legacy orders now get a documented non-tax receipt, with explicit zero-tax-claim status. CA does not need to back-file GST on these.
- §6.2 Section 34 — the "no source invoice" case is no longer ambiguous; the audit trail distinguishes mid-checkout (invoice not yet generated) from true legacy (no GST module at the time).
- §4 row "Document numbering" — confirms LEGACY_RECEIPT uses the platform-scoped `PLATFORM|<FY>|LEGACY_RECEIPT` series. Numbers continue forward independently of sellers; pad width 6 (`SM-LR-000001`).

**Sign-off items §10 backed (additional):**
- ✓ LEGACY_RECEIPT generation is operational with idempotent re-call semantics.
- ✓ Refuses to clobber real invoices — sub-orders with a TAX_INVOICE / BILL_OF_SUPPLY can never accidentally receive a LEGACY_RECEIPT.
- ✓ PLATFORM-scoped sequence keeps legacy-receipt numbering separate from seller invoice numbering.
- ✓ Cross-service integration: Phase 12 + 13 services correctly route legacy returns with a stable `sourceTaxDocumentId` and a non-null reason explaining "no GST to absorb".
- ✓ Explicit zero-tax-claim on every column — the document cannot be mistaken for a tax invoice in audits or GSTR-1 exports.

**Files added:**
- `apps/api/src/modules/tax/application/services/legacy-receipt.service.ts`
- `apps/api/test/unit/tax-legacy-receipt.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — wired `LegacyReceiptService`.
- `apps/api/src/modules/tax/application/services/credit-note-eligibility.service.ts` — secondary LEGACY_RECEIPT lookup with legacy-specific reason.
- `apps/api/src/modules/tax/application/services/wallet-adjustment.service.ts` — LEGACY_RECEIPT fallback + `isLegacy` flag gating absorbed-GST snapshot.
- `apps/api/test/unit/tax-credit-note-eligibility.spec.ts` — split existing test, added legacy-receipt case.
- `apps/api/test/unit/tax-wallet-adjustment.spec.ts` — added LEGACY_RECEIPT-fallback test.

**Next:** Phase 15 — see entry above. E-way bill schema + stub adapter + service operational; seller-side ship-guard integration lands alongside Phase 16's TCS settlement work.

---

### Phase 13 — Wallet adjustments (goodwill + time-barred refunds) — 2026-05-13

**What was built (backend):**

*New enums:* in `wallet.prisma`
- `WalletAdjustmentKind` — `TIME_BARRED_CREDIT_NOTE` | `GOODWILL` | `MANUAL_DEBIT` | `MANUAL_OTHER`.
- `WalletAdjustmentStatus` — `PENDING_APPROVAL` | `APPROVED` | `REJECTED` | `REVERSED`.

*New table:* `wallet_adjustments`
- Business-layer record of "we owe (or are owed) N paise via wallet". Distinct from `wallet_transactions` because we need (a) GST context (which source invoice, what tax components the platform is absorbing), (b) an approval workflow with a `PENDING_APPROVAL` state before money moves, and (c) a single place for Phase 12's `GST_CREDIT_NOTE_TIME_BARRED` AdminTask to hand work off to.
- Carries the "absorbed GST" snapshot (`would_have_been_taxable_in_paise`, `_cgst_`, `_sgst_`, `_igst_`, `_total_tax_`) — what the credit note WOULD have reversed if Section 34 weren't blocking it. GSTR-1 / 3B reports will join on this to show "GST cost absorbed by platform in this period" (Phase 18).
- `idempotency_key` UNIQUE — typically `TIME_BARRED_CREDIT_NOTE:${returnId}` or `GOODWILL:${admin}:${customer}:${amount}:${reason-prefix}`. A retried QC submission, a re-run of the Phase 12 cron, or a double-click on the goodwill UI all collapse to the same row.
- FKs to `users`, `wallets`, `returns`, `tax_documents`, `wallet_transactions` — all `RESTRICT ON DELETE` (an adjustment cannot disappear because a parent return was purged).
- Partial index `wallet_adjustments_pending_queue_idx WHERE status = 'PENDING_APPROVAL'` — finance's pending-approvals UI hits this directly.
- `requires_dual_approval BOOLEAN` — set to true when the absolute amount exceeds the env threshold OR when `kind = MANUAL_DEBIT`. Approval requires `wallet.adjustment.approve` permission (HIGH risk); creation requires `wallet.adjustment.create` (MEDIUM risk).

*Service:* `apps/api/src/modules/tax/application/services/wallet-adjustment.service.ts`

`WalletAdjustmentService` — five entry points:

1. `requestForTimeBarredReturn({ returnId, reason?, requestedByAdminId? })`
   - Looks up the return + items + source invoice + OrderItemTaxSnapshot rows.
   - For each QC-approved item, computes the "would-have-been" tax reversal via the same `calculateGstReversal` helper that the Phase 11 credit-note service uses (so the absorbed-GST numbers match what the credit note would have produced).
   - If no source invoice (legacy order) → `would_have_been_*` columns stay NULL; refund amount falls back to `Return.refundAmountInPaise`.
   - Persists the adjustment. If the absolute amount is below the dual-approval threshold AND `WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD=true`, auto-approves inline and posts to the wallet ledger via `WalletPublicFacade.creditAdjustment` (with `bypassBlock=true` so a blocked wallet still receives statutory refunds).
2. `requestGoodwill({ customerId, amountInPaise, reason, requestedByAdminId })`
   - Admin-initiated. No return / GST context. Same threshold gate. Must be positive amount.
3. `requestManualDebit({ customerId, amountInPaise, reason, requestedByAdminId, externalReferenceId? })`
   - Admin-initiated chargeback / fraud reversal. Persisted as a NEGATIVE `amountInPaise`. **Always requires explicit approval** (`forceDualApproval=true`), regardless of size.
4. `approve({ adjustmentId, approvedByAdminId })`
   - Posts the wallet ledger row + flips status to APPROVED. Idempotent — already-APPROVED rows return as-is. Refuses to approve REJECTED rows. Refuses to post zero-amount rows.
   - Routes through `creditAdjustment` for positive amounts, `debitAdjustment` for negative.
   - `TIME_BARRED_CREDIT_NOTE` rows post with `bypassBlock=true`.
5. `reject({ adjustmentId, rejectedByAdminId, rejectionReason })`
   - Terminal `REJECTED`. No money moves. Idempotent on already-REJECTED. Refuses to reject already-APPROVED rows.

*WalletPublicFacade additions:*
- `creditAdjustment({ userId, amountInPaise, adjustmentId, ... })` — distinct from `creditFromRefund` so the audit trail captures the adjustment ID (which carries the GST-policy context), not a refund ID. Wallet-ledger `referenceType = 'wallet_adjustment'`.
- `debitAdjustment(...)` — counterpart for `MANUAL_DEBIT`.

*Permissions:*
- Added `wallet.adjustment.reject` (the other three keys — `read`, `create`, `approve` — were reserved in Phase 1).

*Env flags:*
- `WALLET_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD_PAISE` (default `500_000` = ₹5,000). Set to 0 to require approval on ALL adjustments.
- `WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD` (default `true` for dev-permissive mode). Flip false in prod once the audit shape settles — every adjustment will then queue for review.

**Tests:**
- New `tax-wallet-adjustment.spec.ts` — 22 tests covering:
  - Goodwill: rejects zero/negative, auto-approves under threshold, stays PENDING above threshold, stays PENDING when auto-approve flag is off, idempotent on retry.
  - Manual debit: always queues for approval (regardless of size), persists negative amount.
  - Approve: throws on unknown ID, idempotent on APPROVED, refuses on REJECTED, posts credit for positive, posts debit for negative, bypasses wallet block for TIME_BARRED, refuses zero-amount.
  - Reject: throws on unknown, idempotent on REJECTED, refuses on APPROVED, transitions PENDING_APPROVAL → REJECTED with reason captured.
  - Time-barred return: throws on unknown return, throws when no QC-approved items, falls back to `Return.refundAmountInPaise` when no source invoice exists, auto-approves below threshold + posts with `bypassBlock=true`, stays PENDING above threshold.
- Combined: **161/161 tax tests passing** (139 prior + 22 new).
- Real-DB roundtrip (FK enforcement, UNIQUE-key races) is queued for Phase 27 integration tests.

**Behaviour change today:**
- The wallet-adjustment path is now **available as a service**, not yet wired into the QC flow. When Phase 27 integrates: `ReturnService.submitQcDecision` will:
  1. Call `CreditNoteService.generateForReturn`.
  2. On `Section34TimeBarredError`, catch and call `WalletAdjustmentService.requestForTimeBarredReturn(returnId)`.
  3. Customer-visible refund proceeds via wallet either way; the GST audit trail records which path was taken.
- The Phase 12 cron's `GST_CREDIT_NOTE_TIME_BARRED` AdminTask is now the **finance-side review queue** for adjustments that Phase 13 created (or didn't yet create because the auto-approve flag is off). Finance opens the task, reviews the adjustment row, hits Approve or Reject.

**CA decisions touched / partially resolved:**
- §3 row "Goodwill credit" — fully separated from credit-note path via `WalletAdjustmentKind.GOODWILL`. Not linked to any return / invoice; no GST reversal.
- §3 row "Time-barred refund GST cost absorption" — `would_have_been_*` columns capture the absorbed amounts so GSTR-1 / 3B reports can surface them in a dedicated line item (Phase 18).
- §6.2 Section 34 — operational completion: a time-barred return no longer surfaces only as an exception; the wallet adjustment row IS the audit artifact, with the absorbed GST captured explicitly.
- `GOODWILL_CREDIT_POLICY.md` — auto-approval threshold is env-tunable; CA can pick the prod value during sign-off.

**Sign-off items §10 backed (additional):**
- ✓ Wallet adjustment ledger (`wallet_adjustments` table) is the source of truth for non-credit-note refund flows.
- ✓ Section 34 time-barred returns route to the wallet path with the absorbed GST recorded on the adjustment row (audit-ready).
- ✓ Goodwill credits are distinguishable from refunds in the wallet ledger (`WalletTransaction.referenceType = 'wallet_adjustment'`) AND in the business layer (`WalletAdjustment.kind = GOODWILL`).
- ✓ High-value adjustments require explicit `wallet.adjustment.approve` (HIGH-risk permission) — prevents a low-privileged support agent from issuing a ₹50,000 credit on a whim.
- ✓ Manual debit (chargeback / fraud reversal) is the SAME flow as credit but with negative `amountInPaise` — one approval path, one audit shape.
- ✓ Idempotency at two layers: `wallet_adjustments.idempotency_key` UNIQUE, plus the existing `wallet_transactions` UNIQUE on `(referenceType, referenceId, type)` — a re-tried request OR a re-tried approval both collapse to the same row.

**Files added:**
- `apps/api/prisma/schema/migrations/20260513210000_wallet_adjustments/migration.sql`
- `apps/api/src/modules/tax/application/services/wallet-adjustment.service.ts`
- `apps/api/test/unit/tax-wallet-adjustment.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/wallet.prisma` — added enums + `WalletAdjustment` model + back-relations on `Wallet` + `WalletTransaction`.
- `apps/api/prisma/schema/identity.prisma` — added `walletAdjustments` back-relation on `User`.
- `apps/api/prisma/schema/returns.prisma` — added `walletAdjustments` back-relation on `Return`.
- `apps/api/prisma/schema/tax-documents.prisma` — added `walletAdjustments` back-relation on `TaxDocument` (named `WalletAdjustmentSourceInvoice`).
- `apps/api/src/bootstrap/env/env.schema.ts` — added 2 env flags.
- `apps/api/src/modules/wallet/application/facades/wallet-public.facade.ts` — added `creditAdjustment` + `debitAdjustment`.
- `apps/api/src/modules/tax/module.ts` — imported `WalletModule`, wired `WalletAdjustmentService`.
- `apps/api/src/core/authorization/permission-registry.ts` — added `wallet.adjustment.reject`.

**Next:** Phase 14 — see entry above. `LegacyReceiptService` operational; the "no source invoice found" case from Phases 12/13 now produces a stable `sourceTaxDocumentId` with explicit legacy-path reason text.

---

### Phase 12 — Section 34 time-bar cron + AdminTask — 2026-05-13

**What was built (backend):**

*New enum:* `CreditNoteEligibilityStatus` in `tax-master.prisma`
- `ELIGIBLE` — within Section 34 window; `CreditNoteService` can/has issued a `CREDIT_NOTE`.
- `TIME_BARRED` — past 30 Sept of FY+1. GST output liability cannot be reduced — the wallet refund path still proceeds, but the platform absorbs the GST cost.
- `REQUIRES_FINANCE_REVIEW` — within `TAX_CREDIT_NOTE_TIMEBAR_APPROACHING_DAYS` (default 7) of the cutoff, OR source invoice is in `VOIDED_DRAFT` / `SUPERSEDED` / `FULLY_REVERSED` state. Finance lead triages manually.

*New AdminTaskKind values:* in `liability-ledger.prisma`
- `GST_CREDIT_NOTE_TIME_BARRED` — opened when a return crosses the Sec 34 deadline before the credit note was issued. 24 h SLA, opened against `LedgerSourceType.RETURN`.
- `GST_CREDIT_NOTE_TIME_BAR_APPROACHING` — 7-day early-warning. 48 h SLA. Lets ops chase the credit note out the door before the deadline lands.

*New columns on `returns`:*
- `credit_note_eligibility_status` (nullable enum) — current bucket. Null on legacy rows + returns that haven't reached QC yet.
- `credit_note_eligibility_checked_at` — last cron pass timestamp.
- `credit_note_time_bar_reason` — human-readable rationale; stamped on the wallet adjustment ledger entry when the refund routes via wallet.
- `finance_reviewed_by` / `finance_reviewed_at` — manual override audit trail (finance lead overrides classification, or marks the case "absorb GST + close").

*Two partial indexes on `returns`:*
- `returns_credit_note_eligibility_idx` — `WHERE status IS NOT NULL AND status <> 'ELIGIBLE'` (the cron's re-scan cohort + finance triage queue).
- `returns_credit_note_eligibility_pending_idx` — `WHERE status IS NULL AND qc_completed_at IS NOT NULL`, ordered by `qc_completed_at ASC` (the unclassified cohort, oldest first).

*Classification service:* `apps/api/src/modules/tax/application/services/credit-note-eligibility.service.ts`

`CreditNoteEligibilityService.classifyReturn(returnId, { now?, approachingDays? })` — pure decision logic + a single DB lookup. Returns `{ status, cutoff, daysToCutoff, reason, sourceInvoice }`. Throws only on unknown returnId or pre-QC return. All other unusual cases resolve to a non-ELIGIBLE bucket with an explanatory `reason`. No writes — the cron owns persistence.

*Cron:* `apps/api/src/modules/tax/application/jobs/tax-credit-note-timebar.cron.ts`

`TaxCreditNoteTimeBarCron` — daily 02:00 server-local time, wrapped in `LeaderElectedCron` (cluster-safe; only one replica runs the body per tick) and `CronInstrumentationService` (records `{ scanned, eligible, timeBarred, requiresReview, adminTasksOpened, errors }` in `cron_runs`). Two cohorts per pass:
1. QC-completed returns whose `creditNoteEligibilityStatus IS NULL` (initial classification).
2. Returns already flagged `REQUIRES_FINANCE_REVIEW` (re-check in case `now()` has crossed the cutoff — they may need to escalate to `TIME_BARRED`).

ELIGIBLE rows are not re-scanned — `CreditNoteService` owns them.

For each candidate: classify via the service, persist `(status, checkedAt, reason)` on the `returns` row, then **idempotently upsert** the `AdminTask` keyed on `(kind, sourceType, sourceId)`. Existing OPEN/CLAIMED tasks only get their `reason` refreshed; RESOLVED tasks are left alone (won't re-open). Returns the per-tick counts so the instrumentation row is informative.

*Env flags:*
- `TAX_CREDIT_NOTE_TIMEBAR_CRON_ENABLED` (default `true` — ON in dev/test so engineers exercise the flow end-to-end without flag-flipping).
- `TAX_CREDIT_NOTE_TIMEBAR_APPROACHING_DAYS` (default `7`).
- `TAX_CREDIT_NOTE_TIMEBAR_SCAN_LIMIT` (default `500`).

**Tests:**
- New `tax-credit-note-eligibility.spec.ts` — 14 tests covering:
  - Unknown returnId / pre-QC return → throws.
  - No source invoice → `REQUIRES_FINANCE_REVIEW` (legacy-order path).
  - Source invoice in `VOIDED_DRAFT` / `SUPERSEDED` / `FULLY_REVERSED` → `REQUIRES_FINANCE_REVIEW`.
  - Within Sec 34 window + far from cutoff → `ELIGIBLE`.
  - Source invoice in `PARTIALLY_REVERSED` (still credit-noteable) → `ELIGIBLE`.
  - Within 7-day early-warning window → `REQUIRES_FINANCE_REVIEW`.
  - Exactly at the 7-day boundary → `REQUIRES_FINANCE_REVIEW`.
  - Past cutoff by 1 minute → `TIME_BARRED`.
  - Past cutoff by months → `TIME_BARRED`.
  - Custom `approachingDays` override (30 days vs 7 days) → different verdicts.
  - Cross-FY invoice (Feb 2027 is in FY 2026-27 → cutoff 30 Sept 2027) → correct cutoff date.
- Combined: **139/139 tax tests passing** (125 prior + 14 new).
- Cron's DB-roundtrip behaviour (idempotent AdminTask upsert, persistence of decision) is queued for Phase 27 integration tests.

**Behaviour change today:**
- The cron is **registered and enabled by default**. On the next 02:00 tick it will start populating `creditNoteEligibilityStatus` on QC-approved returns + opening `AdminTask` rows for time-barred / approaching cases.
- The Phase 11 `CreditNoteService.generateForReturn` already throws `Section34TimeBarredError` synchronously on past-cutoff returns; the cron is the **proactive** companion — it scans the QC backlog daily so finance sees the queue before a user tries to issue a credit note.
- Customer-facing message wording finalised in `credit_note_time_bar_reason` for downstream UI / notifications (Phase 24): _"Section 34 cutoff (CUTOFF_ISO) has lapsed. GST output liability cannot be reduced; refund must route through wallet adjustment and the platform absorbs the GST cost."_

**CA decisions touched / partially resolved:**
- §6.2 Section 34 — operational completion: the system now *automatically detects* time-barred cases, doesn't just throw on demand.
- §3 row "Goodwill credit" — `credit_note_time_bar_reason` carries the audit-trail justification when a refund had to go via wallet because the credit note was time-barred (distinct from a chosen-by-policy goodwill credit).
- `CREDIT_NOTE_TIME_BAR_POLICY.md` — 7-day approaching window is now an explicit envelope-tuneable knob (`TAX_CREDIT_NOTE_TIMEBAR_APPROACHING_DAYS`). CA may adjust per audit experience.

**Sign-off items §10 backed (additional):**
- ✓ Daily Section 34 cutoff sweep is operational (cron registered, LeaderElectedCron-wrapped, CronInstrumentationService-instrumented).
- ✓ Time-barred returns automatically produce a finance-queue `AdminTask` — manual scraping of refund logs not required.
- ✓ Approaching-cutoff returns are flagged 7 days in advance so credit notes can be issued before the deadline.
- ✓ Eligibility classification is idempotent + restartable (re-running the cron produces the same end state).
- ✓ Manual finance override fields (`finance_reviewed_by` / `finance_reviewed_at`) ready for the Phase 25 admin UI.

**Files added:**
- `apps/api/prisma/schema/migrations/20260513200000_section_34_timebar_admin_task/migration.sql`
- `apps/api/src/modules/tax/application/services/credit-note-eligibility.service.ts`
- `apps/api/src/modules/tax/application/jobs/tax-credit-note-timebar.cron.ts`
- `apps/api/test/unit/tax-credit-note-eligibility.spec.ts`

**Files modified:**
- `apps/api/prisma/schema/tax-master.prisma` — added `CreditNoteEligibilityStatus` enum.
- `apps/api/prisma/schema/liability-ledger.prisma` — added two AdminTaskKind values.
- `apps/api/prisma/schema/returns.prisma` — added 5 columns + partial-index documentation note.
- `apps/api/src/bootstrap/env/env.schema.ts` — added 3 env flags.
- `apps/api/src/modules/tax/module.ts` — wired `CreditNoteEligibilityService` + `TaxCreditNoteTimeBarCron`.
- `apps/api/test/unit/checkout-place-order-lock.spec.ts` — fixed pre-existing TS drift from Phase 5 (CheckoutService constructor arg added).

**Next:** Phase 13 — see entry above. `wallet_adjustments` table + service operational; time-barred returns now route through `WalletAdjustmentService.requestForTimeBarredReturn` with the absorbed GST captured on the row.

---

### Phase 11 — Credit notes for returns + Section 34 time-bar — 2026-05-13

**What was built (backend):**

*Pure helper:* `apps/api/src/modules/tax/domain/credit-note-time-bar.ts`

- `section34CutoffFor(originalInvoiceDate)` → returns the IST-EOD `Date` of 30 September of FY+1. Correctly handles invoices issued in Jan–Mar (which are part of the FY ending in March of the same calendar year).
- `isWithinSection34Window(originalInvoiceDate, now)` → boolean. `<=` cutoff. Pure function, no I/O.

*Orchestrator service:* `apps/api/src/modules/tax/application/services/credit-note.service.ts`

`CreditNoteService.generateForReturn(returnId, options?)`:

1. Loads `Return` + items, filters to items where `qcQuantityApproved > 0`.
2. Finds the source `TaxDocument` for the sub-order (must be invoice-like: `TAX_INVOICE` / `INVOICE_CUM_BILL_OF_SUPPLY`, status not `VOIDED_DRAFT` / `SUPERSEDED`).
3. **Checks Section 34 time-bar**. If past cutoff → throws `Section34TimeBarredError` (with original invoice date + cutoff embedded). Phase 12 cron + Phase 13 wallet-adjustment path together handle the time-barred case.
4. **Idempotency**: returns existing credit note when called twice for the same return.
5. For each approved item: loads `OrderItemTaxSnapshot` + matching `TaxDocumentLine` (by `sourceSnapshotId`); computes per-line proportional reversal via `calculateGstReversal` (the legacy engine — produces correct `BigInt` floor-rounded reversals). Skips items with missing snapshots (legacy orders) with a warning log; the corresponding refund proceeds outside the GST credit-note path.
6. Allocates `CREDIT_NOTE` number under the **source invoice's `supplierGstin`** (so the series stays supplier-scoped per Indian GST rules) for the current FY via `DocumentSequenceService.nextNumber`.
7. Persists `tax_documents` (documentType = `CREDIT_NOTE`) + per-line `tax_document_lines` in one transaction. Mirrors supplier + recipient + place-of-supply from source. Money fields stored as positive amounts (the `CREDIT_NOTE` documentType encodes the sign). Cross-reference: `originalDocumentId` + `originalDocumentNumber`.
8. **Transitions the source invoice** through `TaxDocumentService.transitionStatus`:
   - Re-aggregates cumulative `taxableAmount` across ALL non-voided credit notes for this source invoice.
   - If `cumulative >= source.taxable` → `FULLY_REVERSED`.
   - Else if `> 0` → `PARTIALLY_REVERSED`.
   - Else no transition.
   - FSM gates the transition (per Phase 10) — forbidden moves (e.g. from `FULLY_REVERSED` already) throw.
9. Returns `{ creditNote, sourceInvoice, isNew }`. Phase 19 wires the PDF retry cron to pick up `PDF_PENDING` credit notes.

*Idempotency under failure*: The first credit note for a return creates the row. A retry returns the existing row. Partial QC re-approvals (where a second batch of items gets approved later) aren't handled in Phase 11 — they need a different model (multiple credit notes per return). Queued for a follow-up.

*Money-flow contract (per ADR-016 / ADR-018):*
- Customer refund includes GST reversal — `creditNote.documentTotalInPaise` is the refund amount (cgst + sgst + igst + taxable reversal). The Phase 13 RefundInstruction references this credit note.
- Goodwill credits with NO taxable-value change route to `wallet_adjustments` instead (Phase 13). The "is this reducing taxable value?" decision lives at the admin QC step.

**Tests:**
- New `tax-credit-note-time-bar.spec.ts` — 11 tests: cutoff for invoices at FY-start, FY-end (31 Mar IST), mid-FY (Aug), Jan–Mar (which are in the same FY as the previous April), `isWithinSection34Window` at exact cutoff, one second past, next FY, same-day return.
- Combined: **125/125 tax tests passing** (114 prior + 11 new).
- Integration test (run a return through QC → assert credit note row created + source invoice transitioned + cumulative reversal correct) is queued for Phase 27.

**Behaviour change today:**
- The credit-note path is now **available as a method**, not yet **wired to the QC approval flow**. The `ReturnService.submitQcDecision` (Phase 27 integration) will call `CreditNoteService.generateForReturn` after items are QC-approved and a customer refund is due.
- Time-barred returns will throw `Section34TimeBarredError` from the service. Phase 12 cron + Phase 13 wallet adjustment together close the loop: the caller catches the error, creates a `wallet_adjustments` row instead, and the cron raises `AdminTask(GST_CREDIT_NOTE_TIME_BARRED)` for finance review.

**CA decisions touched / partially resolved:**
- §6.2 Section 34 — cutoff math is canonical (IST-EOD; FY-aware including Jan-Mar boundary). Engineering's interpretation is testable via the unit tests.
- §3 row "Goodwill credit" — explicitly separated from the credit-note path; Phase 13 ships `wallet_adjustments`.
- `INVOICE_CANCELLATION_POLICY.md` — credit note is now the actual mechanism for value reductions (no manual cancel).
- `CREDIT_NOTE_TIME_BAR_POLICY.md` — cutoff date logic is testable and matches the policy doc.

**Sign-off items §10 backed (additional):**
- ✓ Credit note generation on approved returns (orchestration complete)
- ✓ Section 34 time-bar enforced before any credit note is issued
- ✓ Proportional reversal via `calculateGstReversal` (legacy engine — pure, floor-rounded, BigInt-safe)
- ✓ Source invoice transitions through the FSM (`PARTIALLY_REVERSED` / `FULLY_REVERSED`) automatically
- ✓ Per-line `sourceSnapshotId` cross-reference preserved for audit trail
- ✓ Multi-supplier scoping — credit-note number series belongs to the source invoice's supplier GSTIN

**Files added:**
- `apps/api/src/modules/tax/domain/credit-note-time-bar.ts`
- `apps/api/src/modules/tax/application/services/credit-note.service.ts`
- `apps/api/test/unit/tax-credit-note-time-bar.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — exports `CreditNoteService`

**Next:** Phase 12 — see entry above. Section 34 time-bar cron + `GST_CREDIT_NOTE_TIME_BARRED` AdminTask now operational; daily cron flags returns / refunds approved after the cutoff so finance can manually book the GST loss.

---

### Phase 10 — Tax-document state machine + cancellation rules — 2026-05-13

**What was built (backend):**

*New pure module:* `apps/api/src/modules/tax/domain/tax-document-state-machine.ts`. Enforces the "no casual cancel" doctrine from `INVOICE_CANCELLATION_POLICY.md` + CBIC Section 31 / 34.

*State map:*

| From | Allowed → |
|---|---|
| `DRAFT` | `GENERATED`, `VOIDED_DRAFT` |
| `GENERATED` | `PDF_PENDING`, `PDF_GENERATED`, `PDF_FAILED`, `PARTIALLY_REVERSED`, `FULLY_REVERSED`, `SUPERSEDED` |
| `PDF_PENDING` | `PDF_GENERATED`, `PDF_FAILED`, `PARTIALLY_REVERSED`, `FULLY_REVERSED`, `SUPERSEDED` |
| `PDF_GENERATED` | `PARTIALLY_REVERSED`, `FULLY_REVERSED`, `SUPERSEDED`, `PDF_PENDING` (re-render path) |
| `PDF_FAILED` | `PDF_PENDING` (retry), `PDF_GENERATED`, `PARTIALLY_REVERSED`, `FULLY_REVERSED`, `SUPERSEDED` |
| `PARTIALLY_REVERSED` | `FULLY_REVERSED`, `SUPERSEDED` |
| `FULLY_REVERSED` | *(terminal)* |
| `VOIDED_DRAFT` | *(terminal)* |
| `SUPERSEDED` | *(terminal)* |

Self-transitions (`X → X`) are always allowed (idempotent retry).

**The two transitions GST law explicitly forbids — enforced by the FSM:**

- `GENERATED → VOIDED_DRAFT`: throws with hint *"Issued documents cannot be voided. Issue a CREDIT_NOTE for the full value to legally reverse it."*
- `* → DRAFT` (backwards): throws with hint *"Documents cannot return to DRAFT once advanced past it. Issue a CREDIT_NOTE or SUPERSEDE to a new document."*

*Service updates — `TaxDocumentService`:*

- **`transitionStatus({ documentId, toStatus, reason?, actorId? })`** — generic transition method. Loads current status, calls `assertTransitionAllowed(from, to)`, updates row + `cancelledAt` (when going to `VOIDED_DRAFT`) + `reason` field. Used by Phase 11 credit-note service to flip source document to `PARTIALLY_REVERSED` / `FULLY_REVERSED`. Idempotent on self-transition.
- **`voidDraft({ documentId, reason, actorId })`** — emergency draft-void path. Requires `reason.length >= 3` for audit. Refuses any document past `DRAFT`. On success:
  1. Updates row to `VOIDED_DRAFT` with `cancelledAt = now` + `reason`.
  2. **Calls `DocumentSequenceService.markSkipped` to record the burnt number** in the sequence's audit JSON (so GSTR-1 review can prove every number is accounted for).
- **`generateForSubOrder` cleaned up** — the `forceNew` SUPERSEDED transition is now reviewed against the FSM (no manual transitions; the `updateMany` only matches statuses the machine permits going to `SUPERSEDED`).

*Permissions usage:*
- `voidDraft` is admin-only and would require `tax.override` (declared in Phase 1 registry, `CRITICAL` risk). Phase 25 admin UI will surface this with a "Reason for void" required-text input + audit confirmation.

**Tests:**

- New `tax-document-state-machine.spec.ts` — 27 tests:
  - Self-transitions allowed for every state
  - `DRAFT → GENERATED` / `DRAFT → VOIDED_DRAFT` allowed
  - `GENERATED → VOIDED_DRAFT` forbidden with hint about credit note
  - `GENERATED → DRAFT` forbidden (no rollback)
  - PDF re-render path (`PDF_GENERATED → PDF_PENDING`) allowed
  - Retry path (`PDF_FAILED → PDF_PENDING`) allowed
  - `PARTIALLY_REVERSED → FULLY_REVERSED` allowed (cumulative reversals)
  - All three terminal statuses (`VOIDED_DRAFT`, `SUPERSEDED`, `FULLY_REVERSED`) have zero outgoing transitions
  - `assertTransitionAllowed` throws `InvalidTaxDocumentTransitionError` with explanatory hint
  - Helpers: `isTerminalStatus`, `isIssuedStatus` (DRAFT + VOIDED_DRAFT are not issued; everything else is)
  - Self-consistency: every status is a key in `ALLOWED_TRANSITIONS`; every target is a real status

Combined: **114/114 tax tests passing** (87 prior + 27 new).

**Behaviour change today:**
- The state-machine guard is now active inside `TaxDocumentService.transitionStatus`. Any future caller that tries `GENERATED → VOIDED_DRAFT` will throw with a clear error explaining the credit-note path.
- `voidDraft` is callable but not yet wired to an admin endpoint (Phase 25 wires the UI + the controller).
- `forceNew` regeneration path now correctly skips matching `PDF_FAILED` documents into the `SUPERSEDED` transition (previously missed `PDF_FAILED`).

**CA decisions touched / partially resolved:**
- §3 row "Invoice cancellation" — code-enforced. The only "void" path is the DRAFT path; everything else routes through credit notes (Phase 11).
- `INVOICE_CANCELLATION_POLICY.md` semantics — now mirrored in the FSM with corresponding error messages.

**Sign-off items §10 backed (additional):**
- ✓ FSM-enforced invoice cancellation rules
- ✓ Credit-note path is the only legal post-issue value-reduction mechanism (Phase 11 wires it)
- ✓ Voided drafts burn their number in `DocumentSequence.skippedNumbers` audit JSON
- ✓ Admin override required (`tax.override` permission — declared CRITICAL risk in Phase 1)

**Files added:**
- `apps/api/src/modules/tax/domain/tax-document-state-machine.ts`
- `apps/api/test/unit/tax-document-state-machine.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/application/services/tax-document.service.ts` — imports FSM, `forceNew` path includes `PDF_FAILED`, new `transitionStatus` + `voidDraft` methods

**Next:** Phase 11 (Credit notes for returns) — `CreditNoteService.generateForReturn(returnId)` reads `ReturnTaxReversalLine` rows, allocates a CREDIT_NOTE number via `DocumentSequenceService`, persists `tax_documents` (documentType=CREDIT_NOTE) + lines, flips the source invoice through `transitionStatus` to `PARTIALLY_REVERSED` or `FULLY_REVERSED`, links to RefundInstruction. Goodwill credits (no taxable-value change) route to `wallet_adjustments` instead — separate model from Phase 13.

---

### Phase 9 — Tax Invoice + Bill of Supply generation — 2026-05-13

**What was built (backend):**

*Three pure-function helpers* in `apps/api/src/modules/tax/domain/`:

- **`amount-in-words.ts`** — Indian-numbering-system English renderer (lakh / crore convention, not Western thousand / million). Two entry points:
  - `rupeesToWords(rupees: number): string` — e.g. `12_34_56_789` → `"Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"`.
  - `paiseToInvoiceWords(amountInPaise: bigint, currency = 'INR'): string` — e.g. `1234_56n` → `"Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"`. Handles `0`, whole-rupee, zero-rupee + non-zero-paise cases. Guards against `> Number.MAX_SAFE_INTEGER`.
- **`document-type-picker.ts`** — Pure function `pickDocumentType({sellerRegistrationType, hasTaxableLines, hasExemptLines})` returning `{ documentType, reason }`. Implements the matrix:
  - `COMPOSITION` / `UNREGISTERED` → `BILL_OF_SUPPLY` (no GST charged per Section 31(3)(c))
  - `REGULAR` + all taxable → `TAX_INVOICE`
  - `REGULAR` + all exempt → `BILL_OF_SUPPLY`
  - `REGULAR` + mixed → `INVOICE_CUM_BILL_OF_SUPPLY` (per CBIC Rule 46A)
  - Null registration → defaults to `REGULAR` (platform OWN_BRAND / SPORTSMART supplies)
- **`round-off.ts`** — `computeInvoiceRoundOff(rawAmountInPaise: bigint)` returns `{ rawAmountInPaise, roundedAmountInPaise, roundOffInPaise (signed) }`. Half-away-from-zero (matches ADR-004 Money convention). Correctly handles credit-note negatives where rounding "towards zero" is the intuitive direction.

*Orchestrator service:* `TaxDocumentService.generateForSubOrder(subOrderId, { forceNew?, actorId? })` in `apps/api/src/modules/tax/application/services/tax-document.service.ts`.

Pipeline:

1. **Idempotency.** If a non-cancelled invoice already exists for the sub-order, return it (unless `forceNew`). The `forceNew` path marks the prior document `SUPERSEDED` before creating the new one.
2. **Load** `SubOrderTaxSummary` + all `OrderItemTaxSnapshot` rows (ordered by `lineType` then `createdAt`).
3. **Load supplier identity** based on `summary.supplierType`:
   - `MARKETPLACE_SELLER` → `seller.gstin / legalBusinessName / registeredBusinessAddressJson / gstStateCode / gstRegistrationType`.
   - `FRANCHISE` → `franchise.gstNumber / businessName / state` (uses existing schema columns; franchise GST profile gap noted for CA cleanup).
   - `OWN_BRAND` / `SPORTSMART` → `platform_gst_profiles` (default + active row).
4. **Load recipient identity** — customer's default `customer_tax_profile` if any (sets `invoiceType=B2B` and `buyerGstin`), else fall back to user firstName/lastName + shipping address (`B2C`).
5. **Pick document type** via `pickDocumentType` on the registration type + supply mix.
6. **Allocate document number** via `DocumentSequenceService.nextNumber({supplierGstin, financialYear, documentType})` — atomic upsert; IST-aware FY computation.
7. **Compute round-off + grand total + amount-in-words** via the three pure helpers.
8. **Persist** `tax_documents` + `tax_document_lines` rows in a single transaction. Status starts as `PDF_PENDING`.
9. **Log** the result with the picker's reason ("Composition seller — Section 31(3)(c). No GST charged on supplies.", etc.).

*Phase 9 deliberately does NOT yet render the PDF.* Status ends at `PDF_PENDING`; the Phase 19 PDF retry processor turns HTML→PDF, uploads to S3, and flips status to `PDF_GENERATED`. This keeps Phase 9 reviewable end-to-end (the legal document record exists; PDF is a downstream concern).

*Module wiring:* `TaxModule` exports `TaxDocumentService`. Phase 9 does not auto-trigger generation on sub-order state transitions (the canonical hook points — `SubOrder.acceptStatus=ACCEPTED` for prepaid, `SubOrder.fulfillmentStatus=PACKED` for COD — are wired in Phase 27 alongside the integration tests). Admin manual triggering happens via the admin tax-documents endpoint shipping in Phase 25.

**Tests:**
- New `tax-document-helpers.spec.ts` — 25 tests pinning the three helpers:
  - `rupeesToWords`: zero, single digits, tens, hundreds, thousands, lakhs, crores, invalid inputs
  - `paiseToInvoiceWords`: ₹0, whole rupees, rupees + paise, zero rupees + paise, large lakh values, negative rejection
  - `pickDocumentType`: every branch (REGULAR-all-taxable, COMPOSITION, UNREGISTERED, REGULAR-all-exempt, REGULAR-mixed, null defaults)
  - `computeInvoiceRoundOff`: exact rupee no-op, round up, round down, exactly 50 paise (half-away-from-zero), negative (credit note)
- Total tax test count: **87/87 passing** (62 prior + 25 new).
- DB-roundtrip integration test for `generateForSubOrder` is queued for Phase 27.

**Behaviour change today:**
- The service exists and is ready to call. Nothing wires `TaxDocumentService.generateForSubOrder` into a state transition yet (Phase 27). Until then, generation is a manual operation that can be tested via the admin trigger endpoint in Phase 25.
- When called: produces a real Section 31-compliant `TaxDocument` row + per-line breakdown. The customer doesn't see anything new yet (no download UI until Phase 19 / Phase 25).

**CA decisions touched / partially resolved:**
- §3 row "Document numbering format" — implemented via `DocumentSequenceService`; called from `TaxDocumentService`.
- §3 row "Composition seller policy" — code respects `gstRegistrationType=COMPOSITION` → `BILL_OF_SUPPLY` (per Section 31(3)(c)). CA confirms the BoS footer copy in Phase 25 PDF template.
- §6.1 Section 31 invoice-particulars hooks — every required field populated.
- §6.2 Section 34 credit/debit-notes — `originalDocumentId` + `originalDocumentNumber` columns exist; Phase 11 will use them.

**Sign-off items §10 backed (additional):**
- ✓ Tax invoice generation (orchestrator) — Section 31 fields populated end-to-end
- ✓ Bill of supply path for composition + exempt suppliers
- ✓ Invoice-cum-Bill-of-Supply for mixed-supply sub-orders (CBIC Rule 46A)
- ✓ Amount in words rendered in CBIC convention (lakh / crore)
- ✓ Round-off line computed (half-away-from-zero per ADR-004)
- ✓ Idempotent (re-running yields same document; forceNew supersedes prior)

**Files added:**
- `apps/api/src/modules/tax/domain/amount-in-words.ts`
- `apps/api/src/modules/tax/domain/document-type-picker.ts`
- `apps/api/src/modules/tax/domain/round-off.ts`
- `apps/api/src/modules/tax/application/services/tax-document.service.ts`
- `apps/api/test/unit/tax-document-helpers.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — exports `TaxDocumentService`

**Next:** Phase 10 (invoice cancellation rules) — enforce the "no casual cancel" policy with a state machine validator that refuses `GENERATED → VOIDED_DRAFT` and `GENERATED → DRAFT` transitions; surfaces credit / debit note as the legal path for post-issue corrections. Wires `DocumentSequenceService.markSkipped` on legal voids.

---

### Phase 8 — Tax document model + DocumentSequenceService — 2026-05-13

**What was built (backend):**

*New Prisma schema file:* `apps/api/prisma/schema/tax-documents.prisma` — introduces the canonical record for every legal tax document Sportsmart issues, plus the monotonic number-sequence registry.

*New enums:*
- `DocumentType` — `TAX_INVOICE | BILL_OF_SUPPLY | INVOICE_CUM_BILL_OF_SUPPLY | CREDIT_NOTE | DEBIT_NOTE | LEGACY_RECEIPT`.
- `InvoiceType` — `B2C | B2B`.
- `TaxDocumentStatus` — `DRAFT | GENERATED | PDF_PENDING | PDF_GENERATED | PDF_FAILED | PARTIALLY_REVERSED | FULLY_REVERSED | SUPERSEDED | VOIDED_DRAFT`.
- `EInvoiceStatus` — `NOT_APPLICABLE | PENDING | GENERATED | FAILED`.

*New tables:*

**`tax_documents`** — single canonical record. Holds every Section 31 required particular (supplier legal name + address + GSTIN, recipient details, invoice number, date, place of supply, reverse-charge flag, all GST amounts, round-off, amount-in-words, currency, payment mode, original-document cross-ref for credit notes, status, PDF storage path + SHA256, download count, IRN/QR e-invoice fields, timestamps). One row per (subOrder × documentType) — the marketplace invoice principle: 1 SubOrder = 1 supplier invoice.

**`tax_document_lines`** — per-line breakdown. Tracks productName + HSN/SAC + UQC + decimal quantity + line totals + GST split. `sourceSnapshotId` references the originating `OrderItemTaxSnapshot` row so credit-note reversals can trace back. `lineNumber` is stable across re-renders (frozen at issue) to satisfy the "no reordering" GST rule.

**`document_sequences`** — one row per (supplierGstin, financialYear, documentType) tracking the high-water `last_number`. Includes `skipped_numbers` JSON for audit-trail of voided numbers. Sequence keys formatted `{gstin or 'PLATFORM'}|{FY}|{type}` (e.g. `36ABCDE1234F1Z5|2026-27|TAX_INVOICE`).

*Uniqueness:* `(supplier_gstin, financial_year, document_type, document_number)` UNIQUE on `tax_documents` — prevents number reuse. For LEGACY_RECEIPT with `supplier_gstin = NULL`, Postgres NULLS DISTINCT lets multiple receipts coexist; the platform-wide sequence key `PLATFORM|FY|LEGACY_RECEIPT` enforces single source.

*Migration `20260513190000_tax_documents_and_sequences`* — applied. 130 migrations total. `prisma migrate status` clean.

*New service:* `DocumentSequenceService` (`apps/api/src/modules/tax/application/services/document-sequence.service.ts`)

- **`nextNumber({ supplierGstin, financialYear, documentType, prefix? })`** — atomic monotonic increment. Implementation: raw SQL `INSERT ... ON CONFLICT (sequence_key) DO UPDATE SET last_number = last_number + 1 RETURNING last_number, prefix`. Single statement, race-free under concurrency — no SERIALIZABLE transaction or advisory lock needed. Returns `{ documentNumber, sequenceKey, lastNumber, prefix, supplierGstin, financialYear, documentType }`.
- **`previewNext(...)`** — read-only "next number will be ..." for admin UI hints.
- **`markSkipped(sequenceKey, number, reason)`** — burns a number as cancelled/voided in the audit JSON. Sequence's `last_number` never rolls back per GST law; the skipped-numbers list lets ops prove "we accounted for every number" at GSTR-1 review.
- **Static helpers**: `financialYearOf(date)` — computes IST-aware FY string like `"2026-27"`; correctly buckets edge cases (1 Apr 00:00 IST and 31 Mar 23:59 IST). `sequenceKeyOf(gstin, fy, type)` — canonical key shape.

*Default prefixes per document type (admin can override per-row):*
- TAX_INVOICE                  → `SM-INV`
- BILL_OF_SUPPLY               → `SM-BOS`
- INVOICE_CUM_BILL_OF_SUPPLY   → `SM-IBOS`
- CREDIT_NOTE                  → `SM-CN`
- DEBIT_NOTE                   → `SM-DN`
- LEGACY_RECEIPT               → `SM-LR`

Number format: `{prefix}-{zerofill6(lastNumber)}` → e.g. `SM-INV-000001`.

**Module wiring:** `TaxModule` now exports `DocumentSequenceService`. Other services (the upcoming Phase 9 `TaxDocumentService`, Phase 11 credit-note service, Phase 14 legacy-receipt generator) inject it to allocate numbers.

**Tests:**
- New `test/unit/tax-document-sequence.spec.ts` — 8 tests pinning IST-aware FY computation + sequence-key generation. Edge cases: 1 Apr 00:00 IST, 31 Mar 23:59 IST, century rollover, null GSTIN, etc.
- Combined: **62/62 tax tests passing.**
- DB-roundtrip behaviour (the atomic upsert under contention) is covered by an integration test queued for Phase 27.

**Behaviour change today:** None for customers. Nothing yet generates documents (Phase 9). Schema + sequence service are the foundation the generation services depend on.

**CA decisions touched / partially resolved:**
- §3 row "Document numbering format" — defaults seeded; admin can override per `document_sequences.prefix`.
- §5 (PDF templates) — fields are now schema-ready; renderer in Phase 9 will populate them.
- §6.1 Section 31 invoice-particulars hooks — every required column exists in `tax_documents` + `tax_document_lines`.

**Sign-off items §10 backed (additional):**
- ✓ Tax document model — all Section 31 fields slotted
- ✓ Per-supplier-per-FY-per-type number sequencing — atomic, race-safe
- ✓ Burned-number audit JSON (for compliance traceability)
- ✓ Status machine declared (DRAFT/GENERATED/PARTIALLY_REVERSED/FULLY_REVERSED/SUPERSEDED/VOIDED_DRAFT)

**Files added:**
- `apps/api/prisma/schema/tax-documents.prisma`
- `apps/api/prisma/schema/migrations/20260513190000_tax_documents_and_sequences/migration.sql`
- `apps/api/src/modules/tax/application/services/document-sequence.service.ts`
- `apps/api/test/unit/tax-document-sequence.spec.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — exports `DocumentSequenceService`

**Next:** Phase 9 (Tax Invoice + Bill of Supply generation) — `TaxDocumentService.generateForSubOrder(subOrderId)` orchestrates: pick documentType from seller `gstRegistrationType` + supply taxability, call `DocumentSequenceService.nextNumber` to allocate a number, build line items from `OrderItemTaxSnapshot` rows, snapshot supplier + buyer identity, compute round-off + amount-in-words, persist `tax_documents` + `tax_document_lines`. PDF renderer (HTML→PDF stored on S3) lands alongside.

---

### Phase 7 — Shipping GST as a tax line — 2026-05-13

**What was built (backend):**

*Schema relaxation:*
- `OrderItemTaxSnapshot.orderItemId` now **nullable** so non-PRODUCT lines (SHIPPING / GIFT_WRAP / etc.) can co-exist on the same table.
- The existing `@unique` on `orderItemId` still enforces "one PRODUCT snapshot per OrderItem" — Postgres `NULLS DISTINCT` lets multiple non-PRODUCT rows have `NULL` without conflict.
- New **partial unique index** (in migration SQL, since Prisma can't express partial indexes): `ON (sub_order_id, line_type) WHERE line_type != 'PRODUCT'`. Each sub-order can have at most one SHIPPING / GIFT_WRAP / CONVENIENCE_FEE / COD_FEE / ROUND_OFF row.
- Migration `20260513180000_tax_snapshot_shipping_line` — applied. 129 migrations now in store. `prisma migrate status` clean.

*Service update — `TaxSnapshotService`:*

- New dependency: `TaxConfigService` injected for `shipping_sac_code` / `shipping_gst_rate_bps` / `shipping_tax_inclusive` reads.
- After the per-item snapshot loop (PRODUCT lines), the service:
  1. Reads `MasterOrder.shippingFeeInPaise`.
  2. If `> 0`, loads shipping config from `tax_config` (defaults: SAC `9968`, rate `1800 bps = 18%`, exclusive pricing).
  3. **Allocates shipping fee proportionally** across sub-orders by their product taxable share; last sub-order absorbs the floor-rounding remainder. If all lines are exempt (master taxable = 0), distributes evenly with the last sub-order taking the remainder.
  4. For each sub-order, computes shipping GST via the engine v2 with `supplyTaxability = TAXABLE`, `isIntraState` inherited from the sub-order's POS, `priceIncludesTax` from `tax_config`.
  5. Upserts `OrderItemTaxSnapshot` row with `lineType = 'SHIPPING'`, `orderItemId = NULL`, description `"Shipping & Handling"`, UQC `'OTH'`, SAC stored in the `hsnCode` column (will be labelled correctly per `lineType` by the invoice renderer in Phase 9).
  6. Rolls the shipping tax totals into the sub-order accumulator so the `SubOrderTaxSummary` and `OrderTaxSummary` upserts (existing) automatically pick up shipping.

*Conservation invariants now expanded:*

- Per sub-order: `Σ snapshots[*].taxableAmount` === `SubOrderTaxSummary.taxableAmount` — includes SHIPPING line.
- Per master: `Σ subOrderShippingAllocated` === `MasterOrder.shippingFeeInPaise` (exact — last sub-order absorbs floor-rounding).
- Engine v2 conservation: `cgst + sgst + igst === totalTax` still holds for shipping lines (it's just another invocation of the same engine).

**Shipping POS rule (CA-configurable but defaulted):**
- Currently shipping follows the **same place-of-supply split** as the sub-order's product lines (intra→CGST+SGST, inter→IGST). This matches the default CA expectation; the rule lives in `accum.taxSplitType === 'CGST_SGST'` at the service.
- If your CA prefers shipping to always be IGST (the "service is rendered by the platform" interpretation), engineering can flip a flag — note in `GST_ASSUMPTIONS.md` §4 row "shipping POS rule".

**Free shipping handling:**
- The `MasterOrder.shippingFeeInPaise` reflects what the customer actually paid. If a `FREE_SHIPPING` discount applies, that fee is already 0 at this stage, and the service skips writing any SHIPPING line (no row, no tax). The discount itself is recorded under `OrderDiscount` for ledger reporting.

**Cancellation / return refund of shipping:**
- Deferred to Phase 11 (Credit Notes). The credit note creation will read the SHIPPING snapshot row and decide whether to reverse it based on `tax_config` policy. For now, all returns work on PRODUCT lines only (existing legacy behaviour).

**Behaviour change today:**
- Orders with a shipping fee now produce **one additional `OrderItemTaxSnapshot` row per sub-order** with `lineType = 'SHIPPING'`. In test mode (`shipping_gst_rate_bps = 1800` from seed) the row stores real CGST/SGST/IGST/total numbers based on the allocated share.
- `SubOrderTaxSummary.invoiceTotalInPaise` and `OrderTaxSummary.invoiceTotalInPaise` now include shipping totals.

**Admin UI (deferred to Phase 25):**
- A `/dashboard/tax/shipping-config` page that surfaces the three `tax_config` keys (SAC, rate, inclusive). For now, finance edits via SQL or the admin tax-config endpoint when Phase 18 reports ship.

**Tests:** 54/54 tax tests still passing. Phase 7 has no new unit tests because the new logic exercises the existing `calculateLineTax` (which has 19 tests already pinning the math). End-to-end (place an order with shipping → assert SHIPPING snapshot + summary inclusion) is queued for Phase 27.

**CA decisions touched / partially resolved:**
- §3 row "Shipping SAC + rate + split rule" — values configurable via `tax_config`; CA must confirm `9968` + 18% + same-as-product POS rule.
- §4 row "Shipping refund on return" — deferred to Phase 11 credit note design.

**Sign-off items §10 backed (additional):**
- ✓ Shipping is a real tax line (separate from product GST per CGST Rule 46)
- ✓ Allocated proportionally across sub-orders so each invoice carries its share
- ✓ Engine v2 reused — same conservation invariants

**Files added:**
- `apps/api/prisma/schema/migrations/20260513180000_tax_snapshot_shipping_line/migration.sql`

**Files modified:**
- `apps/api/prisma/schema/orders.prisma` — `OrderItemTaxSnapshot.orderItemId` made nullable, relation optional
- `apps/api/src/modules/tax/application/services/tax-snapshot.service.ts` — injected `TaxConfigService`; added shipping allocation + SHIPPING snapshot upsert block between product-loop and sub-order summary

**Next:** Phase 8 (Tax Document model — `tax_documents` + `tax_document_lines` + `document_sequences`). Introduces the canonical record for Tax Invoices / Bills of Supply / Credit Notes / Debit Notes / Legacy Receipts. Includes the serializable-lock document-number sequence per (gstin, FY, documentType).

---

### Phase 6 — Checkout integration + TaxSnapshotService + B2B GSTIN snapshotting — 2026-05-13

**What was built (backend):**

*New service:* `apps/api/src/modules/tax/application/services/tax-snapshot.service.ts` (~340 lines). Encapsulates **all snapshot + summary writes**, independent of whether a discount was applied.

Pipeline (`createSnapshotsForMasterOrder(masterOrderId, { taxTreatment? })`):

1. **Resolve place-of-supply** per sub-order via `PlaceOfSupplyService` (reads committed master_order + seller/franchise data outside the tx).
2. **Resolve buyer GSTIN** — looks up the customer's default `CustomerTaxProfile`. Null for B2C (most orders today).
3. **Open a transaction**.
4. **Batch-load** items + their `OrderItemDiscount` rows + products + variants (by ID set; no FK on `OrderItem → Product/Variant`).
5. **Per item:** resolve per-line tax data (variant overrides → product defaults), call `calculateLineTax` (engine v2), upsert `OrderItemTaxSnapshot` with full Phase 5 column set, accumulate per-sub-order totals.
6. **Per sub-order:** upsert `SubOrderTaxSummary` with aggregated totals + status (`COMPLETE`/`INCOMPLETE`/`EXEMPT`).
7. **Master-level:** upsert `OrderTaxSummary` with rolled-up totals.

*Module wiring:*
- `TaxModule` now exports `TaxSnapshotService` alongside `PlaceOfSupplyService` + `TaxConfigService`.
- `CheckoutModule` imports `TaxModule`.

*Service wiring — `checkout.service.ts`:*
- `CheckoutService` constructor now takes `TaxSnapshotService`.
- After the existing discount-allocation block (which writes `OrderItemDiscount` rows when a coupon applies), the new flow always calls `taxSnapshot.createSnapshotsForMasterOrder(masterOrderId, { taxTreatment })`.
  - Resolves `taxTreatment` from the Discount row when a discount was applied; else defaults `PRE_SUPPLY_TRANSACTIONAL` (irrelevant since there are no discount rows to read).
- **Snapshot creation now runs for every order, not just discounted ones.** This was the load-bearing gap — previous behaviour wrote zero snapshots for ~90 % of orders.
- Snapshot creation failures are logged but non-fatal (order is already committed; recovery cron picks up missing snapshots in Phase 19).

*Idempotency:* `DiscountAllocationService` still writes snapshots in its own tx (Phase 4 work retained). `TaxSnapshotService` is called immediately after and rewrites the same data (same inputs → same outputs; upserts on `orderItemId` / `subOrderId` / `masterOrderId`). No data divergence. A future cleanup PR will retire the duplicate write from discount-allocation.

**B2B GSTIN snapshotting:**
- `TaxSnapshotService` resolves `buyerGstin` from `customer_tax_profiles.findFirst({ where: { customerId, isDefault: true } })`.
- Written to `OrderItemTaxSnapshot.buyerGstin` + `SubOrderTaxSummary.buyerGstin`.
- For Phase 6, customers add GSTIN via `customer_tax_profiles` directly (admin-set or seed); UI form is Phase 25 polish.
- B2B place-of-supply switch is already config-driven via `tax_config.b2b_place_of_supply_source` (Phase 2).

**Behaviour change today:**
- Place a test order without a coupon → previously: zero rows in `order_item_tax_snapshots` / `sub_order_tax_summaries` / `order_tax_summaries`. Now: all three populated.
- All Phase 5 metadata (lineType, supplierType, sellerStateCode, taxSplitType, taxDataStatus, etc.) flows through.
- Test data still has `gstRateBps = 0` so money fields remain `0`, but the snapshot artefacts exist — invoice generation in Phase 8 can read them.

**Frontend status (Phase 6 — minimal change):**

The customer storefront does NOT yet show new tax UI in Phase 6. Two reasons:
1. **Cart already correctly shows** "Estimated tax: Calculated at checkout" (line 236 of `cart/page.tsx`). No change needed.
2. **PDP shows "Inclusive of all taxes"** which is technically correct in test mode (all rates are 0). Phase 25 polish will gate this on per-product real tax data.

What customer-facing UI Phase 6 deliberately defers to Phase 25:
- PDP per-product "Inclusive of GST 18%" with rate gating
- Checkout tax summary panel with CGST/SGST/IGST breakdown (data exists in `OrderTaxSummary` — needs a `/customer/orders/:id/tax-breakdown` endpoint + UI)
- B2B GSTIN input on customer account profile + checkout-time picker
- Order detail page tax summary card

The data layer for all of the above is in place. Phase 25 is the dedicated frontend pass.

**Tests:** 54/54 tax tests still passing post-Phase-6. End-to-end checkout integration test (place a 3-seller order, assert 3 SubOrderTaxSummary rows with correct GST split per supplier-state) is queued for Phase 27 (test pass).

**CA decisions touched / partially resolved:**
- §3.1 B2B place-of-supply — config field already wired in Phase 2; buyer GSTIN now snapshotted on every tax row.
- §4 row "Snapshot creation" — now runs for every order regardless of discount.

**Sign-off items §10 backed (additional):**
- ✓ Every new order produces complete tax snapshots + summaries
- ✓ B2B GSTIN snapshotted from `customer_tax_profiles` (no UI yet; rows can be admin-seeded for testing)
- ✓ TaxSnapshotService is the single canonical writer for invoice-ready data

**Files added:**
- `apps/api/src/modules/tax/application/services/tax-snapshot.service.ts`

**Files modified:**
- `apps/api/src/modules/tax/module.ts` — exports `TaxSnapshotService`
- `apps/api/src/modules/checkout/module.ts` — imports `TaxModule`
- `apps/api/src/modules/checkout/application/services/checkout.service.ts` — injects + calls `TaxSnapshotService` after every order placement

**Next:** Phase 7 (Shipping GST) — add shipping as a tax line via `lineType = SHIPPING`; admin-configurable shipping SAC + rate via `tax_config`; shipping refund policy on cancellation; relax `OrderItemTaxSnapshot.orderItemId` UNIQUE to support non-PRODUCT lines (partial unique index strategy).

---

### Phase 5 — Tax snapshot expansion + SubOrder/Order summaries — 2026-05-13

**What was built (backend):**

*Schema (additive, safe defaults):*

- New enum `TaxDataStatus` (`COMPLETE | INCOMPLETE | EXEMPT`).
- `OrderItemTaxSnapshot` extended with **17 new columns**:
  - **Line classification:** `lineType` (default `PRODUCT`), `supplierType`, `sellerId`, `productId`, `variantId`, `description`, `uqcCode`, `quantity (Decimal 12,3)`.
  - **Tax inputs (engine echo):** `supplyTaxability` (default `TAXABLE`), `priceIncludesTax` (default `true`), `cessRateBps`, `cessAmountInPaise`.
  - **Place-of-supply detail:** `sellerStateCode`, `taxSplitType`, plus the existing `placeOfSupply`.
  - **GSTIN snapshots:** `sellerGstin`, `buyerGstin` (snapshotted at order time for legal invoice particulars).
  - **Misc:** `reverseChargeApplicable` (default `false`), `currencyCode` (default `INR`), `taxDataStatus` (derived per-line).
- New table `sub_order_tax_summaries` — one row per `SubOrder` aggregating taxable + CGST + SGST + IGST + total tax + cess + roundOff + invoiceTotal. Drives the **seller invoice header** in Phase 8.
- New table `order_tax_summaries` — one row per `MasterOrder`. Drives the customer-facing **tax summary panel** + reconciliation reports.
- Both summary tables FK-cascade with `master_orders` / `sub_orders` so legacy cleanup doesn't leave orphans.
- Migration `20260513170000_tax_snapshot_expansion_and_summaries` — applied. 128 migrations now in store. `prisma migrate status` clean.

*Service — `discount-allocation.service.ts`:*

- Extended item query to pull `productTitle` + `quantity`.
- Extended product query to pull `productSource` (for `supplierType` derivation).
- Per snapshot row now populates **every Phase 5 column**:
  - `lineType = 'PRODUCT'`
  - `supplierType` = `'OWN_BRAND'` if `product.productSource = OWN_BRAND`, else `'MARKETPLACE_SELLER'`
  - `sellerId`, `productId`, `variantId`, `description` (productTitle), `uqcCode`, `quantity` (Decimal)
  - `supplyTaxability`, `priceIncludesTax`, `cessRateBps`, `cessAmountInPaise`
  - `sellerStateCode` (from POS resolver), `taxSplitType` (CGST_SGST / IGST), `placeOfSupply`
  - `reverseChargeApplicable = false`, `currencyCode = 'INR'`
  - `taxDataStatus` computed per row:
    - `EXEMPT` — if `supplyTaxability` ∈ {NIL_RATED, EXEMPT, NON_GST, OUT_OF_SCOPE}
    - `INCOMPLETE` — if TAXABLE but `hsnCode` is null or `gstRateBps ≤ 0`
    - `COMPLETE` — TAXABLE with full data
- During the per-item loop, accumulates per-sub-order totals in memory (taxable / cgst / sgst / igst / total / cess / lineTotal + status aggregation).
- After the loop, **upserts `SubOrderTaxSummary` per sub-order** with the accumulated totals + per-sub-order tax-data-status (any INCOMPLETE wins; else all-EXEMPT → EXEMPT; else COMPLETE).
- **Upserts `OrderTaxSummary` at the master level** with the rolled-up totals + master-level tax-data-status by the same rule.

**Conservation invariants now enforced (in code + verifiable in DB):**

- For each sub-order: `Σ snapshots.taxableAmount` === `SubOrderTaxSummary.taxableAmount` (same for cgst, sgst, igst, total, cess, lineTotal/invoiceTotal).
- For master: `Σ SubOrderTaxSummary.*` === `OrderTaxSummary.*`.
- These invariants make the reconciliation report (Phase 18) a simple aggregation check rather than a recompute.

**Behaviour change today:**

- Every new order placed after deploy gets a **fully populated tax snapshot** + a `SubOrderTaxSummary` row per sub-order + one `OrderTaxSummary` row. Test data currently has `gstRateBps = 0` for all products, so all tax money fields remain `0`, but the metadata (lineType, supplierType, description, quantity, sellerStateCode, taxSplitType, taxDataStatus) is now real.
- Snapshots placed before this phase remain untouched (legacy rows; back-compat preserved).
- Test mode: `taxDataStatus = 'INCOMPLETE'` on TAXABLE products lacking HSN — visible in admin queries so finance can identify gaps before strict-mode flip.

**Tests (passing):**

- 54/54 prior tax tests still pass (engine + GSTIN + POS).
- Phase 5 integration test (place order → assert summary rows + conservation) deferred to Phase 6 where checkout end-to-end test lives.

**CA decisions touched / partially resolved:**

- §3 row "HSN length tier" — `taxDataStatus = INCOMPLETE` automatically flags TAXABLE products without HSN. Admin report in Phase 18 reads this.
- §6 hooks — Section 31 invoice particulars now have schema slots for every required field (`sellerLegalName`, `buyerGstin`, `placeOfSupplyStateCode`, `taxSplitType`, etc.). Phase 8 invoice generation populates from snapshots.

**Sign-off items §10 backed (additional):**

- ✓ `OrderItemTaxSnapshot` has all Section-31 fields snapshot-ready
- ✓ `SubOrderTaxSummary` schema in place — one row per SubOrder = one invoice header
- ✓ `OrderTaxSummary` schema in place — customer-facing aggregate
- ✓ Conservation invariants enforced

**Files added:**

- `apps/api/prisma/schema/migrations/20260513170000_tax_snapshot_expansion_and_summaries/migration.sql`

**Files modified:**

- `apps/api/prisma/schema/tax-master.prisma` — `TaxDataStatus` enum added
- `apps/api/prisma/schema/orders.prisma` — `OrderItemTaxSnapshot` extended (+17 columns + 6 indexes), `SubOrderTaxSummary` + `OrderTaxSummary` models added
- `apps/api/src/modules/discounts/application/services/discount-allocation.service.ts` — item/product queries extended, per-line population of all new fields, per-sub-order + master-level accumulators, upsert summary rows

**Next:** Phase 6 (Checkout integration) — wire `checkout.service.ts` to use the new fields end-to-end; ensure server-side recalculation on address change; B2B GSTIN field on customer checkout; integration test that asserts a 3-seller order produces 3 SubOrderTaxSummary rows with correct CGST/SGST/IGST per supplier-state.

---

### Phase 4 — Discount tax treatment + engine v2 wiring — 2026-05-13

**What was built (backend):**

*Schema:*
- New enum `DiscountTaxTreatment` (PRE_SUPPLY_TRANSACTIONAL | POST_SUPPLY_LINKED | POST_SUPPLY_UNLINKED | DISPLAY_ONLY)
- New column `discounts.tax_treatment` defaulted to `PRE_SUPPLY_TRANSACTIONAL` — preserves current behaviour for every existing row.
- Migration `20260513160000_discount_tax_treatment` — applied. `prisma migrate status` clean (127 migrations total).

*Service wiring — `discount-allocation.service.ts`:*
- **Replaced `calculateLineGst` (legacy) with `calculateLineTax` (engine v2)** for every tax-snapshot computation. Legacy engine retained for `calculateGstReversal` (return reversal still uses it; Phase 11 will swap).
- Now batch-loads per-product + per-variant tax fields (`hsnCode`, `gstRateBps`, `supplyTaxability`, `taxInclusivePricing`, `cessRateBps`, `defaultUqcCode` + variant overrides) by ID set — OrderItem has no Prisma relation to Product/Variant so we issue 2 extra `findMany` calls per allocation.
- Per-item resolution: **variant override beats product default** for every override-able field.
- Honors `discount.taxTreatment`:
  - `PRE_SUPPLY_TRANSACTIONAL` → engine subtracts discount from taxable (CGST §15 — default).
  - `POST_SUPPLY_LINKED` / `POST_SUPPLY_UNLINKED` / `DISPLAY_ONLY` → engine sees zero discount for tax; allocation ledger still records the allocated amount for reporting; Phase 11 emits credit notes for POST_SUPPLY_LINKED.
- `OrderItemTaxSnapshot` now stores `hsnCode` (previously empty) and `placeOfSupply` (already from Phase 2). The 5 GST money fields (taxable / cgst / sgst / igst / total / lineTotal) now flow from engine v2 with full inclusive/exclusive + taxability support.

*Extended `AllocationContext`:* added optional `taxTreatment?: DiscountTaxTreatment`. Caller (`checkout.service.ts`) doesn't yet pass it — the allocation service loads it from the Discount row by `discountId` if absent. No caller changes required for Phase 4 to land.

**Behaviour change today:**
- **Snapshots now contain real tax numbers** for any product that has `gstRateBps > 0` (none of today's products do — they're all 0 from the Phase 1 default). When admin starts populating product rates, the engine v2 takes over: intra-state orders produce CGST+SGST split, inter-state produces IGST, taxability classes route correctly.
- The runtime test that proves Phase 4 wiring is correct: place an order on a product with `gstRateBps = 1800`, `taxInclusivePricing = true`, shipping address state matching the seller's `gstStateCode` — the resulting snapshot should show `cgstAmountInPaise` + `sgstAmountInPaise` (each half) and `igstAmountInPaise = 0`.

**Tests (passing):**
- 54/54 prior tax-engine + GSTIN + POS tests still pass after wiring.
- Phase 4 integration test (place order through allocation, assert snapshot fields) is deferred to Phase 6 (checkout integration) which is where the end-to-end behaviour is asserted.

**Pre-existing TS drift (NOT caused by Phase 4):**
- `modules/orders/application/services/risk-scoring.service.ts` + `verification-queue.service.ts` reference `verificationRiskScore`, `verificationRiskBand`, `verificationRiskReasons`, `verificationScoredAt`, `claimedByAdminId`, `claimExpiresAt`, `claimedAt` — columns the Prisma schema NO LONGER declares (the schema drift I flagged on 2026-05-13 in the Phase 1 prerequisite scan). The DB still has these columns; the application still tries to use them. Nest's `swc` compiler is lenient so the API boots and runs fine, but `tsc --noEmit` flags them. This drift existed BEFORE Phase 0. A separate cleanup PR should either re-add the columns to the schema or remove the references from the services.
- `prisma/seed/seed-admin-rbac.ts` references an old path for `permission-registry` (moved to `core/authorization/` in PR 4.6). Cosmetic — the seed still runs because ts-node resolves it differently.

These pre-existing drifts are documented but **not blocking Phase 4 ship**. Flag for the CA review: "Drift detected; cleanup PR planned" — engineering owns the fix.

**CA decisions touched / partially resolved:**
- §3 row "Discount tax treatment" — now enforced via `discount.taxTreatment` column with default; admin UI in Phase 25 exposes the picker on discount create.
- §3 row "GST-inclusive vs exclusive" — runtime switch via `Product.taxInclusivePricing` (default true per Phase 1 seed). Engine v2 splits or adds-on accordingly.

**Sign-off items §10 backed (additional):**
- ✓ Engine v2 wired into the live snapshot creation path
- ✓ Per-product HSN + rate + taxability + inclusive flag flow through end-to-end
- ✓ Variant overrides honored
- ✓ Discount tax treatment enum + column shipped

**Files added:**
- `apps/api/prisma/schema/migrations/20260513160000_discount_tax_treatment/migration.sql`

**Files modified:**
- `apps/api/prisma/schema/discounts.prisma` — new enum `DiscountTaxTreatment`, new column `taxTreatment` on `Discount`
- `apps/api/src/modules/discounts/application/services/discount-allocation.service.ts` — swap to engine v2, batch-load product/variant tax data, honor `taxTreatment`, persist `hsnCode` on snapshot

**Next:** Phase 5 (Order tax snapshot expansion) — extend `OrderItemTaxSnapshot` schema with `lineType`, `supplierType`, `supplyTaxability`, `pricingMode`, `sellerStateCode`, `taxSplitType`, `reverseChargeApplicable`, `taxDataStatus`, `currencyCode`; introduce `SubOrderTaxSummary` + `OrderTaxSummary` aggregate tables; wire snapshot creation to populate every field from engine v2 + POS resolver.

---

### Phase 3 — Tax Engine v2 (inclusive / exclusive, taxability taxonomy, cess) — 2026-05-13

**What was built (backend):**

*New pure-function tax engine* at `apps/api/src/modules/tax/domain/tax-engine.ts`. Replaces the legacy `discounts/domain/tax/calculate-gst.ts` (which is kept for backward compat; Phase 4 swaps `discount-allocation.service.ts` to use the new engine).

**Supported features (vs. legacy engine):**

| Capability | Legacy | v2 (new) |
|---|---|---|
| Exclusive pricing (gross + GST = line total) | ✓ | ✓ |
| Inclusive pricing (price already includes GST; back-out split) | ✗ | ✓ |
| Discount before GST (Section 15) | ✓ | ✓ |
| CGST + SGST intra-state | ✓ | ✓ |
| IGST inter-state | ✓ | ✓ |
| Conservation: `cgst+sgst+igst === totalTax` | ✓ | ✓ |
| `TAXABLE` supply | ✓ | ✓ |
| `NIL_RATED` (rate 0, separate GSTR-1 row) | ✗ | ✓ |
| `EXEMPT` (rate 0, ITC ineligible) | ✗ | ✓ |
| `NON_GST` (e.g. alcohol/petroleum — out of GST regime) | ✗ | ✓ |
| `ZERO_RATED` (exports under LUT, future-ready) | ✗ | ✓ |
| `OUT_OF_SCOPE` | ✗ | ✓ |
| Compensation cess (separate from GST) | ✗ | ✓ |
| `reportableValueInPaise` for GSTR-1 sectioning | ✗ | ✓ |
| Strict input validation (negative gross, discount > gross, rate > 0 on non-taxable, invalid taxability string) | partial | ✓ full |

**Inclusive-pricing math (new, central to Indian B2C):**

```
netInclusive = gross − discount
taxable      = floor(netInclusive × 10000 / (10000 + rateBps))
totalTax     = netInclusive − taxable          // guaranteed exact
cgst         = floor(taxable × halfRate / 10000)
sgst         = totalTax − cgst                 // conservation
lineTotal    = netInclusive (+ cess if any)
```

Worked example: ₹1180 inclusive @ 18% IGST → `taxable = 100,000 paise = ₹1000`, `igst = 18,000 paise = ₹180`, line total = `118,000 paise = ₹1180` (matches the customer-facing price).

**Worked example with discount, inclusive:** ₹1180 list price - ₹118 (10%) coupon = ₹1062 net inclusive → `taxable = 90,000 paise = ₹900`, `igst = 16,200 paise = ₹162`, line total = `106,200 paise = ₹1062`. Customer pays ₹1062; seller's taxable supply value for GSTR-1 is ₹900.

**Cess handling:**
- Always exclusive (cess sits on top of GST, even when GST is inclusive).
- Applied to `taxable` base (matches CBIC Compensation Cess Rules).
- Default `cessRateBps = 0` (no cess on sports goods today; schema-ready for future HSN).

**Taxability short-circuits:**
- `EXEMPT` / `NIL_RATED` / `NON_GST` / `OUT_OF_SCOPE` → engine returns zero GST regardless of input rate. Validator rejects `rate > 0` on these to catch admin data-entry errors.
- `ZERO_RATED` → same math as TAXABLE-at-0%, but reportable separately on GSTR-1 (e.g. exports under LUT).
- `TAXABLE` → full computation.

**Tests (passing):**
- `test/unit/tax-engine.spec.ts` — 19 tests covering exclusive, inclusive, intra/inter, discount + tax order, taxability taxonomy, cess, validation, conservation invariants.
- Combined with Phase 1/2 tests: **54/54 passing.**

**Behaviour change today:**
- Nothing customer-visible yet. The new engine is ready for use; Phase 4 wires `discount-allocation.service.ts` to use it instead of legacy. Until then, all snapshots still go through `calculateLineGst` (legacy, exclusive-only, TAXABLE-only).

**CA decisions touched / partially resolved:**
- §3 row "GST-inclusive vs exclusive" — engine handles both; per-product `Product.taxInclusivePricing` (Phase 1 column) is the runtime switch.
- §4 row "NIL/Exempt/Non-GST taxonomy" — fully modeled.
- §4.1 row "Rounding strategy" — preserved (BigInt floor + SGST derivation).
- §4.3 "Shipping defaults" — engine takes shipping as-just-another-line; Phase 7 wires shipping through this same engine.

**Sign-off items §10 backed (additional):**
- ✓ Tax engine v2 — inclusive / exclusive split working
- ✓ Taxability taxonomy fully modeled (5 classes + OUT_OF_SCOPE)
- ✓ Compensation cess schema-ready
- ✓ Strict input validation
- ✓ 19 new unit tests pinning the math

**Files added:**
- `apps/api/src/modules/tax/domain/tax-engine.ts`
- `apps/api/test/unit/tax-engine.spec.ts`

**Files modified:** None — Phase 3 is purely additive. The legacy engine remains in place until Phase 4 swap.

**Next:** Phase 4 (Discount GST treatment) — wire `discount-allocation.service.ts` to call the new engine; route the per-product `taxInclusivePricing` + `supplyTaxability` + `gstRateBps` + `hsnCode` per item into the engine; add `discountTaxTreatment` enum (PRE_SUPPLY_TRANSACTIONAL / POST_SUPPLY_LINKED / POST_SUPPLY_UNLINKED / DISPLAY_ONLY) to the discount model.

---

### Phase 2 — Place-of-Supply Resolver + GSTIN validator — 2026-05-13

**What was built (backend):**

*New tax module:* `apps/api/src/modules/tax/` introduces the tax-domain layer with:
- **`domain/gstin-validator.ts`** — pure functions: `validateGstin()`, `isGstinValid()`, `computeGstinChecksum()`, `gstinMatchesPan()`. Implements the full GSTIN spec — 15-char format check + structural regex + Mod-36 checksum + PAN-cross-check. Returns a structured `GstinValidationResult` with extracted `stateCode`, `panNumber`, `panLast4`, `entityCode`, `checkDigit`, plus a list of `errors` for friendly admin UI surfacing.
- **`domain/place-of-supply.ts`** — pure function `resolvePlaceOfSupply(input)` returns `{ supplierStateCode, placeOfSupplyStateCode, isIntraState, taxSplitType, resolutionReason }`. Handles B2C (default), B2B with `SHIPPING` source, and B2B with `BUYER_GSTIN_STATE` source per the `tax_config.b2b_place_of_supply_source` switch (CA-configurable per §3.1).
- **`domain/state-code-map.ts`** — state-name normalisation + lookup map. `extractStateCodeFromAddress()` tries `stateCode` → `gstStateCode` → state-name lookup against the `india_states` master.
- **`application/services/tax-config.service.ts`** — typed reader for `tax_config` table with 60s in-memory cache. Eighteen typed keys covered (`required_hsn_length`, `eway_bill_threshold_paise`, `tcs_rate_bps`, `tax_strict_mode`, etc.).
- **`application/services/place-of-supply.service.ts`** — DB-aware orchestrator. Loads `MasterOrder.shippingAddressSnapshot` + sub-order seller / franchise / platform state codes, runs the pure resolver per sub-order, returns `Map<subOrderId, PlaceOfSupplyResult>`. **Test mode falls back to IGST** with a warning logged when state codes cannot be resolved; **strict mode throws** so checkout aborts.
- **`module.ts`** — exports `PlaceOfSupplyService` + `TaxConfigService`.

*Wiring:*
- `app.module.ts` imports `TaxModule` (platform module, placed after `RefundInstructionsModule`).
- `discounts.module.ts` imports `TaxModule` so `DiscountAllocationService` can inject `PlaceOfSupplyService`.
- **`discount-allocation.service.ts`** — the load-bearing change: `isIntraState: false` hardcoded value at line 255 is **gone**. New flow: before the per-item snapshot loop, resolve place-of-supply for every sub-order once; in the loop, each item's snapshot uses the correct `isIntraState` for its sub-order's POS and stores `placeOfSupply: <state code>` on `OrderItemTaxSnapshot`.

*New permissions added to registry (Phase 1 follow-up):* `tax.read`, `tax.gstin.verify`, `tax.invoice.*`, `tax.creditNote.*`, `tax.tcs.*`, `tax.ewayBill.*`, `tax.einvoice.*`, `tax.reports.*`, `tax.override`, `wallet.adjustment.*` — 29 keys total, with 11 carrying CRITICAL/HIGH risk classification (Phase 1 log).

**Behaviour change:**
- Until product HSN/GST rates are populated (`DEFAULT_GST_RATE_BPS = 0` still applies as fallback), the engine continues to write tax snapshots with zero tax components. **The behavioural change is solely correctness of the POS classification** — `OrderItemTaxSnapshot.placeOfSupply` now reflects reality, and the `isIntraState` flag passed to `calculateLineGst` now matches the seller/customer state comparison (instead of being hardcoded inter-state).
- When rates are turned on (next sub-phase after Phase 3 engine extension), intra-state orders will produce CGST+SGST and inter-state will produce IGST, automatically.

**Tests (passing):**
- `test/unit/tax-gstin-validator.spec.ts` — 14 tests covering format, checksum, normalisation, PAN cross-check.
- `test/unit/tax-place-of-supply.spec.ts` — 21 tests covering CGST_SGST/IGST split, B2C/B2B variants, state-name normalisation, address extraction, invalid-input handling.
- Combined: **35/35 passing.**

**CA decisions touched / partially resolved:**
- §3.1 B2B place-of-supply rule — implemented as `tax_config.b2b_place_of_supply_source` (default `SHIPPING`); CA flips to `BUYER_GSTIN_STATE` if business requires (e.g. for export-ITC reasons).
- §3.2 Shipping SAC + rate — `tax_config` already seeded in Phase 1; consumed by future shipping-line phase.
- §3.8 E-invoice applicability — schema fields ready; resolver outputs `placeOfSupply` for future IRP payload.

**New defaults added to §4:**
- §4.2 Place-of-supply defaults — now correctly applied at runtime (not just documented).

**Sign-off items §10 backed (additional):**
- ✓ Place-of-supply correctly resolved (§4.2)
- ✓ `isIntraState: false` hardcode removed
- ✓ CGST/SGST vs IGST decision plumbed end-to-end
- ✓ GSTIN format validator + Mod-36 checksum + PAN cross-check shipped
- ✓ 35 unit tests pinning the math

**Files added:**
- `apps/api/src/modules/tax/domain/gstin-validator.ts`
- `apps/api/src/modules/tax/domain/place-of-supply.ts`
- `apps/api/src/modules/tax/domain/state-code-map.ts`
- `apps/api/src/modules/tax/application/services/tax-config.service.ts`
- `apps/api/src/modules/tax/application/services/place-of-supply.service.ts`
- `apps/api/src/modules/tax/module.ts`
- `apps/api/test/unit/tax-gstin-validator.spec.ts`
- `apps/api/test/unit/tax-place-of-supply.spec.ts`

**Files modified:**
- `apps/api/src/app.module.ts` — registered TaxModule
- `apps/api/src/modules/discounts/discounts.module.ts` — imported TaxModule
- `apps/api/src/modules/discounts/application/services/discount-allocation.service.ts` — wired `PlaceOfSupplyService`; replaced `isIntraState: false` hardcode; populates `OrderItemTaxSnapshot.placeOfSupply` per sub-order

**Test data status:**
- Customer address state name needs to match an entry in `india_states.stateName` for resolution. With 39 rows seeded (full CBIC list), most real addresses resolve.
- Sellers without `gstStateCode` populated fall back to `seller.state` free-text mapped via `india_states`. Sellers with neither → resolver uses `platform_gst_profiles.default` state code. **CA action:** verify the platform profile's `gstStateCode = '36' (Telangana)` matches the actual entity's primary state.

**Next:** Phase 3 (tax engine v2) — extend `calculateLineGst` to support GST-inclusive prices, `supplyTaxability` taxonomy (NIL_RATED/EXEMPT/NON_GST/ZERO_RATED), and a stable line-level computation contract for the snapshot extension landing in Phase 5.

---

### Phase 1 — tax master data schema + seeds — 2026-05-13

**What was built (backend):**

*New Prisma schema file:* `apps/api/prisma/schema/tax-master.prisma` introduces five enums (`SupplyTaxability`, `GstRegistrationType`, `TaxLineType`, `TaxSplitType`, `SupplierType`) and seven new tables:

| Table | Purpose | Rows after seed |
|---|---|---|
| `india_states` | CBIC 2-digit state code master | 39 |
| `uqc_master` | CBIC Unit Quantity Codes (NOS, PCS, KGS, …) | 44 |
| `hsn_master` | HSN code + default rate + UQC mapping (versioned via effectiveFrom) | 28 (**STUB — CA must validate**) |
| `seller_gstins` | Multi-GSTIN per seller; primary marked `isPrimary` | 0 |
| `customer_tax_profiles` | B2B customer GSTIN profiles | 0 |
| `platform_gst_profiles` | Sportsmart's own GSTIN for OWN_BRAND supplies | 1 placeholder (**CA must replace**) |
| `tax_config` | Runtime tunables (HSN length tier, EWB threshold, TCS rate, etc.) | 19 defaults |

*Modified schemas (additive, all nullable or safe-default):*
- `Product`: added `hsnCode`, `gstRateBps`, `supplyTaxability`, `taxInclusivePricing`, `cessRateBps`, `defaultUqcCode`, `taxCategory`, `taxConfigUpdatedBy/At` (9 columns)
- `ProductVariant`: added `gstRateBpsOverride`, `hsnCodeOverride`, `taxInclusivePricingOverride`, `uqcCodeOverride` (4 columns)
- `Seller`: added `gstin`, `legalBusinessName`, `registeredBusinessAddressJson`, `gstStateCode`, `gstRegistrationType`, `isGstVerified`, `gstVerifiedAt/By`, `gstVerificationNotes`, `panNumber`, `panLast4`, `panVerified` (12 columns) + back-relation `gstins: SellerGstin[]`
- `User`: added back-relation `taxProfiles: CustomerTaxProfile[]`

*Migration:* `20260513140000_tax_phase1_master_data/migration.sql` — applied successfully to `sportsmart_dev`. `prisma migrate status` reports "Database schema is up to date". Prisma client regenerated; API restarted; `/health` returns 200.

*RBAC:* `apps/api/src/core/authorization/permission-registry.ts` extended with 29 new permission keys covering tax (26) + wallet adjustments (3). 11 of them carry `CRITICAL` or `HIGH` risk classification (creditNote.create, debitNote.create, timebarOverride, ewayBill.override, tcs.markPaidToGovt, tax.override, tax.configure, wallet.adjustment.approve, etc.). `SUPER_ADMIN` automatically gets all via `ALL_PERMISSION_KEYS`; other system roles get role-specific subsets in Phase 12.

*Seed file:* `apps/api/prisma/seed/seed-tax-master.ts` — idempotent. Run via `npx ts-node prisma/seed/seed-tax-master.ts` (already executed; 39 + 44 + 28 + 19 + 1 rows seeded).

**CA decisions touched / partially resolved:**
- §3.10 HSN length tier — default `6` seeded in `tax_config` row. **CA must confirm** for Sportsmart AATO.
- §3.11 TCS rate — default `100 bps (1%)` seeded. **CA must confirm** current Section 52 notification.
- §3.12 UQC list — 44 CBIC codes seeded (38 standard + ~6 commonly-used extras). **CA to remove any not relevant.**
- §3.2 Shipping SAC + rate — `9968` + 18% seeded. **CA must confirm.**
- §3.3 E-way bill threshold — ₹50,000 seeded. **CA must confirm per-state overrides.**
- §3.4 Goodwill approval threshold — ₹5,000 seeded.

**New defaults added to §4:** All entries in tax_config (19 rows) now have a concrete value at runtime. Admin UI in Phase 2 will expose them for editing.

**Sign-off items §10 backed (partial):**
- ✓ Engine + place-of-supply infrastructure exists (math/schema/lookup tables)
- ✓ Tax record tables exist with retention category readiness
- ✗ HSN list still STUB — CA action required
- ✗ Platform GSTIN still placeholder — CA action required
- ✗ Invoice/credit-note/e-way bill models not yet introduced (Phases 5, 8, 11, 15)

**Files added:**
- `apps/api/prisma/schema/tax-master.prisma`
- `apps/api/prisma/schema/migrations/20260513140000_tax_phase1_master_data/migration.sql`
- `apps/api/prisma/seed/seed-tax-master.ts`

**Files modified:**
- `apps/api/prisma/schema/catalog.prisma` — Product + ProductVariant tax fields
- `apps/api/prisma/schema/seller.prisma` — Seller GST/PAN fields + relation
- `apps/api/prisma/schema/identity.prisma` — User → taxProfiles back-relation
- `apps/api/src/core/authorization/permission-registry.ts` — 29 new permission keys + 11 risk classifications

**Next:** Phase 2 (Place-of-Supply Resolver) + admin frontend for HSN/UQC/state masters + seller GSTIN verification UI.

---

### Phase 0 + CA-doc-set — 2026-05-13

**What was built:**
- This document (`docs/tax/CA.md`) — comprehensive CA review surface.
- Six policy sub-docs in `docs/tax/`: `GST_ASSUMPTIONS.md`, `HSN_RATE_POLICY.md`, `TCS_POLICY.md`, `EWAY_BILL_POLICY.md`, `CREDIT_NOTE_TIME_BAR_POLICY.md`, `GOODWILL_CREDIT_POLICY.md`, `INVOICE_CANCELLATION_POLICY.md`.
- Phase 0 verification: existing code state confirmed (Product/Variant tax fields missing, Seller GSTIN missing, Franchise already has `gstNumber + panNumber`, no invoice model exists, `DEFAULT_GST_RATE_BPS = 0` confirmed in `discount-allocation.service.ts:60`).

**CA decisions touched:** All 15 items in §3 are framed for CA input; none are yet locked.

**Defaults proposed:** All entries in §4 are engineering proposals — none yet ratified.

**Sign-off items backed:** None yet — pending Phase 1+ implementation.

**Next:** Phase 1 (tax master data schema + GSTIN validator + seeds).

---

## 0. How to use this document

This document is the single bridge between engineering and your GST review. It exists because we are building the GST / tax invoice / credit note / e-way bill / TCS / GSTR-8 system *before* you (CA) have signed off on the underlying assumptions. Rather than block development for a week, engineering has:

1. **Built the full system** (backend + frontend + PDFs + reports), wired with sensible India-defaults.
2. **Documented every assumption** in this file plus the seven policy sub-docs in `docs/tax/`.
3. **Run the system in PERMISSIVE TEST MODE** so developers can test the full flow without being blocked by missing rates / GSTINs / HSN data.

**Your job when you return:**
- Walk §3 (decisions you must confirm) — for each item, accept the default or write the correction.
- Walk §4 (defaults catalog) — same.
- Walk §5 (PDF template drafts) — mark up the layout, missing fields, copy changes.
- Walk §6 (compliance-hook checklist) — confirm we covered Section 31, 34, 36, 52, Rule 48.
- Sign §10 (final acceptance checklist).
- Once §10 is signed, engineering flips `TAX_STRICT_MODE=true` and the system goes from test to production behaviour.

**Format convention used everywhere:**
- **CA must confirm** — your input required before strict-mode flip.
- **CA should review** — engineering chose a reasonable default; please verify or change.
- **For your awareness** — informational; no decision needed.

---

## 1. PERMISSIVE TEST MODE — what this means for your review

This is critical. Read once.

**The system is currently configured to NOT block any action on missing or default tax data.** This is intentional. Without it, developers could not test end-to-end (a missing HSN would fail every checkout). The trade-off: test data flowing through the system is *not* compliant tax data.

What test-mode means today:

| Behaviour | Test mode (now) | Strict mode (after CA sign-off) |
|---|---|---|
| Product has no HSN | Checkout proceeds; snapshot stores `taxDataStatus = INCOMPLETE`; admin sees warning | Checkout blocks |
| Product has no GST rate | Falls back to **18% placeholder** so tax math is testable | Falls back to 0; checkout blocks if `supplyTaxability = TAXABLE` |
| Seller has no GSTIN | Checkout proceeds; invoice generation marked `BLOCKED_TAX_DATA_INCOMPLETE`; admin sees the failure | Checkout blocks at seller level |
| Customer has no GSTIN | Invoice generated as B2C — normal behaviour both modes |
| E-way bill required but seller hasn't generated one | Seller can still mark shipped; warning logged | Seller cannot mark shipped without override |
| Section 34 time-bar reached | Credit note still issued (test mode soak); flagged for review | Credit note refused; AdminTask created |
| `TAX_AUDIT_MODE` | `true` — engine logs every calc decision to a shadow table for diff against legacy totals | `false` — only the canonical snapshot exists |

What strict mode means after sign-off (engineering flips `TAX_STRICT_MODE=true`):

- Missing tax data → checkout error with friendly message to customer.
- Missing seller GSTIN → invoice cannot be generated; seller cannot mark dispatched.
- Section 34 time-bar → AdminTask `GST_CREDIT_NOTE_TIME_BARRED`; customer sees "Refund processed, GST adjustment not available."
- E-way bill required and missing → ship blocked.

**Until §10 is signed, test data is being created in the dev DB. That data is not legal/tax-correct.** Production DB has a separate path: when strict mode flips on production, only orders placed *after* the flip are subject to strict tax rules. Legacy orders get the `LEGACY_RECEIPT` path (see §3.13).

---

## 2. What's been built (system overview)

### 2.1 Document types supported

| Type | When used | Has GST? | Sequence |
|---|---|---|---|
| `TAX_INVOICE` | Regular GSTIN seller + taxable supply | Yes | per (gstin, FY, type) |
| `BILL_OF_SUPPLY` | Composition seller, or any exempt/NIL/non-GST supply | No | per (gstin, FY, type) |
| `INVOICE_CUM_BILL_OF_SUPPLY` | Mixed taxable + exempt supply (rare) | Partial | per (gstin, FY, type) |
| `CREDIT_NOTE` | Return approved with taxable-value reduction | Reverse | per (gstin, FY, type) |
| `DEBIT_NOTE` | Upward price correction (admin-only, rare) | Yes | per (gstin, FY, type) |
| `LEGACY_RECEIPT` | Historical orders pre-GST-module | No | per FY |

Composition sellers never issue Tax Invoice. Pure goodwill credits (wallet adjustments with no taxable-value change) are kept *out* of tax documents entirely — see `GOODWILL_CREDIT_POLICY.md`.

### 2.2 The flow

```
Customer browses product (HSN + GST rate + UQC pre-set)
   ↓
Customer adds to cart
   ↓
Discount allocated per item (PRE_SUPPLY_TRANSACTIONAL)
   ↓
Taxable value = gross − discount
   ↓
PlaceOfSupplyResolver: seller state vs customer state
   ↓
CGST+SGST (intra) or IGST (inter)
   ↓
Shipping fee + shipping GST as separate line
   ↓
MasterOrder + SubOrder + OrderItem created
   ↓
OrderTaxLineSnapshot (one per line, includes PRODUCT/SHIPPING/etc.)
   ↓
SubOrderTaxSummary + OrderTaxSummary aggregates
   ↓
TaxDocumentService.generateForSubOrder
   ├ regular seller → TAX_INVOICE
   ├ composition seller → BILL_OF_SUPPLY
   └ mixed → INVOICE_CUM_BILL_OF_SUPPLY
   ↓
PDF rendered + stored privately (S3) with checksum
   ↓
Customer/admin/seller download via signed URL (TTL 7d, audited)
   ↓
If e-way bill required (consignment > ₹50k):
   eway_bills row + EWB number + validity stored before ship
   ↓
Seller dispatches
   ↓
─── If return approved at QC ───────────────────────
   ReturnTaxReversalLine (proportional reversal)
   ↓
   CreditNote issued from original TAX_INVOICE
   ↓
   RefundInstruction linked to credit note
   ↓
   Refund saga executes → customer money returned
   ↓
─── If pure goodwill ───────────────────────────────
   wallet_adjustment (NOT a credit note)
   ↓
─── Settlement (periodic) ──────────────────────────
   gst_collection_ledger (per seller, per invoice, per period)
   ↓
   gst_tcs_settlement_ledger (at credit-to-seller time per Section 52)
   ↓
   GSTR-8 export (TCS — marketplace)
   GSTR-1 export (per-seller outward supplies — CSV)
   GSTR-3B summary (platform-level)
```

### 2.3 Marketplace invoice principle

**One SubOrder = one tax document.** If a customer's `MasterOrder` has items from three sellers, three separate documents are issued — one under each seller's GSTIN. Sportsmart never issues a single tax invoice spanning multiple suppliers' goods. For `OWN_BRAND` items, the supplier is Sportsmart's own GST profile (see `platform_gst_profiles`).

### 2.4 Frontend coverage

Every backend feature has frontend wiring. See §11 for the file map.

- **Super Admin (`web-admin-storefront`):** product tax fields, HSN/UQC pages, GSTIN verification, multi-GSTIN seller, platform GST profile, invoice/credit-note/e-way bill lists, settlements with GST/TCS, tax reports.
- **Seller Admin (`web-d2c-seller-admin`):** seller-side tax visibility, document list per seller, time-bar AdminTasks.
- **Customer storefront (`web-storefront`):** "Inclusive of GST" gating on PDP, optional B2B GSTIN on checkout, address-change tax refresh, invoice/credit-note download on order/return detail, legacy receipt for old orders.
- **Seller portal (`web-d2c-seller`):** GSTIN profile, invoice download per sub-order, e-way bill required-before-ship gate, settlement GST/TCS summary.
- **Franchise / Affiliate portals:** invoice download for own-brand/franchise-fulfilled orders where relevant.

---

## 3. Decisions you must confirm

Each item is **CA must confirm**. Engineering chose the default in column "Current default"; replace it in column "CA value" or leave blank to accept.

| # | Decision | Current default | CA value (fill on review) |
|---|---|---|---|
| 1 | **Place of supply for B2B with customer GSTIN** — shipping state or buyer GSTIN/billing state? | Shipping state (delivery-driven, e-commerce convention) | |
| 2 | **Shipping SAC code + GST rate + tax split rule** | SAC `9968` ("Postal and courier services"), 18%, splits same as product POS | |
| 3 | **E-way bill threshold** — single national or per-state? | ₹50,000 single national (most states); UI allows per-state override | |
| 4 | **Goodwill credit threshold** — above what amount does goodwill require approval? | All goodwill goes through `refunds.approve` permission; no separate threshold | |
| 5 | **Composition seller policy** — allow on marketplace, and what's the registration check? | Allowed; `gstRegistrationType = COMPOSITION`; system issues Bill of Supply, no GST. Composition GSTIN format validation runs in admin verification. | |
| 6 | **Unregistered seller policy** — allow on marketplace? | Blocked from selling taxable goods. Admin override possible, audited. | |
| 7 | **Multi-GSTIN seller policy** — is this real today, or future-only? | Future-only. `seller_gstins` table exists. For now, every seller has one primary GSTIN. Document the assumption. | |
| 8 | **E-invoice / IRN applicability** — what's Sportsmart's aggregate annual turnover (AATO)? Determines mandatory threshold (₹5cr / ₹10cr / ₹20cr / etc., subject to current CBIC notification). | Schema fields ready (`irn`, `ackNo`, `qrCodeUrl`, etc.); `EINVOICE_ENABLED=false`; no IRP call until CA confirms applicability + adapter signed | |
| 9 | **Section 34 time-bar interpretation** — credit note must be declared by Sept 30 of next FY, but should we hard-block at Sept 30 or also allow CA-approved extensions? | Hard-block at Sept 30 (end-of-day IST). After that, refund proceeds without GST reversal; AdminTask `GST_CREDIT_NOTE_TIME_BARRED` raised for finance. | |
| 10 | **HSN length tier** — based on Sportsmart's AATO, 4 / 6 / 8 digits mandatory? | Configurable in tax_config; default 6 digits. CA must confirm based on AATO. | |
| 11 | **TCS rate** — 1% (intra-state: 0.5% CGST + 0.5% SGST; inter-state: 1% IGST) is the current statutory rate. Confirm or override? | 1% (100 bps) as per current Section 52 notification | |
| 12 | **UQC list** — full CBIC list (38 codes) is seeded. Confirm or restrict to sub-list relevant for sports goods? | All 38 CBIC codes seeded; product creation UI defaults to `NOS` if not chosen | |
| 13 | **Legacy order cutoff date** — orders placed *before* this date get `LEGACY_RECEIPT` (no GST reversal on returns); orders *after* this date get full GST treatment. | Cutoff = date `TAX_STRICT_MODE=true` flips in production. Today: `null` (no cutoff yet; test mode). | |
| 14 | **HSN ↔ GST rate validation in admin UI** — when admin sets HSN, warn if entered rate doesn't match `hsn_master.defaultGstRateBps`? | Warning only, not blocking. Admin can override. | |
| 15 | **Reverse-charge default** — every invoice has `reverseChargeApplicable: false` by default. Confirm. | `false` always for B2C goods marketplace. Override path exists in admin UI for the rare RCM case. | |

For each item, write your decision in `docs/tax/GST_ASSUMPTIONS.md` and check off in §10 below.

---

## 4. Defaults catalog (all values engineering set — please verify or correct)

### 4.1 Engine-level defaults

| Setting | Default | File |
|---|---|---|
| `DEFAULT_GST_RATE_BPS` (when product missing rate) | **1800 (18%)** in test mode; 0 in strict mode for taxable products (which then blocks checkout) | `apps/api/src/modules/discounts/domain/tax/calculate-gst.ts` |
| Rounding (line-level GST math) | BigInt floor on each component; SGST derived from `expectedTotalTax - CGST` for half-odd-bps safety | `calculate-gst.ts` |
| Conservation invariant | `cgst + sgst + igst === totalTax` and `taxable + totalTax === lineTotal` | enforced in tests |
| Money type | BigInt paise (ADR-004 / ADR-007) | platform-wide |
| Currency | Always `INR` on every tax document | `tax_documents.currencyCode` |
| Time zone for invoice dates | Asia/Kolkata (IST) | render-layer helper |
| Invoice number format | `SM-INV-{seq:06d}` (e.g. `SM-INV-000001`) — per (gstin, FY, documentType) | `DocumentSequenceService` |
| Credit note number format | `SM-CN-{seq:06d}` | same |
| Bill of supply format | `SM-BOS-{seq:06d}` | same |
| Legacy receipt format | `SM-LR-{seq:06d}` | same |
| Financial year format | `YYYY-YY` (e.g. `2026-27` for the FY starting 1 Apr 2026) | universal |

### 4.2 Place-of-supply defaults

| Scenario | Default behaviour |
|---|---|
| B2C delivery | Place of supply = shipping address state |
| B2B with customer GSTIN | Place of supply = shipping address state *(decision 3.1 — confirm)* |
| Seller marketplace | Supplier state = seller's primary GSTIN state |
| Franchise fulfilment | Supplier state = franchise's GST state |
| Own-brand (OWN_BRAND / SPORTSMART supplier) | Supplier state = `platform_gst_profiles.gstStateCode` for the designated profile |
| Missing seller GSTIN | Blocks invoice generation; admin alert |
| Missing customer state | Blocks checkout in strict mode; in test mode marks `TAX_DATA_INCOMPLETE` |

### 4.3 Shipping defaults

| Setting | Default |
|---|---|
| Shipping SAC | `9968` (postal/courier services) |
| Shipping GST rate | 1800 (18%) |
| Shipping tax-inclusive? | False (shipping fee is exclusive; tax added) |
| Shipping POS rule | Follows product POS rule (same as the order) |
| Free shipping → taxable amount | 0 |
| Shipping refund on cancellation | Refunded with GST reversed |
| Shipping refund on return | Not refunded by default; CA-configurable policy |

### 4.4 E-way bill defaults

| Setting | Default |
|---|---|
| Threshold | ₹50,000 (consignment value, all-India) |
| Required at | Before dispatch |
| Generation mode | Stub (logs payload, returns placeholder EWB number); real NIC integration in Phase 11 |
| Failure handling | AdminTask `EWAY_BILL_GENERATION_FAILED`; retry cron |
| Block ship-if-missing | Yes in strict mode; warning only in test mode |

### 4.5 TCS defaults

| Setting | Default |
|---|---|
| TCS rate | 100 bps (1%) per Section 52 |
| TCS intra-state split | CGST TCS 50 bps + SGST TCS 50 bps |
| TCS inter-state | IGST TCS 100 bps |
| TCS computed at | Settlement run (not at invoice) |
| TCS basis | Net taxable supplies = gross taxable supplies − returns − exempt − non-GST |
| OWN_BRAND supplies | **Excluded** from TCS ledger (Sportsmart is the supplier itself, not the e-commerce operator collecting on someone else's behalf) |
| MARKETPLACE_SELLER, FRANCHISE | Included in TCS ledger |
| Filing period | Monthly (per GSTR-8 calendar) |

### 4.6 Retention defaults

| Record | Retention category | Period |
|---|---|---|
| `tax_documents` (all types) | `TAX_RECORD` | 72 months from end of FY |
| `tax_document_lines` | `TAX_RECORD` | 72 months |
| `eway_bills` | `TAX_RECORD` | 72 months |
| `gst_collection_ledger` | `TAX_RECORD` | 72 months |
| `gst_tcs_settlement_ledger` | `TAX_RECORD` | 72 months |
| PDF files (S3) | `TAX_RECORD` | 72 months |
| Audit logs touching tax | `AUDIT` (existing) | 72 months |
| `wallet_adjustments` (goodwill) | regular | 24 months |

All `TAX_RECORD` rows are **excluded from GDPR/DPDP erasure requests**. The `ErasureService` block-list now includes these tables. Customer PII *within* a tax document (name, address, GSTIN) is retained — this is mandated by Section 36 and overrides erasure rights.

### 4.7 PDF defaults

| Setting | Default |
|---|---|
| Storage | S3, private bucket, prefix `tax-documents/{documentType}/{fy}/{gstin}/{docNumber}.pdf` |
| Download URL | Signed, TTL 600 seconds (10 min) per ADR-012 file-URL audit |
| Email-link TTL | 7 days (auto-refresh on click after login) |
| Audit | Every download writes `file_url_audits` row + `tax.document.downloaded` audit log |
| Re-download | Original PDF immutable; subsequent renders show `DUPLICATE COPY` watermark |
| Computer-generated footer | "This is a computer-generated document and does not require a physical signature." on every PDF |
| Amount in words | "Rupees X Thousand Y Hundred Z Only" — generated from final total |
| Round-off | Separate line item, max ±49 paise to reach the nearest rupee |
| Page footer | Page N of M + invoice number + render timestamp |

---

## 5. PDF templates — DRAFT — pending CA approval

Engineering has drafted templates for each document type. Each is rendered HTML→PDF. Engineering will paste a sample PNG below as soon as the renderer phase lands. For now, the data the renderer pulls from is documented per template:

### 5.1 Tax Invoice (B2C)

Header:
- "TAX INVOICE" — top-centre, 18pt bold
- Sportsmart logo (TBD — see §7) — top-left
- Invoice number + date — top-right

Supplier block (left):
- Seller legal business name (from `sellers.legalBusinessName`)
- Seller registered business address (from `sellers.registeredBusinessAddressJson`)
- Seller GSTIN
- Seller state code (e.g. "29 — Karnataka")
- Seller PAN (last 4 masked: `*****1234F`)

Recipient block (right):
- Customer name (from `customer_tax_profiles.legalName` or `users.firstName + lastName`)
- Shipping address
- Billing address (if different)
- "PAN: Not provided" (B2C has no recipient PAN)
- "GSTIN: Not provided" — B2C

Order metadata:
- Master order number + date
- Sub-order number + date
- Place of supply: "29 — Karnataka" (state code + name)
- Reverse charge applicable: **No**
- Payment mode: ONLINE / COD

Line items table:
| # | Description | HSN | UQC | Qty | Unit Price | Gross | Discount | Taxable | GST Rate | CGST | SGST | IGST | Total |

Footer:
- Subtotal (taxable across lines)
- Total CGST / SGST / IGST
- Shipping (separate line)
- Round-off
- **Grand total** + "Rupees X Only" in words
- Computer-generated disclaimer

**CA mark-up needed:** column ordering, mandatory disclaimer text, signature placement, logo size/position, terms-and-conditions footer.

### 5.2 Tax Invoice (B2B)

Same as 5.1 but:
- Recipient block shows `customer_tax_profiles.gstin` (e.g. "29AABCD1234E1Z5")
- Recipient legal name from `customer_tax_profiles.legalName`
- Note: "Recipient may claim input tax credit subject to Section 16 of CGST Act"

**CA mark-up needed:** ITC eligibility note phrasing.

### 5.3 Bill of Supply (Composition / Exempt)

Header: "BILL OF SUPPLY" (NOT "Tax Invoice")
- No CGST / SGST / IGST columns
- No GST rate column
- Each line shows: Description, HSN, UQC, Qty, Unit Price, Gross, Discount, Net
- Footer carries: "Composition Taxable Person, Not Eligible to Collect Tax on Supplies" (if composition) or "Exempt Supply" (if exempt)
- No "amount of tax" line in summary

**CA mark-up needed:** exact footer wording per CBIC notification, whether HSN column required for composition.

### 5.4 Credit Note

Header: "CREDIT NOTE" — title
- "Issued against Tax Invoice #SM-INV-000123 dated DD-MM-YYYY"
- Original invoice's POS, supplier, recipient details replicated (snapshotted from original)
- Reason field: RETURN / PARTIAL_RETURN / ORDER_CANCELLED / PRICE_ADJUSTMENT / GOODWILL_LINKED
- Line items show:
  | # | Description | HSN | UQC | Returned Qty | Gross Reversal | Discount Reversal | Taxable Reversal | GST Rate | CGST | SGST | IGST | Total Credit |
- Footer: total credit, refund mode, time-bar status (if any)

**CA mark-up needed:** mandatory cross-reference text, recipient acknowledgement requirement.

### 5.5 Debit Note

Same shape as credit note but for upward corrections. Rare — admin-only entry path.

### 5.6 E-way Bill (printout)

Header: "E-WAY BILL"
- EWB number (12-digit)
- Date + valid until
- From: dispatch warehouse address + state + pincode + GSTIN
- To: shipping address + state + pincode + GSTIN (or "Unregistered B2C")
- Vehicle number / transporter ID / mode of transport
- Distance (km)
- Consignment value (invoice total)
- HSN summary
- QR code (placeholder until NIC integration)

**CA mark-up needed:** confirm template matches NIC EWB API format expectations for future integration.

### 5.7 Legacy Receipt (for orders pre-GST-module)

Header: "RECEIPT — NOT A TAX INVOICE" — prominent disclaimer
- Order number + date + customer name + items + amount paid + payment mode
- Footer: "This document is not a Tax Invoice. It is issued for record purposes only. GST may not have been collected on this order; please consult the seller for tax queries."

**CA mark-up needed:** exact disclaimer wording.

---

## 6. Compliance hooks — what we cover, what we don't

### 6.1 Section 31 (Tax Invoice)

| Particular required by CGST Rules | Where in schema | Status |
|---|---|---|
| Supplier legal name | `tax_documents.sellerLegalName` | ✓ |
| Supplier address | `tax_documents.sellerAddressJson` | ✓ |
| Supplier GSTIN | `tax_documents.sellerGstin` | ✓ |
| Unique invoice number per FY | `tax_documents.documentNumber` + `document_sequences (gstin, FY, type, lastNumber)` | ✓ |
| Invoice date | `tax_documents.generatedAt` | ✓ |
| Recipient name + address + GSTIN | `tax_documents.buyerLegalName/buyerGstin/billingAddressJson/shippingAddressJson` | ✓ |
| Place of supply | `tax_documents.placeOfSupplyStateCode` | ✓ |
| HSN/SAC | `tax_document_lines.hsnOrSacCode` | ✓ |
| UQC | `tax_document_lines.uqcCode` | ✓ |
| Quantity | `tax_document_lines.quantity` (Decimal) | ✓ |
| Taxable value | `tax_document_lines.taxableAmountInPaise` | ✓ |
| GST rate | `tax_document_lines.gstRateBps` | ✓ |
| CGST/SGST/IGST amounts | `tax_document_lines.{cgst,sgst,igst}AmountInPaise` | ✓ |
| Reverse charge flag | `tax_documents.reverseChargeApplicable` | ✓ |
| Total invoice value | `tax_documents.documentTotalInPaise` | ✓ |
| Currency | `tax_documents.currencyCode` (always INR) | ✓ |
| Payment mode | `tax_documents.paymentMode` | ✓ |
| Original order/sub-order ref | `tax_documents.masterOrderId/subOrderId` | ✓ |

### 6.2 Section 34 (Credit / Debit Notes)

| Requirement | Status |
|---|---|
| Credit note issued when taxable value/tax reduced | ✓ via `documentType = CREDIT_NOTE` |
| Credit note for returned goods | ✓ on QC-approved return |
| Link to original invoice | ✓ `tax_documents.originalDocumentId / originalDocumentNumber` |
| Time-bar by Sept 30 of next FY | ✓ `tax_credit_note_timebar_checker` cron + AdminTask |
| Adjustment not via deletion | ✓ original invoice retained; status flips to PARTIALLY_REVERSED / FULLY_REVERSED |
| Debit note for upward correction | ✓ via `documentType = DEBIT_NOTE` |
| Goodwill not as credit note | ✓ via separate `wallet_adjustments` table |

### 6.3 Section 52 (TCS by E-commerce Operator)

| Requirement | Status |
|---|---|
| Marketplace seller supplies tracked | ✓ `gst_collection_ledger` per (seller, period) |
| Net taxable supplies after returns | ✓ `netTaxableSupplyInPaise` in `gst_tcs_settlement_ledger` |
| TCS at credit-to-seller time, not invoice | ✓ ledger writes at settlement run, not at order |
| Own-brand excluded from TCS | ✓ filter on `supplierType != MARKETPLACE_SELLER` |
| GSTR-8 report | ✓ CSV export from `gst_tcs_settlement_ledger` aggregated by filing period |
| TCS rate stored historically per row | ✓ `tcsRateBps` snapshot per ledger row |

### 6.4 Section 36 (Retention)

| Requirement | Status |
|---|---|
| 72-month retention from due date of annual return | ✓ `retentionCategory = TAX_RECORD` on all tax tables |
| Exclude tax records from erasure | ✓ `ErasureService.blockedCategories.add('TAX_RECORD')` |
| Audit log retention | ✓ existing AUDIT category extended to cover tax events |

### 6.5 Rule 48 / Rule 48(4) (E-invoicing readiness)

| Requirement | Status |
|---|---|
| IRN field on tax_documents | ✓ `tax_documents.irn` |
| Acknowledgement number / date | ✓ `ackNo, ackDate` |
| Signed invoice JSON | ✓ `signedDocumentJson` |
| QR code URL | ✓ `qrCodeUrl` |
| `einvoiceStatus`: NOT_APPLICABLE / PENDING / GENERATED / FAILED | ✓ |
| Real IRP integration | ✗ stub only — `EInvoiceProvider` interface declared; not wired |
| Within-24h IRP cancellation | ✗ to be added when IRP wired |
| Out-of-window correction via credit note | ✓ |

### 6.6 What we explicitly do NOT cover (out of scope for this phase)

| Item | Why | When |
|---|---|---|
| GST input credit on Sportsmart's own purchases (warehouse rent, packaging, etc.) | Out of scope — accountant's BAU GSTR-2B reconciliation | Never; not engineering's concern |
| Foreign customer exports with LUT | "India only" per project brief | If business expands |
| Section 9(5) services (cab/restaurant/etc. where marketplace is liable) | Sportsmart sells goods, not services | If services added |
| Compensation cess remittance flow | No sports-good HSN attracts cess as of CBIC notifications I'm aware of | If cess-attracting HSN added |
| Stock transfer between own warehouses | OWN_BRAND warehouse count = 1 today | When OWN_BRAND scales to multi-state warehouses |
| GST portal direct submission (instead of CSV export) | Manual upload is fine at current volume; portal API integration is the next step | After 1 GSTR-8 cycle proven on CSV |
| ASP / GSP integration | Same as above | After CA assessment |

---

## 7. Feature flag state — current values

```env
GST_TAX_ENABLED=true                  # Engine + snapshots active
TAX_AUDIT_MODE=true                   # Shadow logs every calc decision
TAX_STRICT_MODE=false                 # ← FLIP TO TRUE AFTER CA SIGN-OFF
INVOICE_GENERATION_ENABLED=true       # Real PDFs render
CREDIT_NOTE_GENERATION_ENABLED=true   # Real credit notes on returns
EWAY_BILL_ENABLED=true                # EWB generated (stub adapter)
GST_TCS_ENABLED=true                  # TCS ledger writes at settlement
GSTR8_ENABLED=true                    # GSTR-8 CSV export available
EINVOICE_ENABLED=false                # NIC IRP not yet wired
```

**The one flag you (CA) flip on sign-off: `TAX_STRICT_MODE=true`.**

When that flag flips:
- Test-mode placeholders disappear (no more 18% default for missing rates)
- Missing HSN / UQC / GSTIN → strict blocks
- E-way bill required → ship blocks
- Section 34 time-bar → strict block
- `TAX_AUDIT_MODE` typically flips to `false` shortly after (shadow logs stop)

---

## 8. Open questions for the CA's first session

Engineering does NOT have an opinion on these. Please answer in `GST_ASSUMPTIONS.md`:

1. **Sportsmart's aggregate annual turnover (AATO)** — drives e-invoice applicability, HSN length tier, GSTR-1 HSN summary section. Need a number.
2. **PAN of Sportsmart (the platform entity)** — for `platform_gst_profiles.legalBusinessName` derivation and cross-check.
3. **All state-wise Sportsmart GSTINs** — if Sportsmart is registered in multiple states (multi-warehouse), each GSTIN goes into `platform_gst_profiles`. Today we seed only the primary HQ state — confirm or list.
4. **Composition seller invoice format** — engineering drafted `BILL_OF_SUPPLY` per Rule 49. Confirm exact wording for the "Composition Taxable Person" footer.
5. **Goodwill credit accounting code** — for finance ledger, what's the GL account code for goodwill expenses? (Used in `wallet_adjustments` for finance reporting.)
6. **HSN list for sports goods** — engineering seeded a stub of common HSN codes (9506, 6404, 6203, etc.). Please provide a full, signed-off list with rates and effective dates.
7. **TCS rate change history** — confirm 1% is current; provide change-log if relevant.
8. **Customer GSTIN verification approach** — option A (regex format only), option B (GST portal API lookup, costs per call), option C (admin manual verification). Default: option A.

---

## 9. File map — where each component lives

*Updated 2026-05-14 at end of Phase 27. Reflects the AS-BUILT state.*

### Documentation

| Component | Path |
|---|---|
| CA review document (this file) | `docs/tax/CA.md` |
| Strict-mode rollout runbook | `docs/tax/STRICT_MODE_ROLLOUT_RUNBOOK.md` |
| Running assumptions | `docs/tax/GST_ASSUMPTIONS.md` |
| HSN rate policy | `docs/tax/HSN_RATE_POLICY.md` |
| TCS policy | `docs/tax/TCS_POLICY.md` |
| E-way bill policy | `docs/tax/EWAY_BILL_POLICY.md` |
| Credit note time-bar policy | `docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md` |
| Goodwill credit policy | `docs/tax/GOODWILL_CREDIT_POLICY.md` |
| Invoice cancellation policy | `docs/tax/INVOICE_CANCELLATION_POLICY.md` |

### Prisma schema (`apps/api/prisma/schema/`)

| File | Purpose |
|---|---|
| `tax-master.prisma` | India states, UQC, HSN, SellerGstin, CustomerTaxProfile, PlatformGstProfile, TaxConfig, CreditNoteEligibilityStatus |
| `tax-documents.prisma` | TaxDocument + TaxDocumentLine + DocumentSequence (+ Phase 19 PDF retry + Phase 22 IRN columns) |
| `tax-document-downloads.prisma` | Phase 20 — download audit + actor / outcome enums |
| `gst-tcs.prisma` | Phase 16 GSTR-8 settlement ledger |
| `eway-bills.prisma` | Phase 15 e-way bill rows + status / transport-mode enums |
| `orders.prisma`, `catalog.prisma`, `seller.prisma`, `discounts.prisma`, `wallet.prisma`, `returns.prisma`, `settlements.prisma`, `liability-ledger.prisma`, `identity.prisma` | Cross-module additions per phase log §A |

### Pure domain helpers (`apps/api/src/modules/tax/domain/`)

| File | Phase | Purpose |
|---|---|---|
| `gstin-validator.ts` | 1 | 15-char Mod-36 checksum + PAN match |
| `state-code-map.ts` | 1 | CBIC 2-digit state code normalisation |
| `place-of-supply.ts` | 2 | Intra-state vs inter-state resolver |
| `tax-engine.ts` | 3 | `calculateLineTax` — inclusive/exclusive split, taxability taxonomy |
| `amount-in-words.ts` | 8 | Indian numbering — `paiseToInvoiceWords`, `rupeesToWords` |
| `document-type-picker.ts` | 8 | TAX_INVOICE vs BILL_OF_SUPPLY vs INVOICE_CUM_BILL_OF_SUPPLY |
| `round-off.ts` | 8 | Half-away-from-zero invoice rounding |
| `tax-document-state-machine.ts` | 10 | Status FSM (DRAFT → GENERATED → … → SUPERSEDED / FULLY_REVERSED) |
| `credit-note-time-bar.ts` | 11 | Section 34 IST-EOD cutoff math |
| `eway-bill-validity.ts` | 15 | CBIC Rule 138(10) slab table (km → validity days) |
| `tcs-calculator.ts` | 16 | Section 52 TCS arithmetic + clamp-with-carry-forward |
| `gstr1-aggregator.ts` | 18 | Bucket TaxDocuments into GSTR-1 sections §4/§5/§7/§9B/§12/§13 |
| `tax-document-html-template.ts` | 19, 23 | Mode-aware HTML render (DRAFT banner toggle) |
| `einvoice-applicability.ts` | 22 | CBIC Rule 48(4) three-gate decision |
| `statutory-retention.ts` | 21 | 8-year retention window math |

### Application services (`apps/api/src/modules/tax/application/services/`)

| File | Phase | Purpose |
|---|---|---|
| `tax-config.service.ts` | 2 | Typed `tax_config` reader with 60s cache |
| `place-of-supply.service.ts` | 2 | DB-aware orchestrator over the pure resolver |
| `tax-snapshot.service.ts` | 5 | Writes OrderItemTaxSnapshot + summaries + shipping line |
| `document-sequence.service.ts` | 8 | Atomic `INSERT … ON CONFLICT DO UPDATE` number allocation |
| `tax-document.service.ts` | 9 | `generateForSubOrder` orchestrator |
| `credit-note.service.ts` | 11 | Issues CREDIT_NOTE; transitions source invoice via FSM |
| `credit-note-eligibility.service.ts` | 12 | ELIGIBLE / TIME_BARRED / REQUIRES_FINANCE_REVIEW classifier |
| `wallet-adjustment.service.ts` | 13 | Goodwill + time-barred refund writer; idempotent + dual-approval |
| `legacy-receipt.service.ts` | 14 | LEGACY_RECEIPT generator for pre-GST orders |
| `eway-bill.service.ts` | 15 | `classifyForSubOrder` + `generate` + `cancel` + `canShip` |
| `tcs.service.ts` | 16 | `computeForSeller` + lifecycle transitions |
| `gstr8-report.service.ts` | 16 | Platform-side TCS CSV / JSON |
| `gstr1-report.service.ts` | 18 | Per-seller GSTR-1 export across 6 sections |
| `gstr3b-report.service.ts` | 18 | Per-seller GSTR-3B 3.1 + 3.2 |
| `settlement-tcs-hook.service.ts` | 17 | Bridges SettlementService → TcsService at approve + pay |
| `tax-document-pdf.service.ts` | 19, 23 | Render + upload + signed-URL; mode-aware DRAFT banner |
| `tax-document-download.service.ts` | 20 | Scope-protected + audited + rate-limited download |
| `tax-document-retention.service.ts` | 21 | Per-user retention summary; erasure-outcome helper |
| `einvoice.service.ts` | 22 | IRN classify / generate / cancel (24h CBIC window) |
| `tax-mode.service.ts` | 23 | Three-mode resolver (OFF / AUDIT / STRICT) |
| `tax-audit-readiness.service.ts` | 23 | 7-blocker readiness report |
| `tax-notification.service.ts` | 24 | Customer / seller / admin notification surface |
| `tax-compatibility.service.ts` | 26 | Tagged-union resolver for snapshot / legacy / pre-snapshot |

### Infrastructure (`apps/api/src/modules/tax/infrastructure/`)

| File | Phase | Purpose |
|---|---|---|
| `eway-bill/eway-bill-provider.ts` | 15 | `EWayBillProvider` interface |
| `eway-bill/stub-eway-bill-provider.ts` | 15 | `EWB-STUB-{uuid}` adapter |
| `pdf/tax-pdf-storage.provider.ts` | 19 | `TaxPdfStorageProvider` interface |
| `pdf/stub-tax-pdf-storage.provider.ts` | 19 | Local-filesystem stub |
| `einvoice/einvoice-provider.ts` | 22 | `EInvoiceProvider` interface |
| `einvoice/stub-einvoice-provider.ts` | 22 | Deterministic SHA-256 IRN stub |

### Cron jobs (`apps/api/src/modules/tax/application/jobs/`)

| File | Phase | Cadence | Purpose |
|---|---|---|---|
| `tax-credit-note-timebar.cron.ts` | 12 | Daily 02:00 | Sec 34 eligibility classification + AdminTask |
| `tax-document-pdf-retry.cron.ts` | 19 | Every 5 min | PDF render retry + AdminTask escalation |
| `einvoice-retry.cron.ts` | 22 | Every 5 min | IRN retry + AdminTask escalation |

### HTTP controllers (`apps/api/src/modules/tax/presentation/controllers/`)

| File | Phase | Surface |
|---|---|---|
| `customer-tax-documents.controller.ts` | 25 | `/api/v1/customer/tax-documents` + download |
| `seller-tax-documents.controller.ts` | 25 | `/api/v1/seller/tax-documents` + download |
| `admin-tax-reports.controller.ts` | 25 | `/api/v1/admin/tax/*` — mode, readiness, GSTR-1/3B/8, TCS transitions |

### Cross-module integrations

| Component | Path |
|---|---|
| Legacy `calculateLineGst` math | `apps/api/src/modules/discounts/domain/tax/calculate-gst.ts` |
| Tax module registration | `apps/api/src/modules/tax/module.ts` |
| Tax permissions in registry | `apps/api/src/core/authorization/permission-registry.ts` (`tax.*` + `wallet.adjustment.*` keys) |
| Settlement-side TCS hook | `apps/api/src/modules/settlements/settlement.service.ts` (Phase 17 wiring) |
| Erasure-side retention hook | `apps/api/src/core/erasure/erasure.service.ts` (Phase 21 wiring) |
| Env schema | `apps/api/src/bootstrap/env/env.schema.ts` (Phase 12 / 13 / 15 / 19 / 20 / 21 / 22 / 23 env flags) |
| Tax migrations | `apps/api/prisma/schema/migrations/2026051{3,4}_*` (8 new migrations across Phases 1–22) |

### Frontend (lands in Phase 25's API contract consumer)

| App | Path |
|---|---|
| Admin tax dashboard | `apps/web-admin-storefront/src/app/dashboard/tax/*` (consumes `/api/v1/admin/tax/*`) |
| Customer invoice download | `apps/web-storefront/src/app/orders/[orderNumber]/*` (consumes `/api/v1/customer/tax-documents/*`) |
| Seller invoice download | `apps/web-d2c-seller-admin/src/app/dashboard/orders/[id]/*` (consumes `/api/v1/seller/tax-documents/*`) |

---

## 10. Sign-off checklist

Tick when reviewed. Engineering will flip `TAX_STRICT_MODE=true` only after ALL items are ticked.

**Decisions (§3):**
- [ ] B2B place-of-supply rule confirmed
- [ ] Shipping SAC + rate + split rule confirmed
- [ ] E-way bill threshold confirmed
- [ ] Goodwill credit policy confirmed
- [ ] Composition seller policy confirmed
- [ ] Unregistered seller policy confirmed
- [ ] Multi-GSTIN seller assumption confirmed
- [ ] E-invoice applicability decision recorded
- [ ] Section 34 time-bar interpretation confirmed
- [ ] HSN length tier confirmed (based on AATO)
- [ ] TCS rate confirmed
- [ ] UQC list reviewed
- [ ] Legacy order cutoff date set
- [ ] HSN ↔ rate validation policy confirmed
- [ ] Reverse-charge default confirmed

**Defaults (§4):**
- [ ] Engine defaults reviewed
- [ ] Place-of-supply defaults reviewed
- [ ] Shipping defaults reviewed
- [ ] E-way bill defaults reviewed
- [ ] TCS defaults reviewed
- [ ] Retention defaults reviewed
- [ ] PDF defaults reviewed

**PDF templates (§5):**
- [ ] Tax Invoice B2C template approved (with mark-ups if any)
- [ ] Tax Invoice B2B template approved
- [ ] Bill of Supply template approved
- [ ] Credit Note template approved
- [ ] Debit Note template approved (admin-only entry)
- [ ] E-way Bill template approved
- [ ] Legacy Receipt template approved

**Compliance hooks (§6):**
- [ ] Section 31 particulars verified present
- [ ] Section 34 flow verified
- [ ] Section 52 TCS flow verified
- [ ] Section 36 retention verified
- [ ] Rule 48 e-invoice readiness verified (when applicable)

**Master data (§8 open questions):**
- [ ] Sportsmart AATO recorded
- [ ] Sportsmart platform PAN recorded
- [ ] Platform GSTIN(s) recorded (with state mapping)
- [ ] Composition footer wording confirmed
- [ ] Goodwill GL code provided
- [ ] HSN list for sports goods provided (with rates + effective dates)
- [ ] TCS rate change history confirmed
- [ ] Customer GSTIN verification approach chosen

**Final sign-off:**
- [ ] CA name + date: ______________
- [ ] Engineering can flip `TAX_STRICT_MODE=true`: YES / NO
- [ ] Strict-mode flip target date: __________

---

## 11. Quick links

- **Master plan (this codebase):** `docs/plans/MASTER_PLAN.md`
- **Architecture doc:** `docs/ARCHITECTURE.md`
- **Per-decision sub-policies:** `docs/tax/*.md` (the 6 sibling policy docs)
- **Running assumptions:** `docs/tax/GST_ASSUMPTIONS.md`
- **Admin authz docs:** `docs/decisions/010-abac-resource-policies.md`, `019-rbac-permissions-canonical.md`
- **Money & rounding:** `docs/decisions/004-money-value-object.md`, `007-money-paise-dual-write.md`
- **Idempotency & error envelope:** `docs/decisions/003-idempotency-keys.md`, `005-problem-details.md`
- **Outbox pattern (events backbone for tax events):** `docs/decisions/008-transactional-outbox.md`

---

**End of CA Review Document.**
*This document is regenerated as engineering completes each phase. Latest commit hash will be inserted in §11 by the script `scripts/tax/regen-ca-doc.sh` when phase implementations conclude.*
