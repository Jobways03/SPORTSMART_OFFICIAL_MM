# Shadowfax adapter

Direct integration with Shadowfax's marketplace + warehouse REST APIs for
forward shipments.

Apiary reference: https://shadowfaxapis.docs.apiary.io/

## What's implemented (v2)

| Operation                          | Status                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| `createShipment` (marketplace)     | **Implemented** — `POST /v3/clients/orders/` (`order_type: marketplace`) |
| `createShipment` (warehouse)       | **Implemented** — `POST /v3/clients/orders/` (`order_type: warehouse`)   |
| Tracking — single AWB              | **Implemented** — `GET /v4/clients/orders/{awb}/track/`               |
| Tracking — bulk (up to 50)         | **Implemented** — `POST /v4/clients/bulk_track/`                      |
| `updateOrder`                      | **Implemented** — `POST /v3/clients/order_update/`                    |
| `cancel` / `cancelShipment`        | **Implemented** — `POST /v3/clients/orders/cancel/`                   |
| Smoke runner                       | **Implemented** — `pnpm smoke:shadowfax` (8 commands)                 |
| `checkServiceability`              | Stubbed (`NotImplementedException`)                                   |
| `printLabel`                       | Stubbed                                                               |
| `reattempt` (NDR)                  | Stubbed                                                               |
| `initiateRto`                      | Surfaces `CarrierCapabilityError` — no endpoint                       |
| `registerPickup`                   | Stubbed — partner has no self-serve endpoint                          |
| Reverse pickup (`createReverse`, `getReverseOrderTracking`, `ShadowfaxPickupService`) | **NOT IMPLEMENTED — SportsMart does not use it** |
| Webhook verification               | Pending (separate sprint)                                             |
| COD remittance pull                | Stubbed                                                               |
| Manifest generation                | Stubbed                                                               |

### Reverse pickup is intentionally not implemented

SportsMart does not use Shadowfax reverse pickup; customer returns are routed
through a different fulfilment path. The reverse-pickup methods on the adapter
(`createReverse`, `getReverseOrderTracking`) and `ShadowfaxPickupService`
(`schedulePickup`, `cancelPickup`) all throw `NotImplementedException` with a
message pointing at the partner's Reverse Pickup Apiary doc.

If business needs change, implement against:
**https://sfxreversepickupsellerdelivery.docs.apiary.io/**

### Cancel state machine

`ShadowfaxOrderService.cancelShipment` (and `ShadowfaxCourierAdapter.cancel`)
returns a canonical three-state outcome:

| `state`              | When                                                                                       | Partner signal                                                |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `CANCELLED`          | Order cancelled immediately — terminal.                                                    | `responseCode: 200` + `responseMsg: "Request has been marked as cancelled"` |
| `CANCEL_QUEUED`      | Order is in transit; Shadowfax will cancel at the next facility scan. Still terminal for our purposes. | `responseCode: 304` + `responseMsg: "Request is queued for cancellation."` |
| `ALREADY_CANCELLED`  | Idempotent replay — the partner already has the cancellation on file.                      | `responseMsg` contains `"already in its cancellation phase"`   |

Any other partner response (`"Invalid state"`, `"Multiple Orders found"`,
`"Cannot cancel from Pincode Updated"`, `"Invalid AWB"`, `"Unable to cancel"`,
etc.) raises a `CarrierError` with `code: VALIDATION_FAILED` and the raw
partner string preserved in `detail`.

## Layout

```
shadowfax/
├── README.md                              ← you are here
├── shadowfax.constants.ts                 DI tokens, partner code, path roots
├── shadowfax.module.ts                    NestJS wiring
├── adapters/
│   └── shadowfax-courier.adapter.ts       CourierGatewayPort implementation
├── clients/
│   └── shadowfax.client.ts                HTTP transport (fetch + retry)
├── config/
│   └── shadowfax.config.ts                Zod-validated env binding
├── dtos/
│   ├── shadowfax-create-shipment.dto.ts   Marketplace + warehouse create wire types
│   ├── shadowfax-tracking.dto.ts          Single + bulk tracking wire types
│   ├── shadowfax-cancel.dto.ts            Cancel wire types + canonical outcome union
│   └── shadowfax-update-order.dto.ts      Update wire types + canonical change shape
├── mappers/
│   ├── shadowfax-error.mapper.ts          HTTP/200-Failure -> LogisticsErrorCode
│   ├── shadowfax-shipment.mapper.ts       Canonical <-> Shadowfax create body
│   ├── shadowfax-status.mapper.ts         status_id -> NormalizedStatus
│   └── shadowfax-tracking.mapper.ts       Wire timeline -> CanonicalTrackingTimeline
└── services/
    ├── shadowfax-order.service.ts         create (marketplace/warehouse) + cancel + update
    ├── shadowfax-tracking.service.ts      Single + bulk tracking pull
    └── shadowfax-pickup.service.ts        Reverse pickup — NOT IMPLEMENTED
```

