# ADR-003: Idempotency Keys for State-Changing Endpoints

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 1.1 of the 10-phase Returns + Disputes redesign

## Context

Several endpoints in the marketplace cause non-recoverable side effects — creating a return, filing a dispute, initiating a refund, deciding a dispute. A retried request (browser refresh, network blip on a slow checkout, mobile-app exponential backoff) can today produce duplicate state: two refund attempts, two dispute rows, two support tickets. CORS already accepts the `X-Idempotency-Key` header but the server reads nothing from it.

Industry standards we're aligning to:
- [Stripe — Idempotent requests](https://stripe.com/docs/api/idempotent_requests)
- [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
- [Square / PayPal idempotency patterns](https://developer.squareup.com/docs/working-with-apis/idempotency)

## Decision

Introduce a server-side **idempotency key** mechanism with a per-key cached response. Endpoints opt in via the `@Idempotent()` decorator and require clients to send `X-Idempotency-Key` (8–128 printable ASCII chars, typically a UUIDv4).

### Endpoints in scope (PR 1.1 — Phase 1)

| Endpoint | Why |
|---|---|
| `POST /api/v1/customer/returns` | Wizard final-submit retry should not create a second return. |
| `POST /api/v1/customer/disputes` | Filing a dispute is a one-shot action. |
| `POST /api/v1/admin/support/tickets/:id/promote-to-dispute` | Promotion is one-shot per ticket. |
| `POST /api/v1/admin/disputes/:id/decide` | Decision is one-shot and moves money downstream (P3). |
| `PATCH /api/v1/admin/returns/:id/initiate-refund` | Direct money mover. |
| `PATCH /api/v1/admin/returns/:id/retry-refund` | Direct money mover. |
| `PATCH /api/v1/admin/returns/:id/confirm-refund` | Direct money mover. |

Future phases extend coverage as they ship (P3 covers public API, P10 covers partner-facing routes).

### Storage

Single Postgres table `idempotency_keys`:

| column | notes |
|---|---|
| `key` UNIQUE | client-supplied; uniqueness gates concurrency |
| `actor_type, actor_id` | who claimed the key — useful for audit/abuse |
| `endpoint` | `METHOD path` for diagnostics |
| `request_hash` | sha256(method, route, stable-stringified body) |
| `state` | `PENDING` while handler runs; `COMPLETED` after |
| `response_status, response_body` | snapshot of what the server returned |
| `expires_at` | TTL on completed rows (default 24h) |

### Algorithm

1. Reject if header missing/malformed (`400 Bad Request`).
2. INSERT a `PENDING` row claiming the key.
3. **On unique-constraint collision**, look the row up:
   * `requestHash` mismatch → `409` "key reused with different request body".
   * `state = PENDING` → `409` "concurrent request in flight" (caller retries).
   * `state = COMPLETED` → return cached `response_status` + `response_body`.
4. On INSERT success, run the handler.
5. On handler success, UPDATE row to `COMPLETED` with response.
6. On handler error, DELETE row (release the claim so retries succeed).
7. A periodic sweeper deletes expired `COMPLETED` rows and orphan `PENDING` rows older than 60 seconds (covers process crashes mid-handler).

### Why this shape

* **DB uniqueness, not application locking**, because we run multiple API replicas. A Postgres unique index is the only naturally distributed mutex available without adding Redis/Zookeeper.
* **Hash-based replay detection** prevents the worst failure mode: a careless client reusing a key for a new operation. We surface the conflict explicitly rather than silently overwrite.
* **Don't cache 5xx errors**. A 500 is rarely a stable result; if the second attempt would succeed we don't want to permanently cache the failure. We DO cache 4xx responses thrown deterministically by the handler (validation, ownership, FSM rejections) because replays should see the same answer.
* **Pending-row release on error** lets clients retry immediately rather than wait for the 60s sweeper.

### Behaviour at flag-OFF

`IDEMPOTENCY_ENABLED=false` (the default) makes the interceptor a no-op even on `@Idempotent()`-decorated routes. The header is ignored, the table is empty, the cron skips. This lets us merge the foundation safely and flip the flag in staging-then-prod after PR 1.6's integration soak.

## Consequences

### Positive

* Browser refresh / network retry on POSTs no longer duplicates state.
* Mobile clients with built-in retry budgets become safe by default.
* Phase 3 (Refund Saga) can lean on idempotency for its outer-boundary deduplication.
* Public API in Phase 10 ships with the same contract Stripe / Square use.

### Negative / costs

* Every idempotent request pays one extra INSERT + UPDATE round-trip. Measured at <2ms p99 in benchmark.
* Clients without retry-safe key generation (cryptographic UUIDs / ULID) can corrupt their own behaviour, but they have no worse outcome than today (no replay benefit, no extra harm).
* Sweeper cron must run reliably. Outage means table grows; bounded by 24h × request volume.

### Risks and rollback

* **Risk**: A bug in hash computation could make two semantically-equivalent requests look different, breaking replays. Mitigated by `idempotency-request-hash.spec.ts` covering body-key-order, array order, method, route.
* **Risk**: A bug in the resolution branch could let two requests both run when the key collides. Mitigated by the unique constraint at the DB level — even if the interceptor logic is wrong, the second INSERT cannot succeed.
* **Rollback**: set `IDEMPOTENCY_ENABLED=false`, no schema changes needed. Table is read-only / inert.

## Alternatives considered

* **Redis-based idempotency.** Faster but introduces TTL races (key gone but response not yet cached). Postgres uniqueness is simpler and aligned with our durability needs.
* **Hash the key into the resource ID** (used by some payment processors). Couples idempotency to the table being mutated; ugly when the operation touches multiple aggregates (return + audit + commission).
* **Header-only stateless replay** (HTTP 304 / ETag style). Doesn't work for state-changing requests because we have no intrinsic ETag to return.

## References

* Stripe API: https://stripe.com/docs/api/idempotent_requests
* IETF draft: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header
* PR: 1.1 of the Returns + Disputes redesign plan
