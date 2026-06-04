# @sportsmart/logistics-facade

A standalone NestJS service that aggregates Indian courier APIs
(Delhivery, Bluedart, Shiprocket, etc.) behind one carrier-neutral
HTTP surface. `apps/api` consumes this service to book shipments,
ingest tracking events, run NDR/RTO/QC, and reconcile COD remittance.

> **Status:** M0 — scaffolding only. Every business endpoint returns
> `501 Not Implemented`. The module structure, contracts, Prisma
> schema, and inter-service auth are all in place so partner adapters
> (M1+) drop in without touching the wiring.

## Boot

```bash
# from the repo root
pnpm install
pnpm --filter @sportsmart/logistics-facade prisma:generate
pnpm --filter @sportsmart/logistics-facade dev
```

The service listens on `LOGISTICS_FACADE_PORT` (default `4100`).
Swagger UI: <http://localhost:4100/docs>. Health: <http://localhost:4100/api/v1/health>.

## Database

Owns its own Postgres database — schemas listed under
`prisma/schema/*.prisma` (multi-file mode, same as apps/api):

| File             | Models                                       |
| ---------------- | -------------------------------------------- |
| `index.prisma`   | Datasource, generator, shared enums          |
| `shipments.prisma` | `Shipment`                                   |
| `tracking.prisma`  | `TrackingEvent`                              |
| `returns.prisma`   | `Return`                                     |
| `ndr.prisma`       | `NdrAttempt`                                 |
| `rto.prisma`       | `RtoAttempt`                                 |
| `qc.prisma`        | `QcRecord`                                   |
| `cod.prisma`       | `CodRemittance`, `CodRemittanceLine`         |
| `partners.prisma`  | `PartnerHealth`                              |
| `webhooks.prisma`  | `WebhookEvent`                               |
| `idempotency.prisma` | `IdempotencyKey`                           |

Bring up a fresh DB locally:

```bash
pnpm --filter @sportsmart/logistics-facade prisma:migrate-dev
```

## Environment

See `.env.example`. Key variables:

| Var                       | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `LOGISTICS_FACADE_PORT`   | HTTP listen port (default 4100)                               |
| `LOGISTICS_DATABASE_URL`  | Postgres URL — facade owns its own DB                         |
| `LOGISTICS_REDIS_URL`     | Redis URL — webhook dedup, future leader locks                |
| `INTERNAL_API_KEY`        | Shared secret for `Authorization: ApiKey <token>` (M0; M1 replaces with per-caller keys) |
| `CORS_ORIGINS`            | Comma-separated origins permitted to hit `/docs` in non-prod  |
| `LOG_LEVEL`               | error / warn / info / debug / verbose                         |
| `OTEL_ENABLED`            | `true` to start the OpenTelemetry SDK on boot                 |

## Auth model

Every business route requires `Authorization: ApiKey <token>` where
`<token>` matches `INTERNAL_API_KEY` (M0). The guard is in
`core/api-keys/api-key-auth.guard.ts`; the decorator wrapper
`@RequireApiKey()` composes `UseGuards(ApiKeyAuthGuard)` +
`ApiSecurity('ApiKey')` so docs and runtime check stay in sync.

`/health` and `/readiness` are intentionally unauthenticated — LBs
don't carry tokens, and the bodies leak no secrets.

Inbound partner webhooks at `/webhooks/:partner` are authenticated by
HMAC signature, not ApiKey. Signing format is Stripe-style
`t=<unix>,v1=<sha256>` — see `core/webhooks/webhook-signer.ts`.

## Tests

```bash
# unit
pnpm --filter @sportsmart/logistics-facade test

# end-to-end smoke (boots the app, asserts 200/401/501 contract)
pnpm --filter @sportsmart/logistics-facade test:e2e
```

The smoke test mocks Prisma + Redis so it runs without external
services. Adapter-level contract tests against partner sandboxes
ship with each partner integration PR.

## Adding a new courier

See `src/integrations/README.md`. The short version: implement
`CourierGatewayPort`, map status codes to `NormalizedStatus`,
register with `DefaultCourierGatewayResolver`, add env vars,
write contract tests.

## Design doc

Architecture and roadmap live alongside the Word deliverable in
`docs/` (frozen — do not edit here). The M0 → M3 plan is laid out
across:

* **M1** — Forward shipping (one adapter, e.g. Delhivery)
* **M2** — Returns, NDR, RTO, QC
* **M3** — COD remittance, partner health, BI export

## Layout

```
src/
  main.ts                 # OTEL init -> Nest -> helmet -> compression -> listen
  app.module.ts           # imports every bootstrap / core / business module
  bootstrap/              # env, db, redis, events, logging, scheduler, security, docs, tracing
  core/                   # api-keys guard, idempotent decorator, RFC 7807 filter, Zod pipe,
                          # webhook signer, FSM, paise helpers, health
  modules/                # shipments, tracking, returns, ndr, rto, qc, cod-remittance,
                          # partners, webhooks (central inbound dispatch)
  integrations/           # one folder per courier (none yet)
prisma/schema/            # multi-file Prisma schema
test/                     # jest config + e2e smoke
```

Each business module follows the apps/api `discounts` shape:
`presentation/controllers/`, `application/services/`,
`application/dto/`, `application/ports/outbound/`,
`infrastructure/repositories/`, `domain/events/`.
