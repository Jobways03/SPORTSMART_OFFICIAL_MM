# Logistics (Delhivery) — Full Manual Test Guide

_Generated 2026-06-02. Companion to `DELHIVERY_WIRING_STATUS.md`._

## Readiness verdict
**Complete & testable end-to-end:** order routes to Delhivery → seller marks
PACKED → auto-book gets a real AWB and auto-advances to SHIPPED → the live
webhook ingests every carrier status (in-transit / out-for-delivery / NDR /
RTO / delivered) → DELIVERED flips the sub-order and rolls up the master →
RTO_DELIVERED triggers stock-restore + (prepaid) refund.

**Now wired (2026-06-02) — the five carrier actions, UI-testable:** fetch
label, on-demand track refresh, cancel shipment, NDR re-attempt, and force-RTO
all go through the logistics-facade's AWB-keyed routes
(`/internal/shipments/awb/:awb/*`) and each has a button in the Super Admin
shipment panel (section 7). Delhivery has no explicit RTO API, so Force-RTO
aliases to cancel (carrier auto-RTO follows post-pickup).

**Still deferred (genuine gaps, not bugs):** manifest PDF (facade manifest
service is a stub); facade `GET /:id` + shipmentId-keyed `/:id/cancel` are 501
(we key on AWB instead); serviceability is a permissive stub (every pincode
"serviceable"); and forward DELIVERED bypasses `applySnapshot` (no terminal
tracking-events row, no POD capture, no invoice on delivery).

**Ports:** storefront `4005` · Super Admin `4000` · Seller `4003`/`4009` ·
Franchise `4004` · Seller Admin `4001` · API `8000` · facade `4100`.
Webhook URL: `http://localhost:8000/api/shipping/webhooks/delhivery`.

Legend: ✅ WORKS · ⚠️ PARTIAL/stub · ⛔ NOT WIRED (errors by design) · ▫️ N/A.

---

