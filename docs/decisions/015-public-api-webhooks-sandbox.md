# ADR-015: Public API keys, webhooks, sandbox mode, OpenAPI split

**Status**: Accepted

**Date**: 2026-05-06

**Phase**: 10 (PRs 10.1–10.5) of the 10-phase Returns + Disputes redesign

## Context

Phase 0 audit on the partner-integration story:

* No first-class API key model. Internal integrations used admin JWTs
  the way you'd use an API key — long-lived (re-auth via refresh
  token), no per-key rate limit, no scoping. A leaked admin token =
  full marketplace access until rotated.
* No webhook delivery infrastructure. Partners polled. Both sides
  paid for it (their poll loop, our DB). Returns happening at 3 AM
  meant a 30-min reconciliation lag on the partner side.
* No sandbox surface. Partners testing a new integration practiced
  on production. The blast radius from a buggy integration was real
  money.
* Swagger published a single spec for everything. Internal admin
  routes, customer-only flows, and partner endpoints all interleaved
  in one document — confusing for partners and a leak surface for
  internals.

Phase 10 closes all four. This is the last phase of the redesign.

## Decision

Five PRs:

| PR | Lands |
|---|---|
| **10.1** | `api_keys` + `api_key_usages` tables; `ApiKeyService` (mint/verify/revoke); `ApiKeyRateLimiter` (in-memory token bucket per key); `ApiKeyAuthGuard`. Plaintext shown once at mint, only SHA-256 hash persisted. |
| **10.2** | `webhook_endpoints` + `webhook_deliveries` tables; HMAC SHA-256 signing (Stripe-style `t=<ts>,v1=<hex>`); `WebhookDeliveryService` with idempotent enqueue + per-attempt retry schedule (default `[30s, 2m, 10m, 1h, 6h, 24h]`). Cron + integration-test endpoint land in follow-up. |
| **10.3** | `SandboxModeService`. Reads `req.apiKey.environment` to branch test vs live; `assertLiveOnly()` defensive guardrail; deterministic `fakeRefundId(seed)` helpers. |
| **10.4** | Swagger split: `/api/docs` (internal, JWT auth) and `/public/v1/docs` (partner, API-key auth). Path-prefix filtering; partner doc surfaces only routes mounted under `/public/v1/`. |
| **10.5** | This ADR + runbook. |

### Why a separate API key surface and not "JWT with longer TTL"

Two reasons:

1. **Scoping.** API keys carry a `scopes` array. JWTs carry per-actor
   role grants. We want a partner key with `orders:read,refunds:write`
   that can never call `/admin/sellers/...` regardless of what JWT
   claims look like. Different model, different storage, different
   guard.
2. **Revocation.** A leaked JWT survives until expiry (Phase 1 sets
   that to days). A leaked API key flips to REVOKED in the DB and
   the next request 401s instantly. The trade-off is one extra DB
   read per request — measured at <1ms with the unique index, dwarfed
   by everything else on the path.

### Why the rate limiter is in-memory per pod

The fairness guarantee is per-key. A multi-pod deploy gets per-pod
buckets — a malicious key hammering the API can technically get
`rate × pods` requests through before any single bucket trips. The
WAF / load-balancer is the actual abuse-prevention line; this layer
is for fair-share, and per-pod is fine for that.

If/when we need exact cross-pod limits, Redis is the obvious next
step (atomic INCR + TTL). The interface stays the same — the
`ApiKeyRateLimiter` class becomes Redis-backed. No call-site churn.

### HMAC signing, not JWT-style token

Webhook payloads are signed with HMAC-SHA-256 over `<timestamp>.<body>`.
Considered:

* **Bearer token** — partner doesn't know what they got. They'd need
  to trust transport, which fails on man-in-the-middle.
* **JWT** — adds a JSON parsing layer for the partner. HMAC is
  smaller, simpler, and partner-side verification is a single
  `crypto.createHmac` call in any language.

The timestamp prefix lets partners reject replays (recommended 5-min
window, documented in the runbook).

### Idempotent webhook enqueue via UNIQUE constraint

`(endpointId, eventName, dedupeKey)` is a unique index. Domain code
enqueueing the same event twice (because the outbox replayed, or
because the cron retried) collapses to one delivery row. The
delivery service's `enqueue()` swallows P2002 unique-violation.

`dedupeKey` shape is the originating event's aggregateId + a stable
hash of the payload — domain code constructs it; webhook layer
doesn't infer.

### Sandbox identity = one column on api_keys

