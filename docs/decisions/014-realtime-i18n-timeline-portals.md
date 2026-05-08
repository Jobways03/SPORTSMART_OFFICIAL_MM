# ADR-014: Realtime push, i18n catalogue, case timeline, seller portal

**Status**: Accepted

**Date**: 2026-05-06

**Phase**: 9 (PRs 9.1–9.5) of the 10-phase Returns + Disputes redesign

## Context

Portal-side gaps from the Phase 0 audit:

* **No realtime updates.** Customers refresh their order page to see
  if a return has been approved. Admins poll the queue list every 30s.
  Both work, both feel sluggish, both pay needless DB load.
* **English-only UX.** Returns / disputes / refunds all surface
  English copy regardless of the user's preferred language. India is
  not English-first; Hindi / Tamil / Marathi support is table stakes
  for a marketplace serving the regional market.
* **Fragmented case views.** A customer with a return that escalated
  into a dispute then a refund sees three disconnected pages — one
  per resource. Reconstructing the chronological story requires
  cross-referencing.
* **Seller portal limited to filing** disputes; no equivalent
  "respond to a customer-filed complaint" surface. The
  seller-disputes controller had pieces but no narrative wiring.

Phase 9 ships thin layers for each.

## Decision

Five PRs:

| PR | Lands |
|---|---|
| **9.1** | `PortalPushService` + `PortalStreamsController` — Server-Sent Events to scope-bound subscribers. Three scopes: `admin-queue`, `customer-case`, `seller-disputes`. Listens to the in-process event bus with @OnEvent decorators. |
| **9.2** | `i18n_messages` table + `MessageCatalogueService` (with 60s cache + fallback chain en-IN→en) + `LocaleResolver` (override → user pref → Accept-Language → default). 5 supported languages: en, hi, ta, kn, mr (each with regional `-IN` variant). |
| **9.3** | `CaseTimelineService` joining return-status-history + dispute-messages + refund-transactions + ticket-messages. Two endpoints: `GET /portal/timeline/:caseKind/:caseId` (customer view, ABAC-enforced) and `GET /admin/timeline/:caseKind/:caseId` (full payload). |
| **9.4** | Verifies the seller dispute portal already exists (the SellerDisputesController shipped in Phase 5) — ABAC ownership via `getDisputeForActor`, internal-note filtering. No new code, just confirmed. |
| **9.5** | This ADR + runbook. |

### SSE over WebSocket

We considered both. SSE wins for the portal use case:

| | SSE | WebSocket |
|---|---|---|
| Direction | Server → client only | Bidirectional |
| Transport | Plain HTTP/1.1 | WS upgrade |
| Auto-reconnect | Built into EventSource | Manual ping/pong |
| Proxy compat | Standard CORS / nginx | Often needs explicit upgrade rules |
| Auth | Standard cookie / bearer | Same, but per-connection |

Portals don't need bidirectional channels — clients send mutations
through normal POST/PATCH endpoints and receive updates on the SSE
stream. WebSocket's overhead (and the surface area it introduces in
our reverse proxy + CORS config) doesn't earn anything we'd use.

If a future surface needs bidirectional (live chat between buyer +
seller in a dispute), we'll add WebSocket then. Until that day, SSE
keeps the operational footprint minimal.

### One push service, three scopes

The push service is one class with a `match()` switch on subscriber
scope. Considered separate services per scope; rejected because:

* The fanout logic is identical (write SSE frame to a Response).
* Subscriber registry is shared (ad-hoc connection pool).
* The keepalive interval is shared.

Adding a new scope is a one-method change to `match()`.

### i18n stored in the DB, not in code

Two reasons:

1. **Translators aren't engineers.** Edits to copy must be possible
   without a deploy. A translator opens the admin UI for the i18n
   table, edits Hindi text, saves; it propagates within 60s.
2. **Per-tenant overrides** are likely in the future (Nova tenant
   wants slightly different copy from main marketplace). The schema
   already has the right shape; we'd just add a `tenantId` column.

Trade-off: the catalogue is in DB so an early-boot crash means no
i18n. We mitigate with the loud-fallback (the key string itself
renders), so a totally broken catalogue produces visible-but-not-broken
UI.

### Locale resolution priority

```
explicit override (?locale=hi) >
user profile preferred locale >
Accept-Language q-weighted >
DEFAULT_LOCALE ('en')
```

The override is for QA / support staff impersonating a user's
locale. The user-profile pref is sticky across sessions. The
Accept-Language fallback handles the "user has no profile yet"
case (signup / public pages).

### Case timeline: redact at the join, not at the render

The redaction happens inside `CaseTimelineService` based on
`viewerKind`. The alternative was to return all data + let the
controller filter — rejected because:

* Easier to leak from the controller layer (one missing filter and
  internal notes go to the customer).
* The redaction logic is the privacy boundary; it belongs at the
  earliest possible enforcement point.

Internal notes never reach a non-admin viewer's response body.

### Why no SellerSse stream for seller-portal?

There IS one. `seller-disputes` scope on `PortalPushService` covers
seller portal needs. The PR 9.4 controller surface predates Phase 9
and was already built; we just verified it works alongside the new
push channel.

## Consequences

* SSE adds one HTTP-long-poll connection per active portal viewer.
  At our scale (few hundred concurrent admins / customers), this is
  fine. At marketplace scale (10K+ concurrent connections), the per-pod
  open-FD count needs sizing. Tracked as a Phase 11+ concern.
* The i18n table will accumulate ~500-1000 keys × 5 locales = ~5000
  rows. Trivial.
* The case timeline endpoint runs 2-4 SELECTs per call (not joined
  in Postgres because the source tables are owned by different
  modules). Latency is dominated by the slowest of those selects;
  current p95 in dev is <150ms.
* The fallback-chain renderer means a partially-translated Hindi
  catalogue still ships English where keys are missing — far better
  than blank text.
* Controllers calling SSE return without setting a body — Nest's
  default response handling is bypassed via `@Res()`. Test runners
  that expect a JSON body need to recognise the SSE content-type.

## Alternatives considered

* **GraphQL subscriptions** for realtime. Would force adopting
  GraphQL on the API surface; we're REST + RPC-ish and that suits
  the team. Rejected.
* **Webhooks instead of SSE for admin queue.** Webhooks need a
  publicly-reachable target on the admin's side — fine for ops
  integrations, terrible for "the dashboard tab my admin already
  has open should update".
* **JSON files for i18n** (one file per locale, deployed with code).
  Faster reads, but every copy edit requires a deploy. Translators
  shouldn't have to push to git. Rejected.
* **Separate timeline tables per resource** (`return_timeline`,
  `dispute_timeline`). The join is cheap and storing pre-rendered
  events would duplicate state. Rejected.
* **Server push via long-poll** instead of SSE. The fundamental
  semantics are identical; SSE just standardises the framing and
  reconnect.

## Migration / rollout

* Apply migration 20260506170000 (`i18n_messages`).
* SSE: no flag — always on once deployed. Endpoints return 401
  without auth. Idempotent — connecting twice from the same client
  works fine (each gets its own `id`).
* i18n: seed the catalogue separately. Phase 9 doesn't ship a seed
  file because the keys are domain-driven and grow per-feature. Each
  domain PR that uses `MessageCatalogueService.render(...)` adds
  its keys via migration or seed.
* Case timeline: no flag. The endpoints return 404 for unknown
  case IDs and 403 for not-yours, so a client that calls the wrong
  shape sees standard problem-types.
* Operational runbook:
  [docs/runbooks/phase-9-realtime-i18n-timeline.md](../runbooks/phase-9-realtime-i18n-timeline.md).
