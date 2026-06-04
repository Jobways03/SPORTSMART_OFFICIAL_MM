# Delhivery adapter

Direct integration with Delhivery's B2C REST API for forward shipments
(reverse / RVP QC 3.0 implemented for completeness but currently
unused by SportsMart per business decision).

Developer portal (source of truth):
**https://one.delhivery.com/developer-portal/documents/b2c**

Test host: `https://staging-express.delhivery.com`
Production host: `https://track.delhivery.com`

## Feature status — all 17 surfaces

| #  | Feature                                | Method  | Path                                              | Status     |
| -- | -------------------------------------- | ------- | ------------------------------------------------- | ---------- |
| 1  | Pincode Serviceability                 | GET     | `/c/api/pin-codes/json/`                          | implemented |
| 2  | Shipment Creation                      | POST    | `/api/cmu/create.json` (form-style)               | implemented |
| 3  | Shipment Updation / Edit               | POST    | `/api/p/edit`                                     | implemented |
| 4  | Shipment Cancellation                  | POST    | `/api/p/edit` (`cancellation: "true"`)            | implemented |
| 5  | Fetch WayBill (Bulk)                   | GET     | `/waybill/api/bulk/json/?count=N`                 | implemented |
| 6  | Fetch WayBill (Single)                 | GET     | `/waybill/api/fetch/json/?token=…`                | implemented |
| 7  | Expected TAT                           | GET     | `/api/dc/expected_tat`                            | implemented |
| 8  | Heavy Product Pincode Serviceability   | GET     | `/api/dc/fetch/serviceability/pincode`            | implemented |
| 9  | Shipment Tracking                      | GET     | `/api/v1/packages/json/`                          | implemented |
| 10 | Calculate Shipping Cost                | GET     | `/api/kinko/v1/invoice/charges/.json`             | implemented |
| 11 | Generate Shipping Label                | GET     | `/api/p/packing_slip`                             | implemented |
| 12 | Pickup Request Creation                | POST    | `/fm/request/new/`                                | implemented |
| 13 | Client Warehouse Creation              | POST    | `/api/backend/clientwarehouse/create/`            | implemented |
| 14 | Client Warehouse Updation              | POST    | `/api/backend/clientwarehouse/edit/`              | implemented |
| 15 | NDR — apply action                     | POST    | `/api/p/update`                                   | implemented |
| 16 | NDR — get status                       | GET     | `/api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`     | implemented |
| 17 | E-way bill Update                      | PUT     | `/api/rest/ewaybill/{waybill}/`                   | implemented |
| 18 | RVP QC 3.0 (reverse) — completeness    | POST    | `/api/cmu/create.json` (RVP variant)              | implemented (unused by SportsMart) |
| 19 | Webhook (scan / document push)         | —       | email onboarded — no code surface                 | email-onboarded |

## Webhook setup

Webhook configuration is NOT a code task — Delhivery sets the
webhooks up on their side from a per-account configuration. To
onboard:

1. Email **lastmile-integration@delhivery.com** with:
   - Your account / client name
   - The webhook receiver URL(s) for your environment
   - The "Webhook Requirement Document" template Delhivery sends back
     during onboarding (filled with the statuses you want pushed).
2. Delhivery support enables two **separate** webhook streams (these
   cannot be combined):
   - **Scan push** — status updates. For forward shipments, expect
     `Manifested`, `Not Picked`, `In Transit`, `Pending`, `Dispatched`,
     `Delivered`. For RT (return-to-origin): `In Transit`, `Pending`,
     `Dispatched`, `RTO`. For reverse (PP / PU): `Open`, `Scheduled`,
     `Dispatched`, `In Transit`, `Pending`, `Dispatched`, `DTO`. Plus
     `CN` for Canceled / Closed.
   - **Document push** — POD / Sorter / QC images.
3. Once Delhivery confirms activation, point both URLs at the facade
   webhook ingest controller (lands in a later sprint).
4. The shared secret used for path-based signature lives in
   `DELHIVERY_WEBHOOK_TOKEN` (rotate via Vault).

## How to obtain credentials

1. Sign up at **https://one.delhivery.com/** and complete KYC.
2. Ask the Delhivery account manager for:
   - **API token** (long-lived, sent as `Authorization: Token <token>`).
   - **Client name / code** (Delhivery's `client_name` — required in
     create-shipment payloads and in the `cl` query param for AWB
     fetch).
3. Generate a strong random string for `DELHIVERY_WEBHOOK_TOKEN`
   (`openssl rand -hex 32`) and submit it during webhook onboarding.
