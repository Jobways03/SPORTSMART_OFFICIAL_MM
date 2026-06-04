# Delhivery Integration — Gaps & Open Items

_Last updated: 2026-06-03_

Scope: the live Delhivery courier integration across `apps/api` (system of
record) and `apps/logistics-facade` (stateless courier proxy). This document
lists what is **missing or unproven**, separated from what is **intentional
design**. Companion docs: [`DELHIVERY_WIRING_STATUS.md`](./DELHIVERY_WIRING_STATUS.md)
(what's built), [`DELHIVERY_FLOW_AND_TEST.md`](./DELHIVERY_FLOW_AND_TEST.md),
[`LOGISTICS_TEST_GUIDE.md`](./LOGISTICS_TEST_GUIDE.md).

A **gap** = something missing that can cause wrong behavior, data loss, or a
production break. A **design choice** = intentional and working as-is — listed
at the bottom so it isn't re-litigated as a bug.

## Severity legend

- 🔴 **P1 — blocks production readiness** (resilience / money / compliance).
- 🟠 **P2 — needed for full feature parity** (works today but incomplete).
- 🟡 **P3 — cleanup / hardening** (no functional impact).

---

## 🔴 P1 — Block production readiness

### 1. No tracking reconciliation / poll cron
Shipment status is **100% webhook-driven**. `DelhiveryTrackingService.trackShipments()`
exists (`apps/logistics-facade/src/integrations/delhivery/services/delhivery-tracking.service.ts`)
and the api-side adapter exposes `track()`, but **nothing schedules a poll**. The
only cron in the shipping module is evidence retention
(`apps/api/src/modules/shipping/infrastructure/crons/shipment-evidence-retention.cron.ts:37`,
`@Cron(EVERY_DAY_AT_3AM)`).

- **Impact:** if Delhivery drops a webhook, botches a retry, or there's an
  outage on our side, that shipment's status **never self-heals**. A parcel can
  be delivered while our system still shows IN_TRANSIT indefinitely.
- **Fix:** add a scheduled job that polls open (non-terminal) AWBs through the
  facade `track` route and feeds results into the existing
  `IngestTrackingUpdateUseCase.ingestSingleSnapshot()` (same path webhooks use,
  so FSM + history stay consistent). The ingest source union already anticipates
  this — `'POLL_CRON'` is referenced in `ingest-tracking-update.use-case.ts`.

### 2. Never proven end-to-end against real Delhivery staging
Per `DELHIVERY_WIRING_STATUS.md` (Phase 4) the booking + webhook paths were
exercised with a **curl simulation**, not a live Delhivery staging round-trip.

- **Impact:** "works in dev with a fabricated payload" ≠ "works against
  Delhivery." Booking response parsing, label availability timing, and the
  webhook envelope are all unconfirmed against the real partner.
- **Fix:** book one real order through Delhivery staging (creds confirmed
  working) → AWB returned → real webhook → DELIVERED. Capture the real payloads
  while doing it (resolves Gap #3).

### 3. Webhook payload shape unverified against a real Delhivery push
The inbound handler's AWB/status field paths come from Delhivery's docs /
hand-authored DTO, **not a captured live payload** — stated explicitly in
`DELHIVERY_WIRING_STATUS.md:164-166`. Extraction is defensive (multiple
fallbacks in `delhiveryAwb()` / `delhiveryStatus()`,
`apps/api/src/modules/shipping/presentation/controllers/tracking-webhook.controller.ts:246-262`).

- **Impact:** a field-path mismatch would cause events to be **silently
  acknowledged (200) but dropped** (no AWB → `NO_MATCH`), so deliveries never
  register and there is no loud failure.
- **Fix:** capture a real Delhivery staging webhook, confirm the envelope, and
  lock the DTO. Add an alert on a sustained `NO_MATCH` / `UNKNOWN_STATUS` rate.

### 4. COD remittance / reconciliation not implemented
`DelhiveryRemittanceService.pullRemittance()` throws `NotImplementedException`
(`apps/logistics-facade/src/integrations/delhivery/services/delhivery-remittance.service.ts:30`).

- **Impact:** if COD orders ship, there is **no automated path to reconcile cash
  Delhivery collected** against our orders — COD settlement is manual / blind.
- **Fix:** implement `pullRemittance` against Delhivery's remittance API and a
  reconciliation job that matches remitted AWBs to sub-orders. **Only P1 if COD
  is enabled** — confirm whether COD is live before prioritizing.

---

## 🟠 P2 — Needed for full feature parity

### 5. Serviceability is inconsistent across surfaces — checkout/cart skip the real Delhivery check
_Traced 2026-06-03. The original concern (checkout relies on a permissive port
stub) was **disproved** — see Gap #10b for the now-downgraded stub. The real
issue is a divergence between surfaces:_

| Surface | Entry point | Checks real Delhivery? |
|---|---|---|
| PDP / storefront | `ServiceabilityService.checkServiceability` | ✅ yes (`serviceability.service.ts:107-109`) |
| Cart preview | `SellerAllocationService.previewServiceability` | ❌ no |
| **Checkout** | `SellerAllocationService.allocate` (via `catalogFacade.allocate`) | ❌ **no** |
| Admin / public delivery | `DelhiveryToolsService.serviceability` | ✅ yes |

The PDP checks real Delhivery drop-pincode serviceability
(`serviceability.service.ts:70-84` → `/api/v1/internal/delhivery/serviceability/{pincode}`),
but **cart and checkout gate only on the seller's own service-area config +
stock + distance** (`seller-allocation.service.ts` reasons: PINCODE_UNKNOWN /
NO_MAPPING / NO_SERVICE_AREA / OUT_OF_STOCK / DISTANCE_EXCEEDED). They never
ask Delhivery.

- **Impact:** a customer can place and pay for an order to a pincode the seller
  *claims* to serve but Delhivery does **not** actually deliver to. Checkout
  passes; the first real Delhivery serviceability test is **auto-book on
  PACKED**, which then fails → sub-order stuck PACKED with no AWB → manual ops
  intervention (and a refund if prepaid).
- **Secondary note:** even the PDP check is intentionally **fail-open** —
  `delhiveryServiceable()` returns `true` on facade error / unwired / non-boolean
  response (`serviceability.service.ts:71,80,82`), so a carrier hiccup never
  blocks an otherwise-serviceable product. Acceptable, but means PDP "serviceable"
  is not a hard guarantee either.
- **Fix:** call `delhiveryServiceable()` (or the facade serviceability route) in
  the checkout `allocate` path before finalizing, so an unserviceable drop
  pincode is caught at checkout, not at booking. Decide whether to keep fail-open
  there or fail-closed (blocking checkout is higher-stakes than a PDP banner).

### 6. Daily manifest generation not implemented
`DelhiveryManifestService.generateDailyManifest()` throws
`NotImplementedException`
(`apps/logistics-facade/src/integrations/delhivery/services/delhivery-manifest.service.ts:29`).

- **Impact:** depending on the Delhivery pickup contract, manifest/handover at
  pickup may be required. Pickup requests themselves work
  (`DelhiveryPickupService.createPickupRequest` is real).
- **Fix:** implement if the pickup SOP requires a manifest; otherwise
  de-scope explicitly.

### 7. E-way bill / HSN / seller fields hardcoded in the shipment mapper
`delhivery-shipment.mapper.ts` carries TODOs for `hsn_code`, `ewbn` (e-way bill
number), the seller snapshot, and the `fragile` flag — not sourced from the
canonical request yet (`apps/logistics-facade/src/integrations/delhivery/mappers/delhivery-shipment.mapper.ts:135-163`).
A separate `updateEwaybill` path exists (`DelhiveryOrderService.updateEwaybill`
→ `PUT /api/rest/ewaybill/`) but isn't fed automatically at booking.

- **Impact:** for shipments **> ₹50,000 declared value**, missing e-way bill /
  HSN data is a GST-compliance risk.
- **Fix:** source these from the canonical request and populate at booking (or
  call `updateEwaybill` post-booking for high-value shipments).

---

## 🟡 P3 — Cleanup / hardening

### 8. Facade idempotency interceptor is a marker only
`@Idempotent()` on the facade routes is an M0 marker; the dedup interceptor is
deferred to M1. Today idempotency rests on Delhivery's own `order_id` dedup plus
the api-side `idempotencyKey: subOrderId`. The `X-Idempotency-Key` header is
forwarded but the facade does not dedupe on it.

- **Impact:** low (Delhivery + api-side keying cover the realistic double-book
  case), but the facade has no independent replay guard.

### 9. Single shared inter-service API key
`apps/api` ↔ facade auth uses one shared `INTERNAL_API_KEY`; per-caller keys are
an M1 item (`apps/logistics-facade/src/core/api-keys/api-key-auth.guard.ts`).
Security hardening, no functional impact.

### 10. Facade has no persistence → `GET /:id` & `POST /:id/cancel` stay 501
Consequence of the stateless-facade design (see Design Choices). The legacy
shipment-id routes on `InternalShipmentsController` (`:119`, `:134`, `:154`) and
the controller's "every handler is a stub for M0" header comment are now stale.
Cleanup only — the live path keys on AWB.

### 10b. Dead serviceability surfaces on the courier port
The courier-port `checkServiceability` is defined on `CourierGatewayPort` and
both adapters but **never invoked** — the api-side Delhivery adapter returns a
hardcoded permissive `serviceable: true`
(`delhivery-courier.adapter.ts:52-60`), and the port-based query
`apps/api/src/modules/shipping/application/queries/check-serviceability.query.ts`
is an empty stub (`export class UcheckUserviceabilityQuery {}`).

- **Impact:** none today (nothing calls it) — the live serviceability paths go
  through the catalog `ServiceabilityService` / `DelhiveryToolsService` instead
  (see Gap #5). It's misleading dead code that implies a capability that isn't
  wired.
- **Fix:** either delete the port method + empty query, or implement them
  against the real facade route and route Gap #5's checkout check through them.

### 11. Facade webhook handler unbuilt
`apps/logistics-facade/.../tracking/presentation/controllers/tracking-webhook.controller.ts`
returns 501 (`:52`) and `DelhiveryClient.verifyWebhook()` throws
`not yet implemented` (`delhivery.client.ts:127`). Only relevant **if** the
goal becomes routing all carrier traffic through the facade. Inbound webhooks
work today on `apps/api` (HMAC via `verifyPayload`), so this is not a current
functional gap.

---

## ✅ Not gaps — intentional design choices

Listed so they aren't reopened as bugs:

- **Facade is stateless for booking.** `CreateShipmentService` persists no row
  and returns a `randomUUID()` shipmentId (`create-shipment.service.ts:73-80`).
  `apps/api` is the system of record by decision.
- **Inbound webhooks land on `apps/api`, not the facade.** Working and
  HMAC-secured (`DELHIVERY_WEBHOOK_HMAC_SECRET` / `X-Delhivery-Signature`).
- **RTO aliases to cancel.** Delhivery removed the explicit RTO API; the partner
  auto-drives RTO once delivery retries exhaust
  (`carrier-actions.service.ts:63`, `delhivery-ndr.service.ts:179`). Correct
  behavior, not a shortcut.
- **`registerPickup` is a passthrough.** Warehouse registration is owned by the
  logistics-partner flow (`delhivery-courier.adapter.ts:66-72`).
- **Reverse / RVP QC wired but unused.** SportsMart runs no return flow today
  (`adapters/delhivery-courier.adapter.ts:266`).

---

## Priority summary

| # | Gap | Severity | Gating condition |
|---|-----|----------|------------------|
| 1 | No tracking poll cron | 🔴 P1 | Always |
| 2 | Unproven on real Delhivery staging | 🔴 P1 | Before cutover |
| 3 | Webhook shape unverified | 🔴 P1 | Before cutover |
| 4 | COD remittance | 🔴 P1 | If COD enabled |
| 5 | Checkout/cart skip real Delhivery serviceability | 🟠 P2 | Always (verified live) |
| 6 | Daily manifest | 🟠 P2 | If pickup SOP requires |
| 7 | E-way bill / HSN mapper fields | 🟠 P2 | If shipping > ₹50k goods |
| 8 | Facade idempotency interceptor | 🟡 P3 | — |
| 9 | Per-caller API keys | 🟡 P3 | — |
| 10 | Facade persistence / stale routes | 🟡 P3 | — |
| 10b | Dead courier-port serviceability surfaces | 🟡 P3 | — |
| 11 | Facade webhook handler | 🟡 P3 | If facade-centralizing webhooks |