The simpler design considered "every model gets a `tenantId` and we
have a synthetic test tenant". Rejected because:

* The data plane stays the same. A test refund doesn't move money
  but otherwise creates the same RefundInstruction / SAGA / outbox
  rows as a real refund. Sandbox mode is a read/write switch, not a
  separate database.
* Test traffic and live traffic share infrastructure (same pods,
  same DB pool). The only branch is at the integration boundary
  (gateway call, email send, SMS). The single boolean at the API
  key is the cheapest place to make that decision.

### `/api/docs` and `/public/v1/docs` published from one app

We considered standing up a separate "public API" app/service.
Rejected because:

* It would duplicate auth, logging, metrics, rate-limit code.
* Domain logic (refund a return, get a dispute) is the same; we
  don't want two implementations.
* The partner-vs-internal distinction is a presentation-layer
  concern. Path prefix + spec filter cover it.

The `/public/v1/...` controllers don't exist yet — Phase 10 ships
the spec scaffolding so they have somewhere to land. Each follow-up
PR adding a partner-facing endpoint mounts it under `/public/v1/`
and contributes to that spec automatically.

## Consequences

* Every public endpoint that ships from here on must be mounted under
  `/public/v1/` AND use `@UseGuards(ApiKeyAuthGuard)`. Path prefix
  drives Swagger inclusion; guard drives auth.
* The webhook signing secret is plaintext in `webhook_endpoints.signing_secret`.
  This is necessary — we have to re-sign on every retry — but it
  means a DB compromise leaks all signing keys. Mitigated by:
  encryption-at-rest at the Postgres layer (already on); rotation
  endpoint (creates a new secret + invalidates the old) is a follow-up.
* Sandbox mode trusts the `environment` flag on the API key. A
  compromised LIVE key can't pivot to TEST data; a TEST key cannot
  upgrade itself. Admins can re-issue keys with different
  environments — the key-id changes, partner has to re-deploy.
* OpenAPI doc rendering is paid at boot (the JSON gets generated
  once when `setupSwagger(app)` runs). No per-request cost.

## Alternatives considered

* **Stripe-style API versioning** (`/v1/`, `/v2/` per release). Rejected
  for v1 — the partner surface is small enough that we can iterate
  freely. Versioning earns its complexity once we have multiple
  partners on different versions.
* **Webhooks via Kafka / SQS** instead of HTTP-POST-with-retry.
  Postgres + cron is sufficient at our partner count (single digits)
  and avoids the new dependency.
* **JWT-signed webhooks** — partner-side verification needs JSON parse
  + JWT lib. HMAC needs `crypto.createHmac`. Smaller surface for
  partners running in older runtimes.
* **A shared sandbox database** isolated from production. Rejected
  per the decision section — same shape, different switch is cleaner.

## Migration / rollout

* Apply migrations 20260506180000 (api keys), 20260506190000 (webhooks).
* No flag for API key minting — admins create keys via
  `POST /admin/api-keys` (controller in follow-up; for now insert
  rows directly).
* `WEBHOOK_DELIVERY_ENABLED=false` by default. Off until at least
  one endpoint exists in the database.
* Sandbox mode requires no flag — opt-in per request via the API
  key's `environment` column.
* Swagger split is automatic on next deploy. Internal `/api/docs`
  unchanged in shape; new `/public/v1/docs` renders an empty spec
  until partner endpoints land under that prefix.
* Operational runbook:
  [docs/runbooks/phase-10-public-api-webhooks.md](../runbooks/phase-10-public-api-webhooks.md).

## Closing note — Phase 10 is the final phase

This ADR completes the 10-phase Returns + Disputes redesign:

| Phase | Theme | ADR |
|---|---|---|
| 1 | Foundation | 003 / 004 / 005 / 006 |
| 2 | Durable events (outbox) | 008 |
| 3 | Unified Refund System | 009 |
| 4 | Authorization | 010 |
| 5 | Business lifecycle hardening | (no dedicated ADR) |
| 6 | SLA + queues + risk | 011 |
| 7 | Evidence integrity + retention + erasure | 012 |
| 8 | Audit anchors + notifications + cron + metrics | 013 |
| 9 | Realtime + i18n + timeline + portals | 014 |
| 10 | Public API + webhooks + sandbox + OpenAPI | 015 |

Each phase shipped with a runbook for the cutover, flag-gating where
relevant, and tests pinning the trust boundaries. The redesign as a
whole is not a flag-day — every layer can roll independently.