4. Copy `.env.example` to `.env` at the facade root and fill in:
   - `DELHIVERY_API_URL` — test or production host
   - `DELHIVERY_API_TOKEN`
   - `DELHIVERY_CLIENT_NAME`
   - `DELHIVERY_WEBHOOK_TOKEN`
   - `DELHIVERY_PICKUP_WAREHOUSE_NAME` — case + space sensitive
   - `DELHIVERY_REQUEST_TIMEOUT_MS` (optional, default 15000)
   - `DELHIVERY_MAX_RETRIES` (optional, default 2)

**Never commit real credentials.** The strict-mode config schema
rejects `replace-me-*` placeholders when `NODE_ENV=production`.

## Smoke command index

The smoke script lives at
`apps/logistics-facade/scripts/delhivery-smoke.ts` and runs as plain
tsx — no NestJS bootstrap.

### Read-only commands (safe on production)

| Command                                                         | Endpoint                                       | One-liner                                                  |
| --------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `serviceability <pincode>`                                      | `GET /c/api/pin-codes/json/`                   | Check whether a drop pincode is serviceable                |
| `serviceability-heavy <pincode>`                                | `GET /api/dc/fetch/serviceability/pincode`     | Same for the heavy-product surface (NSZ = non-serviceable) |
| `expected-tat <origin> <dest> [mot]`                            | `GET /api/dc/expected_tat`                     | Expected TAT (mot default S; values S/E/N)                 |
| `calculate-cost <origin> <dest> <weight_gm> [mode] [payment]`   | `GET /api/kinko/v1/invoice/charges/.json`      | Live cost quote (mode default E, payment default Pre-paid) |
| `track <awb1,awb2,...>`                                         | `GET /api/v1/packages/json/`                   | Pull tracking timeline for up to 50 AWBs                   |
| `label <awb> [pdf_size]`                                        | `GET /api/p/packing_slip`                      | Generate packing-slip PDF (A4 or 4R)                       |
| `ndr-status <upl_id>`                                           | `GET /api/cmu/get_bulk_upl/<upl>?verbose=true` | Poll the async result of a prior NDR action                |

### Write commands (blocked on production unless `DELHIVERY_ALLOW_PROD_WRITES=1`)

| Command                                              | Endpoint                                        | One-liner                                                    |
| ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `fetch-waybill <count>`                              | `GET /waybill/api/bulk/json/`                   | Reserve N AWBs from the pool (consumes pool)                 |
| `create-order`                                       | `POST /api/cmu/create.json`                     | Book a forward Prepaid parcel (costs ₹, dispatches a rider)  |
| `update-order <awb>`                                 | `POST /api/p/edit`                              | Patch consignee fields on an existing AWB (fixture: phone)   |
| `cancel <awb>`                                       | `POST /api/p/edit` (cancellation:"true")        | Cancel an existing AWB                                       |
| `create-rvp-order`                                   | `POST /api/cmu/create.json`                     | Book a reverse RVP QC 3.0 shipment (unused by SportsMart)    |
| `pickup-request <YYYY-MM-DD> <HH:MM:SS>`             | `POST /fm/request/new/`                         | Raise a pickup request for the configured warehouse          |
| `warehouse-create`                                   | `POST /api/backend/clientwarehouse/create/`     | Register a new pickup warehouse                              |
| `warehouse-update <name>`                            | `POST /api/backend/clientwarehouse/edit/`       | Patch phone / address / pin on an existing warehouse         |
| `ndr-action <awb> <RE-ATTEMPT\|PICKUP_RESCHEDULE>`   | `POST /api/p/update`                            | Apply an NDR action; returns a UPL ID for status polling     |
| `ewaybill-update <awb> <invoice_no> <ewb_no>`        | `PUT /api/rest/ewaybill/<awb>/`                 | Attach the GST e-way bill to a high-value shipment           |

### Dry-run mode

Any WRITE command honours the dry-run flag — prints the exact URL,
headers (auth redacted), and body that would be sent, without making
a network call:

```sh
DELHIVERY_DRY_RUN=1 \
  pnpm --filter @sportsmart/logistics-facade smoke:delhivery create-order
```

### How to test write operations on production

Production write commands are blocked by default. **Always dry-run
first**, then opt-in for exactly one live call:

```sh
# 1. Dry-run to verify the payload shape.
DELHIVERY_DRY_RUN=1 \
DELHIVERY_PICKUP_WAREHOUSE_NAME="<exact warehouse name>" \
  pnpm --filter @sportsmart/logistics-facade smoke:delhivery create-order

# 2. One-shot live test.
DELHIVERY_ALLOW_PROD_WRITES=1 \
DELHIVERY_PICKUP_WAREHOUSE_NAME="<exact warehouse name>" \
  pnpm --filter @sportsmart/logistics-facade smoke:delhivery create-order
```

The script prints a loud banner before the call so you can abort if
the URL is wrong.

## Implementation layout

