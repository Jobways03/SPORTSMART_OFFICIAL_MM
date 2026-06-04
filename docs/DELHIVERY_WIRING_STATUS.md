# Delhivery Wiring — Status & Phase 3–4 Plan

_Last updated: 2026-06-02_

Goal: make Delhivery the live courier (book → track → deliver), then remove
SELF_DELIVERY and Shiprocket entirely. Agreed to **land Phases 1–4 first
(Delhivery working, nothing removed)**, do the removals (5–6) as a follow-up.

> ## ✅ STATUS: Phases 1–3 IMPLEMENTED & booting clean (2026-06-02)
> - **P1/P2** — Delhivery booking wired API → facade → `cmu/create`.
> - **P3A** — **automatic** booking: marking a DELHIVERY sub-order **PACKED**
>   books Delhivery + attaches the AWB (→ SHIPPED) with zero manual AWB entry.
> - **P3C** — new orders default to `deliveryMethod: 'DELHIVERY'`.
> - **P3B** — `POST /shipping/webhooks/delhivery` (status → DELIVERED).
> - **P4** — test through the UI: see **"How to test through the UI"** below.
> - Removals (P5/P6) still deferred.

Architecture decision: the API **delegates booking to the logistics-facade**
(NestJS service on port 4100) rather than calling Delhivery's HTTP API directly.
The facade already owns a fully-built `DelhiveryCourierAdapter` (real `cmu/create`,
cancel, track, label, NDR, warehouse). The API's `DelhiveryCourierAdapter` is a
thin client that POSTs the shared `logistics-contracts` shape to the facade.

```
API order flow → CourierGatewayResolver.forMethod('DELHIVERY')
              → API DelhiveryCourierAdapter.createShipment()
              → POST facade /api/v1/internal/shipments  (idempotencyKey = subOrderId)
              → facade CreateShipmentService → DefaultCourierGatewayResolver.forPartner('DELHIVERY')
              → facade DelhiveryCourierAdapter → Delhivery cmu/create → AWB + label
```

---

## ✅ DONE & VERIFIED (Phases 1–2) — build is green, 12 ports up

### Phase 1 — facade booking
- `apps/logistics-facade/src/modules/shipments/application/services/create-shipment.service.ts`
  — rewritten **stateless**: `execute(req)` resolves `forPartner(req.partnerHint ?? 'DELHIVERY')`,
  maps the contract `CreateShipmentRequest` → adapter `CreateShipmentPayload`, calls
  `adapter.createShipment()`, returns `{ shipmentId, status: success ? 'BOOKED' : 'DRAFT', awb, ... }`.
  Persistence (`repo`/`events`) is deferred (`void`-ed) — see 3D.
- `apps/logistics-facade/.../presentation/controllers/internal-shipments.controller.ts`
  — `create()` now returns `createService.execute(body)` with `@HttpCode(201)` (was a 501 stub).
  `GET /:id` and `POST /:id/cancel` are **still 501** (need persistence — deferred to 3D).

### Phase 2 — API adapter + enum + resolver
- `apps/api/.../shipping/infrastructure/adapters/delhivery-courier.adapter.ts` — **NEW**.
  Implements API `CourierGatewayPort`; `meta = { method: 'DELHIVERY', carrier: 'delhivery' }`;
  `createShipment` maps `DomainShipment` → facade contract (paise as strings via `rupeesToPaise`,
  pickup reuses drop since Delhivery books against the configured warehouse), POSTs the facade with
  `idempotencyKey: subOrderId`, success = 2xx + status BOOKED + awb.
  `track`/`printLabel`/`cancelShipment`/`reattempt`/`initiateRto` throw `CarrierCapabilityError`
  (deferred to Phase 3). `checkServiceability` permissive default; `registerPickup` passthrough.
- `apps/api/.../shipping/infrastructure/factories/courier-gateway.resolver.ts` — added
  `case 'DELHIVERY': return this.delhivery;` + constructor param.
