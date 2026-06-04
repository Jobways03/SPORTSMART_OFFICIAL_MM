# Courier integrations

This folder holds one sub-folder per courier partner. Each folder is
self-contained — it owns the partner's HTTP client, request/response
DTOs, payload mappers, and Nest module wiring — and exposes exactly
one thing to the rest of the app: a class that implements
`CourierGatewayPort` from
`modules/shipments/application/ports/outbound/courier-gateway.port.ts`.

The shape is lifted from `apps/api/src/integrations/ithink/` so that
iThink can be re-housed here unchanged when we move it off apps/api.

## Scaffolded adapters (M1)

Two adapters are scaffolded — both **skeleton-only**. Every HTTP
roundtrip throws `NotImplementedException` with a TODO that names
the partner endpoint, HTTP method, and a reference doc URL. DI
wiring, module imports, mapper signatures, and the resolver
registration are all in place; the work to make them live is:

1. Replace each `NotImplementedException` body in the `client`,
   `services/*`, and `mappers/*` files with the real implementation
   (HTTP call via the client + DTO mapping).
2. Add the partner-specific env vars to
   `bootstrap/env/env.schema.ts` and `.env.example` (a `# ─── <vendor> ───`
   header per partner is the convention).
3. Add the partner secrets to `EnvService.assertProductionSecretsSafe`
   so production refuses to boot with the `replace-me-` placeholders.
4. Wire contract tests under `test/contract/<vendor>.<surface>.contract-spec.ts`.

### `delhivery/`