```
delhivery/
├── README.md                              ← you are here
├── delhivery.constants.ts                 DI tokens, partner code, confirmed paths
├── delhivery.module.ts                    NestJS wiring (services + adapter)
├── adapters/
│   └── delhivery-courier.adapter.ts       CourierGatewayPort + adapter extensions
├── clients/
│   └── delhivery.client.ts                HTTP transport (GET / POST / PUT, json / form, retry)
├── config/
│   └── delhivery.config.ts                Zod-validated env binding
├── dtos/
│   ├── delhivery-create-shipment.dto.ts   Shipment Manifestation request / response
│   ├── delhivery-cancel.dto.ts            Cancel + Update (shared /api/p/edit) shapes
│   ├── delhivery-fetch-waybill.dto.ts     Bulk + single AWB allocation shapes
│   ├── delhivery-tat.dto.ts               Expected TAT request / response
│   ├── delhivery-heavy-serviceability.dto.ts  Heavy pincode serviceability
│   ├── delhivery-cost.dto.ts              Calculate Shipping Cost
│   ├── delhivery-label.dto.ts             Packing slip (pdf + json variants)
│   ├── delhivery-pickup-request.dto.ts    Pickup request creation
│   ├── delhivery-warehouse.dto.ts         Client warehouse create + update
│   ├── delhivery-ndr.dto.ts               NDR apply + status + NSL eligibility tables
│   ├── delhivery-rvp-qc.dto.ts            RVP QC 3.0 reverse shapes
│   ├── delhivery-tracking.dto.ts          Tracking response (Scans + Status)
│   ├── delhivery-serviceability.dto.ts    Pincode serviceability
│   ├── delhivery-rate.dto.ts              Legacy rate-card DTOs (kinr.json)
│   └── delhivery-ewaybill.dto.ts          E-way bill update PUT shapes
├── mappers/
│   ├── delhivery-shipment.mapper.ts       Canonical <-> Delhivery create shipment
│   ├── delhivery-tracking.mapper.ts       Delhivery Scans -> NormalisedScanRecord
│   ├── delhivery-status.mapper.ts         Partner status codes -> NormalizedStatus
│   └── delhivery-error.mapper.ts          Partner errors -> LogisticsErrorCode + MappedError
└── services/
    ├── delhivery-order.service.ts         create / cancel / update / ewaybill / RVP-QC
    ├── delhivery-tracking.service.ts      track + getTimeline + trackByRefIds
    ├── delhivery-ndr.service.ts           applyAction + getStatus + legacy reattempt
    ├── delhivery-rates.service.ts         serviceability + heavy + expected TAT + calculate-cost
    ├── delhivery-label.service.ts         generateLabel (pdf / json) + printLabel
    ├── delhivery-pickup.service.ts        createPickupRequest
    ├── delhivery-warehouse.service.ts     createWarehouse + updateWarehouse
    ├── delhivery-waybill.service.ts       fetchBulk + fetchSingle
    ├── delhivery-manifest.service.ts      placeholder — manifest auto-closes on first scan
    └── delhivery-remittance.service.ts    placeholder — COD remittance pull (separate sprint)
```

## Known quirks

- **Form-style POST for `create.json`**: Shipment Manifestation
  expects `Content-Type: application/x-www-form-urlencoded` with the
  body shaped as `format=json&data=<URL_ENCODED_JSON>`.
  `DelhiveryClient` handles this via `options.contentType: 'form'`.
- **Token auth header**: `Authorization: Token <api-token>` (NOT
  `Bearer`).
- **`pickup_location.name` must match a registered warehouse exactly**
  (case + space sensitive). Typos surface as
  "ClientWarehouseMatchingQueryDoesNotExist".
- **Cancel endpoint also serves Update**: both flows go through
  `POST /api/p/edit`. Cancel sends `cancellation: "true"` (the literal
  string, not a boolean); update sends a field diff.
- **NDR is async**: `POST /api/p/update` returns a UPL ID; poll via
  `GET /api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`. Apply after 9 PM
  IST; attempt_count must be 1 or 2.
- **Pickup request — one per warehouse per day**: a second raise
  before the previous closes is rejected. The error mapper surfaces
  this as `LogisticsErrorCode.BUSY` (retryable later in the day).
- **E-way bill required > ₹50k**: `PUT /api/rest/ewaybill/{waybill}/`
  with `{"data":[{"dcn":"<invoice>","ewbn":"<ewb>"}]}`.
- **Edit-state restrictions**: edit / cancel only work on
  Manifested / In-Transit / Pending (forward), Scheduled (RVP). The
  error mapper surfaces ineligible states as `INVALID_STATE`.
- **Webhooks**: configured by emailing
  `lastmile-integration@delhivery.com` — there is no API surface for
  webhook registration. See "Webhook setup" above.