- `apps/api/.../shipping/infrastructure/providers/shipping.providers.ts` — registered `DelhiveryCourierAdapter`.
- `apps/api/.../shipping/module.ts` — imported `LogisticsFacadeModule`.
- `apps/api/prisma/schema/_base.prisma` — `enum DeliveryMethod { SELF_DELIVERY \n DELHIVERY }`.
- Migration applied: `20260602100000_add_delhivery_delivery_method` (`ALTER TYPE "DeliveryMethod" ADD VALUE 'DELHIVERY'`).

---

## ⏳ REMAINING (Phase 3–4) — focused follow-up

### 3A — Auto-book on order verify  *(internal, verifiable, no external payload)*
Booking is currently **fully manual** (`attachAwb`); `createShipment` is never auto-called.
Add a **post-commit** flow that books DELHIVERY sub-orders automatically:
- Hook an existing order event (verified/routed) — **must run AFTER the verify DB tx commits**,
  not inside it (booking is an external HTTP call; don't hold a tx open / don't roll back a booked AWB).
- For each DELHIVERY sub-order: `resolver.forMethod('DELHIVERY').createShipment(...)` → on success
  persist the returned AWB the same way the manual `attachAwb` path does (so invoice-gen etc. fire).
- Idempotent (the facade already keys on `subOrderId`; guard against double-book on retries).

### 3B — Delhivery tracking webhook + status mapper  *(needs real inputs)*
Model on the existing Shiprocket route in
`apps/api/.../shipping/presentation/controllers/tracking-webhook.controller.ts`:
- `@Post('delhivery')` handler reusing the existing helpers (`requireAllowlistedIp`,
  `recordWebhookEvent`, `claimEvent` idempotency, `recordWebhookOutcome`).
- `mapDelhiveryStatus(status)` mirroring `mapShiprocketStatus` (line ~141) — map Delhivery's
  vocabulary (Manifested / In Transit / Dispatched / Pending / Out for Delivery / Delivered /
  RTO / RTO Delivered / …) → the internal status set.
- Non-delivered → `ingestTracking.ingestSingleSnapshot(awb, snapshot, { source: 'WEBHOOK_DELHIVERY', rawPayload })`.
- Delivered → `ordersFacade.findSubOrderByTrackingNumber` + `markSubOrderDelivered(... source: 'WEBHOOK_DELHIVERY')`.

  **Two type changes this requires:**
  1. Widen the TS union in `ingest-tracking-update.use-case.ts` (lines ~91, ~187):
     `'WEBHOOK_SHIPROCKET' | 'POLL_CRON' | 'MANUAL_ADMIN'` → add `'WEBHOOK_DELHIVERY'`. (TS-only, easy.)
  2. The delivered branch's `source` is the **Prisma enum `DeliveryConfirmationSource`**
     (`apps/api/prisma/schema/orders.prisma:73`, currently has `WEBHOOK_SHIPROCKET`).
     Adding `WEBHOOK_DELHIVERY` needs **a new enum migration + `prisma generate` + a FULL turbo restart**
     (webpack caches the old client). _Lighter alternative if you want to skip the migration first:
     route delivered through `ingestSingleSnapshot` too and note the markSubOrderDelivered
     invoice/refund side-effects as a follow-up._