## Setup / prerequisites
- ✅ Confirm servers up: API `http://localhost:8000`, seller `:4003`, storefront `:4005`, admin `:4000`, facade `:4100`. The API console (port 8000) is your main log surface.
- ✅ **Dev webhook auth open:** leave `DELHIVERY_WEBHOOK_HMAC_SECRET`, `DELHIVERY_WEBHOOK_TOKEN`, `DELHIVERY_WEBHOOK_IP_ALLOWLIST` unset → curls return 200 and the console logs `Delhivery webhook accepted WITHOUT verification` once per call. (Production would 401.)
- ✅ **Register the Delhivery pickup warehouse** (booking prerequisite): Seller Admin `:4001` seller-detail → register pickup with partner DELHIVERY, or `POST :4100/api/v1/partners/DELHIVERY/warehouses`. The name must match facade env `DELHIVERY_PICKUP_WAREHOUSE_NAME`, else auto-book fails `VALIDATION_FAILED`.
- ⚠️ **Have a DELHIVERY sub-order:** place an order (`:4005`) for a Delhivery-registered seller's product. Verify `SELECT id, fulfillment_status, delivery_method FROM sub_orders WHERE master_order_id='<id>'` → `delivery_method='DELHIVERY'`. If it shows `SELF_DELIVERY`, 3C didn't fire — flag it (don't work around).

---

## 1) Order routes to Delhivery
- ⚠️ **Confirm method** — DB `SELECT delivery_method, fulfillment_status, accept_status FROM sub_orders WHERE id='<id>'` → `DELHIVERY / UNFULFILLED / ACCEPTED` after accept. (The seller UI type only models SELF_DELIVERY so no Delhivery badge renders — trust the DB column, it's a cosmetic UI gap.)
- ✅ **Seller accepts** — Seller `:4003` `/dashboard/orders/[id]` → **ACCEPT ORDER** (or `PATCH :8000/api/seller/orders/<id>/accept`). `accept_status` OPEN→ACCEPTED; **MARK AS PACKED** unlocks.

## 2) Auto-book on PACK ⭐ (the key flow)
- ✅ **Mark PACKED** — Seller `:4003`/`:4009` `/dashboard/orders/[id]` → **MARK AS PACKED** (or `PATCH :8000/api/seller/orders/<id>/status {"status":"PACKED"}`; franchise `:4004` → `PATCH /api/franchise/orders/<id>/status`). → `fulfillment_status=PACKED`, event `orders.sub_order.status_changed{newStatus:PACKED}` published. No courier call on this request.
- ✅ **Observe auto-book** — watch API console: `Delhivery auto-booked sub-order <id> — AWB <awb> (now SHIPPED)`. Failures: `Delhivery auto-book failed…` / `did not return an AWB…`.
- ✅ **Confirm SHIPPED + AWB** — refresh seller order page → SHIPMENT TRACKING card shows courier+AWB+link. DB: `fulfillment_status=SHIPPED, tracking_number=<AWB>, courier_name='Delhivery', awb_attachment_source='DELHIVERY_BOOKING'`. The manual MARK AS SHIPPED button is gone (correct — not needed).
- ✅ **Customer sees it** — storefront `:4005` `/orders/<ORDER_NUMBER>` → cyan tracking strip: Delhivery + AWB + “Track shipment →” deep-link to `delhivery.com/tracking/package/<AWB>`; badge “Shipped”.
- ⚠️ **Awareness:** auto-book ships via `attachAwb`, bypassing the 4-photo evidence gate — Delhivery sub-orders ship with no dispatch photos. Expected; flag for product (no return-fraud baseline).

## 3) Tracking webhook — intermediate states (curl)
Replace `<AWB>` with the booked AWB.
- ✅ **PICKED_UP** — `curl -X POST http://localhost:8000/api/shipping/webhooks/delhivery -H 'Content-Type: application/json' -d '{"Shipment":{"AWB":"<AWB>","Status":"Picked Up","StatusDateTime":"2026-06-02T06:00:00"}}'` → 200, `webhook_events.process_outcome=APPLIED`, `shipment_tracking_events` row `PICKED_UP`.
- ✅ **IN_TRANSIT** — `…"Status":"In Transit","StatusDateTime":"2026-06-02T10:00:00"…` → APPLIED, tracking row `IN_TRANSIT`, sub-order stays SHIPPED, customer “Last courier update” timestamp moves.
- ✅ **OUT_FOR_DELIVERY** — `…"Status":"Out for Delivery","StatusDateTime":"2026-06-02T18:30:00"…` → APPLIED, tracking row `OUT_FOR_DELIVERY`. (No distinct on-page text — customer badge stays “Shipped”; only the timestamp + scan rows reflect it.)
- ✅ **Scan history** — `SELECT internal_status, external_status, scan_at, source FROM shipment_tracking_events WHERE sub_order_id='<id>' ORDER BY scan_at DESC` → one row per accepted scan, `source=WEBHOOK_DELHIVERY`.

## 4) Delivery (curl)
- ✅ **DELIVERED** (sub-order must be SHIPPED) — `…"Status":"Delivered","StatusDateTime":"2026-06-02T14:00:00"…` → 200 APPLIED; `fulfillment_status=DELIVERED, delivered_at, return_window_ends_at, delivery_source=WEBHOOK_DELHIVERY, delivered_by='delhivery:<AWB>'`; master rollup DELIVERED/PARTIALLY_DELIVERED; audit SYSTEM; event `orders.sub_order.delivered`.
- ✅ **Customer view** — `:4005` `/orders/<ORDER_NUMBER>` → tracker fills to Delivered/Completed, Return Items CTA eligible.
- ⚠️ **Awareness:** DELIVERED bypasses `applySnapshot` → no tracking-events row for the terminal scan, no POD, no `shipping.shipment.delivered`, no invoice-on-delivery. Expected.
- ✅ **Out-of-FSM delivery rejected** — push DELIVERED for a sub-order still UNFULFILLED/PACKED → `FSM_REJECTED`, 200, no write.

## 5) NDR inbound (Undelivered)
- ✅ **UNDELIVERED** — `…"Status":"Undelivered","StatusCode":"EOD-104","Instructions":"Customer not available","StatusDateTime":"2026-06-02T16:00:00"…` → APPLIED (the `isUndelivered` guard forces it through `applySnapshot` despite the substring). New `ndr_attempts` row; `ndr_attempt_count` bumped, `ndr_status=PENDING_REATTEMPT`; event `shipping.ndr.raised` → customer NDR notice. Stays SHIPPED.
- ✅ **Second NDR** — re-POST with a later `StatusDateTime` → `ndr_attempts` attemptNumber=2.
- ⚠️ **Awareness:** `PENDING_REATTEMPT` is set but nothing pushes a reattempt to Delhivery and there's no auto-RTO escalation. Customer is notified; reattempt is carrier-driven only.

## 6) RTO inbound (incl. refund / stock-restore)
- ✅ **RTO_INITIATED** — `…"Status":"RTO Initiated","StatusDateTime":"2026-06-02T17:00:00"…` → APPLIED (reverse); `rto_events` RTO_INITIATED; `rto_initiated_at`, `ndr_status=EXHAUSTED`; event `shipping.rto.initiated`. (Legal only from in-transit/OFD/NDR — blocked as a first scan.)
- ✅ **RTO_IN_TRANSIT** — `…"Status":"RTO In Transit","StatusDateTime":"2026-06-02T18:00:00"…` → `rto_events` RTO_IN_TRANSIT; no customer notification (intermediate).
- ✅ **RTO_DELIVERED — prepaid** (master `ONLINE`/`PAID`, node SELLER) — `…"Status":"RTO Delivered","StatusDateTime":"2026-06-02T20:00:00"…` → `fulfillment_status=CANCELLED`, `rto_delivered_at`; `rto_credit_note_pending(status=PENDING)`; event `shipping.rto.delivered` → console `Stock restored…` + `Refund initiated for RTO_DELIVERED sub-order <id>`.
- ✅ **RTO_DELIVERED — COD** — same but console `…is COD — no refund required`; no refund instruction.
- ✅ **Verify side-effects** — `rto_events` chain; `rto_credit_note_pending` row; `refund_instructions` sourceLabel `rto-delivered:<id>` (prepaid only); stock incremented for this sub-order's items only.

## 7) Carrier actions — NOW WIRED through the facade (2026-06-02)
All five buttons live in **Super Admin `:4000` → order detail → Shipping panel → Expand**
(component `ShipmentPanel.tsx`). They call the API → Delhivery adapter → facade
`/internal/shipments/awb/:awb/*`. Pick a sub-order that already has a Delhivery AWB.
- ✅ **Fetch label / manifest** — `Shipping label` → **Fetch label / manifest**. `getLabelInfo` now calls `printLabel` via the facade; a real Delhivery label PDF link appears (`Download label PDF ↗`). A freshly-booked AWB may not have a label yet → falls back to the stored URL (no error).
- ✅ **Refresh tracking** — `Carrier actions` → **Refresh tracking**. Pulls a fresh snapshot (`adapter.track` → facade) and ingests it (source `MANUAL_ADMIN`); the Status pill / Last event update. A not-yet-registered AWB returns a friendly "no tracking yet" message.
- ✅ **Cancel shipment (courier)** — `Carrier actions` → **Cancel shipment (courier)** (confirm prompt). Cancels the AWB at Delhivery (pre-pickup only; a picked-up AWB returns `success:false`). Distinct from the order-level **Cancel sub-order**.
- ✅ **Re-attempt delivery (NDR)** — `Carrier actions` → **Re-attempt delivery**. Calls `NdrRtoService.handleNdrAction(REATTEMPT, ADMIN)` → `adapter.reattempt` → facade. Outcome `OK` on success (was `CARRIER_ERROR` before this wiring).
- ✅ **Force RTO** — `Carrier actions` → type a reason (≥10 chars) → **Force RTO**. Commits DB RTO state AND (now) tells Delhivery: since Delhivery has no explicit RTO API the facade aliases it to **cancel** (auto-RTO follows post-pickup). Needs the `orders.rto.force` permission, else 403.
- ✅ **Admin Attach AWB** — still a pure DB write (manual override; doesn't instruct Delhivery — real booking is the auto-book on PACK). Needs BOTH courierName (∈ supported set) AND awb.
- ✅ **Override fulfillment status** — DB/FSM write, works ("RTO" isn't a valid fulfillment status → no-op).

## 8) Negative / edge
- ✅ **Duplicate webhook** — re-POST identical payload → 1st APPLIED, 2nd `DUPLICATE` (Redis SET-NX; or the `UNIQUE(sub_order_id,external_status,scan_at)` index after TTL). Console `Duplicate Delhivery event … ignored`.
- ✅ **Unknown AWB** — `…"AWB":"NOPE999"…` → 200 `success:false`, `NO_MATCH` (200 so Delhivery won't retry).
- ✅ **Out-of-order** — earlier `StatusDateTime` after a later scan → `DROPPED_OOO` (CAS on `lastTrackingEventAt`). Prevents a late IN_TRANSIT regressing a DELIVERED order.
- ⚠️ **Unknown status** — `…"Status":"Some New Delhivery Status"…` → `UNKNOWN_STATUS`, 200 acknowledged, no change. (`Not Picked` also lands here.)
- ⚠️ **Carrier CANCELLED mid-transit** — `…"Status":"Cancelled"…` from a live scan → `FSM_REJECTED` (no legal predecessor); no refund/stock side-effect (unlike RTO_DELIVERED).
- ✅ **Signature failure (prod-style)** — set `DELHIVERY_WEBHOOK_HMAC_SECRET`, POST without/ bad `X-Delhivery-Signature` → 401; records `webhook_events signature_valid=false, outcome=ERROR` before throwing.

---

## Where to look
- **API console (8000):** `Delhivery auto-booked sub-order … (now SHIPPED)` · `Delhivery auto-book failed…` · `Delhivery webhook: awb=…, status=…` · `accepted WITHOUT verification` · `Duplicate Delhivery event … ignored` · `Stock restored for RTO_DELIVERED…` / `Refund initiated…` / `…is COD — no refund required`.
- **`sub_orders`:** `fulfillment_status, tracking_number, courier_name, awb_attachment_source, delivery_source` (note: `delivery_source`, not `deliver_source`), `delivered_by, delivered_at, return_window_ends_at, shipped_at, delivery_method, accept_status`, NDR/RTO cols `ndr_attempt_count/ndr_status/ndr_last_reason/rto_initiated_at/rto_in_transit_at/rto_delivered_at`.
- **`webhook_events`:** `provider, event_key, awb, status, signature_valid, process_outcome` (APPLIED/DROPPED_OOO/NO_MATCH/DUPLICATE/FSM_REJECTED/UNKNOWN_STATUS/ERROR), `sub_order_id, processed_at, error_message, raw_payload`.
- **`shipment_tracking_events`:** `sub_order_id, internal_status, external_status, scan_location, remarks, scan_at, source` — `UNIQUE(sub_order_id, external_status, scan_at)`.
- **`ndr_attempts` / `rto_events`** — NDR/RTO milestones; **`rto_credit_note_pending`** (status=PENDING) after RTO_DELIVERED; **`refund_instructions`** sourceLabel `rto-delivered:<id>` (prepaid RTO refund).