## Credentials

Ask the Shadowfax account manager for the **staging** values of:

* `SHADOWFAX_API_TOKEN` — long-lived token from the partner portal
* `SHADOWFAX_CLIENT_CODE` — merchant code
* `SHADOWFAX_WEBHOOK_TOKEN` — webhook shared secret (used in a later sprint)

Set them in `apps/logistics-facade/.env`. Never paste tokens into source code,
config files, comments, or commit messages.

`.env.example` carries `replace-me-` placeholders; the config schema in
`config/shadowfax.config.ts` accepts them in development/staging so the facade
boots without partner secrets but **rejects** them in `NODE_ENV=production`.

## Running the smoke test

```bash
# from monorepo root
pnpm --filter @sportsmart/logistics-facade install   # picks up tsx + dotenv

# Help (lists all commands)
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax help

# Pincode serviceability
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax serviceability 560007

# AWB generation
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax generate-awb 5

# Create — marketplace
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax create-order \
  | jq '.payload.awb'

# Create — warehouse
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax create-warehouse-order \
  | jq '.payload.awb'

# Tracking — single AWB
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax track SF1234567890

# Tracking — bulk
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax track-bulk SF1,SF2,SF3

# Cancel
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax cancel SF1234567890 "Customer changed mind"

# Update (sets customer alternate_contact to 9999000099)
pnpm --filter @sportsmart/logistics-facade smoke:shadowfax update SF1234567890
```

The smoke runner:

* Loads `.env` via `dotenv`.
* **Refuses to run** when `SHADOWFAX_API_URL` looks like production
  (`shadowfax.in/api` without `staging`). Override with `SHADOWFAX_ALLOW_PROD=1`
  only for emergencies, and never on a developer laptop.
* Prints structured JSON suitable for `jq`.
* Exits 0 on success, non-zero on error.

## Known quirks

* **Same endpoint, two modes.** Marketplace and warehouse orders both POST to
  `/v3/clients/orders/`; the request body's `order_type` literal picks the
  product line. Marketplace uses `rts_details` (return-to-seller); warehouse
  uses `rto_details` (return-to-origin). Same nested shape, different key.
* **`customer_details.location_type` casing.** Warehouse-only optional field.
  The docs spell the allowed values `"residential" | "Commercial"` — lowercase
  first, capital second. We pass them through verbatim.
* **`awb_numbers` is singular on update.** The order_update endpoint expects
  `awb_numbers: <single string>` (yes, with a trailing `s` despite being a
  single value). Match the docs exactly.
* **Cancellation outcome lives in the body.** The cancel endpoint always
  returns HTTP 200 — the canonical outcome (CANCELLED / CANCEL_QUEUED /
  ALREADY_CANCELLED) is derived from `responseCode` + `responseMsg`.
* **Errors arrive with HTTP 200.** Shadowfax distinguishes success vs failure
  via the response body's `message` field (`"Success"` vs `"Failure"`), not the
  HTTP status. The error mapper handles both.
* **INR, not paise.** Money fields on the wire are decimal INR numbers, not
  paise. The shipment mapper converts at the boundary.
* **Pincodes are numbers.** Shadowfax 400s on string pincodes. The shipment
  mapper converts at the boundary.
* **Polymorphic `errors` field.** Shadowfax returns errors as a string, a
  string[], or a field-error object. The error mapper flattens all three.
* **Duplicate order handling.** Re-posting with the same `client_order_id`
  returns a Failure envelope containing the original AWB. v1 throws a
  `CarrierError` with code `IDEMPOTENT_REPLAY` and the existing AWB on
  `originalAwbIfDuplicate`. A future iteration will fetch the original order
  and return it as a normal `CreateShipmentResult`.
* **Two hosts.** Marketplace orders live on `dale.staging.shadowfax.in/api`
  (sandbox) / `dale.shadowfax.in/api` (production). QR/label endpoints live on
  the `saruman.*` host (configured separately as `SHADOWFAX_QR_API_URL`).
* **Billing.** When the merchant has unpaid invoices, Shadowfax returns a 400
  with a "pending invoices" body. The error mapper surfaces this as
  `PARTNER_REJECTED` with a clear detail message; ops needs to resolve the
  billing block out-of-band.
* **Bulk-track cap of 50.** The bulk-tracking endpoint rejects calls with more
  than 50 AWBs. `ShadowfaxTrackingService.getOrdersTracking` chunks the input
  transparently; the smoke runner does NOT, so pass at most 50 AWBs to
  `track-bulk`.

## Reference

* Apiary docs (request via partner account manager):
  https://shadowfaxapis.docs.apiary.io/
* Reverse Pickup (NOT implemented — for whoever turns it on later):
  https://sfxreversepickupsellerdelivery.docs.apiary.io/
* Status-code dictionary: see `mappers/shadowfax-status.mapper.ts`.
* Error mapping: see `mappers/shadowfax-error.mapper.ts`.
