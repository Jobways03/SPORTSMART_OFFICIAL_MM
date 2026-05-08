# Phase 9 — Realtime, i18n, case timeline runbook

**Owner**: Platform / Frontend
**ADR**: [014 — Realtime push, i18n catalogue, case timeline, seller portal](../decisions/014-realtime-i18n-timeline-portals.md)
**Status**: Ready

This runbook covers three independent rollouts: SSE streams, i18n
catalogue, and case timeline. None is gated by a feature flag —
deploying the migrations and code is the rollout.

## Pre-flight

```bash
pnpm --filter @apps/api exec prisma migrate deploy
```

Required tables:
* `i18n_messages` (PR 9.2)

Other surfaces (PortalPushService, CaseTimelineService) are
infra-only and ship with the deploy.

## Rollout 1 — SSE portal streams

### Verify connection

```bash
curl -N -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.production.example.com/portal/streams/admin-queue
```

Expected: connection stays open, periodic `: keepalive <ts>` lines
every ~25s, an initial `event: ready` frame on connect.

Once a domain event fires (return created, dispute message added,
etc.), the corresponding `event: <name>` frame appears on the
matching subscribers' streams.

### Reverse-proxy notes

* nginx: ensure `proxy_buffering off;` on the `/portal/streams/*`
  location. The controller already sets `X-Accel-Buffering: no` but
  belt-and-braces.
* CDN: bypass entirely or set TTL to 0. SSE is the opposite of
  cacheable.
* Connection limits: keep `keepalive_timeout` longer than the SSE
  client's expected reconnect window (~30s default).

### Operational notes

* `PortalPushService` exposes `subscriberCount()` for ops curiosity
  but isn't surfaced via HTTP. If you need a count, add a metrics
  gauge in a follow-up PR.
* Each pod owns its own subscriber set. Behind a load balancer with
  sticky sessions, that's fine. Without sticky sessions, a client
  reconnecting to a different pod re-subscribes — no message loss
  because the events are evented from the bus, not buffered per-pod.

## Rollout 2 — i18n catalogue

### Seed initial keys

There's no shipped seed because keys are domain-driven. Each domain
PR adds its own keys via SQL or a per-module seed script. To add a
key from the database directly:

```sql
INSERT INTO i18n_messages
  (locale, key, body, short_body, description, created_at, updated_at)
VALUES
  ('en', 'returns.timeline.approved',
    'Your return {{returnNumber}} has been approved.',
    'Return {{returnNumber}} approved.',
    'Notification when admin approves a return.',
    NOW(), NOW()),
  ('hi', 'returns.timeline.approved',
    'आपका वापसी अनुरोध {{returnNumber}} स्वीकार कर लिया गया है।',
    NULL,
    NULL,
    NOW(), NOW());
```

The catalogue caches per-locale for 60 seconds. Edits propagate
within that window without a redeploy.

### Verify rendering

A unit test proves `substitute` is correct, but in staging:

```bash
# Hit any endpoint that calls MessageCatalogueService.render(...)
# (none yet — domain modules will adopt these in follow-up PRs).
```

### Adding a new locale

1. Add the locale tag to `I18N_SUPPORTED_LOCALES` in
   `src/core/i18n/locale-resolver.ts`.
2. Insert rows for that locale in `i18n_messages`.
3. Deploy.

### Forcing a locale (QA + support)

Pass `?locale=<tag>` on any request whose handler calls the
catalogue. The override beats the user's profile + Accept-Language.

### Rollback

The catalogue is read-only at runtime; "rollback" means deleting
the new rows. The renderer falls back to the catalogue's previous
state (cached for 60s, then the next read returns whatever's in
the table).

## Rollout 3 — Case timeline

### Verify endpoints

```bash
# Customer view (own case):
curl -H "Authorization: Bearer $USER_TOKEN" \
  https://api.production.example.com/portal/timeline/return/<RETURN_ID>

# Admin view (any case):
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.production.example.com/admin/timeline/dispute/<DISPUTE_ID>
```

Customer trying to view another customer's case: 403.
Unknown caseKind: 400.
Unknown caseId: 404.

### Latency

Each timeline call runs 2-4 SELECTs (case row + status history +
messages + refund txns, depending on caseKind). With the indexes
already in place from Phases 1-7, expect p95 <150ms in production.
If you see this drift higher:

```sql
EXPLAIN ANALYZE
  SELECT * FROM return_status_histories
  WHERE return_id = '<id>' ORDER BY created_at ASC;
```

Should be an index scan on `(return_id, created_at)`.

## Common gotchas

* **SSE frames wrapped in `data:` strings on the client.** That's
  the protocol. The browser EventSource API parses it for you;
  raw `curl -N` shows the wire format.
* **`event: ready` arrives but no further events.** The subscriber's
  scope filter doesn't match the event payloads. Check the event
  bus is publishing events with the expected shape (e.g.
  `payload.customerId` set on customer-scoped streams).
* **i18n key renders as the literal string.** No row in the catalogue
  for that key in the resolved locale chain. Check the WARN log:
  `i18n miss: key="..." tried [...]`.
* **Customer timeline returns 403 for own case.** The
  `assertViewerAccess` check compares `case.customerId === viewerId`.
  If your dispute was filed by an admin on behalf of a buyer
  (`filedByType=ADMIN`), the customerId will be null — no customer
  can view it. Use the admin endpoint for those.
* **Timeline event order looks wrong.** All events are sorted by
  `at` (their original timestamp), not by insertion order. Check
  the source tables' timestamps if you're seeing surprising order.