- Widen `requireAllowlistedIp` provider param to `'shiprocket' | 'delhivery'`.
- New env `DELHIVERY_WEBHOOK_IP_ALLOWLIST` (parse like `SHIPROCKET_WEBHOOK_IP_ALLOWLIST`).
- **Blocker:** need Delhivery's **actual webhook JSON shape** to map awb/status field paths reliably
  (can't verify field paths without a real Delhivery webhook). Make extraction defensive until confirmed.

### 3C — Route orders to DELHIVERY so it's testable
The delivery-method picker currently hardcodes `SELF_DELIVERY`. Make new orders (or a test path)
resolve to `DELHIVERY` so 3A actually fires.

### 3D — (optional) facade persistence
Un-`void` the facade `repo`/`events`; persist the shipment so `GET /:id` and `POST /:id/cancel`
stop returning 501. Not required to prove booking, but needed for cancel/track-by-id.

### Phase 4 — Prove end-to-end
Book a real order via Delhivery **staging** (creds confirmed working) → AWB returned → webhook
drives status → DELIVERED. Requires a **live test booking**.

---

## ▶ How to test through the UI (Phase 4)

> **Full sectioned test matrix (every feature + what errors by design): `docs/LOGISTICS_TEST_GUIDE.md`.** The quick version follows.

Ports: storefront **4005**, Super Admin **4000**, Seller portal **4003** (d2c)
or **4009** (retail), Seller Admin **4001**, API **8000**, logistics-facade **4100**.

**Prerequisites**
- All servers up (`pnpm exec turbo run dev`).
- A test seller that is **ACTIVE/approved** (approve KYC in Seller Admin :4001 if
  pending) and has at least one **published product**.
- A customer account with a saved delivery address.

**Step 1 — Place an order (Customer, storefront :4005)**
- Log in → open a product → **Buy Now** (or add to cart → Checkout) → pick the
  address → place the order (COD or online).
- The new sub-order is created with `deliveryMethod = DELHIVERY` automatically —
  there is no method picker to click (3C).

**Step 2 — Verify the order (Super Admin :4000)**
- **Orders** → open the new order → **Verify**. It routes to the seller.

**Step 3 — Accept + Pack (Seller portal :4003 / :4009)**
- Log in as the seller that owns the product → **Orders** → open the sub-order.
- Click **Accept**, then click **MARK AS PACKED**.
- ⚡ This is the trigger. Within a second or two the system books Delhivery and
  attaches the AWB automatically.

**Step 4 — Confirm the automatic booking ✅**
- Refresh the order. It now shows **SHIPPED** with a **Delhivery AWB** + tracking
  link — and you never typed an AWB.
- Cross-check in Super Admin (:4000) order detail: courier **Delhivery**, tracking
  number present.
- API console (port 8000) prints:
  `Delhivery auto-booked sub-order <id> — AWB <awb> (now SHIPPED)`.
- If it stays **PACKED with no AWB**, the Delhivery staging call failed — check the
  API console for `Delhivery auto-book failed…` / `did not return an AWB…` and the
  facade console (4100).

**Step 5 — Delivery webhook (3B) — simulate with curl (Delhivery can't reach localhost)**
Replace `<AWB>` with the AWB from step 4:
```bash
curl -s -X POST http://localhost:8000/api/shipping/webhooks/delhivery \
  -H 'Content-Type: application/json' \
  -d '{"Shipment":{"AWB":"<AWB>","Status":"Delivered","StatusCode":"DLV","StatusDateTime":"2026-06-02T18:30:00"}}'
```
Then refresh the order — it flips to **DELIVERED** (source `WEBHOOK_DELHIVERY`).
Try `"Status":"In Transit"` or `"Status":"Out for Delivery"` to see intermediate
tracking states on the customer's track-order page. (Dev accepts the webhook
without a signature; production requires `DELHIVERY_WEBHOOK_HMAC_SECRET`.)

> Caveat: the Delhivery webhook JSON field paths are taken from the facade's
> hand-authored DTO (Delhivery's docs), not a captured live payload. Confirm the
> real envelope against a Delhivery staging push before the production cutover.

## ⛔ DEFERRED — destructive removals (Phases 5–6), do NOT start until 1–4 are proven
- **Remove SELF_DELIVERY** (~30 files + destructive enum/column migration): `DeliveryMethod`,
  `SelfDeliveryStatus` enums; `SubOrder.selfDeliveryStatus/selfDeliveredAt/selfDeliveryNotes`;
  `Seller/FranchisePartner.selfDeliveryEnabled/selfDeliveryPincodes`;
  `SelfDeliveryStatusButtons`/`DeliveryMethodPicker`/Badge across 6+ apps.
- **Remove Shiprocket**: webhook route `@Post('shiprocket')` + `mapShiprocketStatus` + env +
  DTO + `shiprocket-401-retry.spec` + `WEBHOOK_SHIPROCKET` enum value.

## Notes
- Regenerating the prisma client **requires a full turbo restart** (the running `nest --watch`
  keeps the old client via webpack cache → spurious enum type errors).
- psql apply pattern: `URL=$(grep -E '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed 's/?.*/?sslmode=disable/')`.