Standard adapter. Endpoints used by the stubs (verify against
https://docs.delhivery.com/ when filling them in):

| Surface         | Endpoint                                              |
| --------------- | ----------------------------------------------------- |
| Serviceability  | `GET /c/api/pin-codes/json/?filter_codes={pincode}`   |
| Create shipment | `POST /api/cmu/create.json` (form-encoded data wrap)  |
| Tracking        | `GET /api/v1/packages/json/?waybill={awb}`            |
| Cancel          | `POST /api/p/edit` with `cancellation=true`           |
| NDR reattempt   | `POST /api/p/edit` with `act=RE-ATTEMPT`              |
| RTO initiate    | `POST /api/p/edit` with `act=RTO`                     |
| Label PDF       | `GET /api/p/packing_slip?wbns={csv}&pdf=true`         |
| COD remittance  | `GET /api/cmu/get_invoice_report/?from_date=…&to_date=…` |
| Auth            | `Authorization: Token <DELHIVERY_API_TOKEN>`          |
| Webhooks        | Unsigned — IP allowlist + URL-secret comparison       |

Env vars: `DELHIVERY_API_URL`, `DELHIVERY_API_TOKEN`,
`DELHIVERY_CLIENT_NAME`, `DELHIVERY_PICKUP_LOCATION`,
`DELHIVERY_WEBHOOK_SECRET`.

### `shadowfax/`

Same shape, plus one extra service — `shadowfax-pickup.service.ts` —
for the on-demand rider-pickup scheduling that Shadowfax exposes on
its INTRACITY product line (Delhivery has no analogue, so this
surface is NOT promoted to the carrier-neutral port).

Shadowfax operates two product lines and the adapter chooses
between them at booking time:

| Product line | Trigger                                                          |
| ------------ | ---------------------------------------------------------------- |
| INTRACITY    | Same-pincode pickup/drop OR within Shadowfax's metro catchment   |
| EXPRESS      | Everything else (inter-city, reverse pickups, B2B)               |

See `adapters/shadowfax-courier.adapter.ts` for the picker comment
and the (TODO) selection policy.

Endpoints used by the stubs (verify against https://docs.shadowfax.in/):

| Surface              | Endpoint                                                       |
| -------------------- | -------------------------------------------------------------- |
| Serviceability (IC)  | `POST /api/v1/intracity/serviceability`                        |
| Serviceability (XPS) | `POST /api/v1/express/serviceability`                          |
| Create order (IC)    | `POST /api/v1/intracity/orders`                                |
| Create order (XPS)   | `POST /api/v1/express/orders`                                  |
| Track by order_id    | `GET /api/v1/orders/{order_id}/track`                          |
| Track by AWB         | `GET /api/v1/tracking/{awb}`                                   |
| Cancel               | `POST /api/v1/orders/{order_id}/cancel`                        |
| Label                | `GET /api/v1/orders/{order_id}/label`                          |
| NDR reattempt        | `POST /api/v1/orders/{order_id}/reattempt`                     |
| On-demand pickup     | `POST /api/v1/intracity/pickups` (Shadowfax-only surface)      |
| Auth                 | `Authorization: Token <SHADOWFAX_API_TOKEN>` (or Bearer)       |
| Webhooks             | HMAC-SHA256, header `X-Shadowfax-Signature`                    |

Env vars: `SHADOWFAX_API_URL`, `SHADOWFAX_API_TOKEN`,
`SHADOWFAX_CLIENT_CODE`, `SHADOWFAX_WEBHOOK_SECRET`.

Capability gaps: `initiateRto` is not supported by Shadowfax
programmatically — the adapter throws `CarrierCapabilityError`.
`registerPickup` is also a manual operation; the M1 policy
(`CarrierCapabilityError` vs partner-program API) is open.

## Adding a third adapter

The fastest path is to copy one of the two scaffolds:

```
cp -r src/integrations/delhivery src/integrations/<vendor>
# 1. Rename every file and identifier from `delhivery` to `<vendor>`.
# 2. Add the partner code to packages/logistics-contracts/src/partner.ts
#    (Zod enum) AND apps/logistics-facade/prisma/schema/index.prisma
#    (Partner enum) — see the three-step playbook in partner.ts.
# 3. Register the adapter in
#    apps/logistics-facade/src/modules/shipments/application/factories/courier-gateway.resolver.ts
#    (constructor inject + add a `case` in `forPartner` + add to `all()`).
# 4. Import the new integration module in
#    apps/logistics-facade/src/modules/shipments/shipments.module.ts.
# 5. Add the partner's env vars to bootstrap/env/env.schema.ts
#    and .env.example.
```

Step (3) is the only place the partner becomes "live" from the
shipments service's point of view — everything else is preparatory.

## Required file layout

For a new partner `<vendor>` (e.g. `delhivery`, `bluedart`, `shiprocket`):

```
src/integrations/<vendor>/
  clients/
    <vendor>.client.ts          # axios/fetch wrapper; auth, retries, OTEL spans
  services/
    <vendor>-order.service.ts   # createShipment / cancelShipment
    <vendor>-tracking.service.ts
    <vendor>-ndr.service.ts
    <vendor>-remittance.service.ts
  dtos/
    create-shipment.request.ts  # vendor-side wire shapes
    create-shipment.response.ts
    tracking-event.dto.ts
    ...
  mappers/
    <vendor>-shipment.mapper.ts # vendor wire shape <-> CreateShipmentPayload
    <vendor>-tracking.mapper.ts # vendor status code -> NormalizedStatus
  config/
    <vendor>.config.ts          # env var binding; secret resolution
  adapters/
    <vendor>-courier.adapter.ts # implements CourierGatewayPort
  <vendor>.constants.ts         # base URLs, retry budgets, status-code dictionary
  <vendor>.module.ts            # Nest module — providers + exports
  index.ts                      # re-export the module
```

## Step-by-step: adding a new partner

1. **Add the partner to the canonical enum** in
   `packages/logistics-contracts/src/partner.ts` and the Prisma
   `Partner` enum in `prisma/schema/index.prisma`. Same PR — DB
   migration and contract validation MUST stay aligned.

2. **Implement `CourierGatewayPort`** in
   `integrations/<vendor>/adapters/<vendor>-courier.adapter.ts`.
   The port lives at
   `modules/shipments/application/ports/outbound/courier-gateway.port.ts`
   and documents every method's contract. Unsupported methods throw
   `CarrierCapabilityError(adapter, capability)` — don't return empty.

3. **Map status codes** in
   `integrations/<vendor>/mappers/<vendor>-tracking.mapper.ts`.
   Every partner code MUST map to a `NormalizedStatus` value from
   `@sportsmart/logistics-contracts/tracking`. New normalised status
   values are a breaking change to consumers — coordinate before adding.

4. **Register the adapter** in
   `modules/shipments/application/factories/courier-gateway.resolver.ts`.
   The integration module's `onModuleInit` hook calls
   `resolver.register(adapter)` once the adapter is instantiated.

5. **Add the integration module to** `app.module.ts` — under
   `// business` (between `ShipmentsModule` and the others) so the
   adapter is constructed before the first request lands.

6. **Add env vars** to `bootstrap/env/env.schema.ts` and
   `.env.example`. Group them with a `# ─── <vendor> ───` header.
   Required-in-prod secrets go through `assertProductionSecretsSafe`
   with the `replace-me-` placeholder pattern.

7. **Write contract tests** under
   `test/contract/<vendor>.<surface>.contract-spec.ts`. Run them
   against the partner's sandbox using fixture credentials checked
   in under `test/fixtures/<vendor>/`. Each public method gets a
   pair: a happy-path booking and a partner-side error path
   (rejected pincode, weight over limit, signature replay).

8. **Document the partner-side webhook secret rotation** in the
   adapter's `README.md` (next to `<vendor>.module.ts`). Ops needs
   to know where to update the signing secret when partners rotate.

## What lives where — quick reference

| Concern                      | Location                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| Partner-side wire shapes     | `integrations/<vendor>/dtos/`                                    |
| Domain wire shapes (shared)  | `@sportsmart/logistics-contracts`                                |
| Per-partner mappers          | `integrations/<vendor>/mappers/`                                 |
| Carrier-neutral interface    | `modules/shipments/application/ports/outbound/courier-gateway.port.ts` |
| Adapter implementations      | `integrations/<vendor>/adapters/<vendor>-courier.adapter.ts`     |
| Resolver / strategy registry | `modules/shipments/application/factories/courier-gateway.resolver.ts` |
| Status-code dictionaries     | `integrations/<vendor>/<vendor>.constants.ts`                    |
| Webhook signing secrets      | Env var per partner, declared in `bootstrap/env/env.schema.ts`   |

## Cross-references

* iThink reference implementation in apps/api:
  `apps/api/src/integrations/ithink/` — DO NOT edit; it stays
  frozen until the migration PR formally lifts it here.
* Port contract: `modules/shipments/application/ports/outbound/courier-gateway.port.ts`
* Shipment payload schema: `@sportsmart/logistics-contracts/shipment`
* Tracking status enum: `@sportsmart/logistics-contracts/tracking`
