# Phase 8 — Audit anchors, notification gate, cron observability, metrics

**Owner**: Platform / SRE / Compliance
**ADR**: [013 — Audit anchors, notification gate, cron observability, metrics](../decisions/013-audit-notifications-cron-metrics.md)
**Status**: Ready to soak

This runbook covers four independent enablement tasks. Each can flip
on its own; nothing here cascades.

## Pre-flight

```bash
pnpm --filter @apps/api exec prisma migrate deploy
```

Required tables:
* `audit_chain_anchors` (PR 8.1)
* `notification_suppressions` (PR 8.2)
* `cron_runs`, `cron_heartbeat_targets` (PR 8.3)

## Task 1 — `AUDIT_CHAIN_ANCHOR_ENABLED=true`

```bash
kubectl -n staging set env deploy/api AUDIT_CHAIN_ANCHOR_ENABLED=true
```

Hourly cron writes one anchor per run. After ~1 hour:

```sql
SELECT sequence, up_to_audit_log_id, rows_covered, created_at
FROM audit_chain_anchors
ORDER BY sequence DESC
LIMIT 5;
```

Then exercise the fast-verify endpoint:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.staging/example.com/admin/audit/verify-chain-fast
```

Expected: `data.anchorSequence` is populated, `data.breaks` is empty.
A `breaks` array with entries means tampering or a chain construction
bug — escalate before flipping the prod flag.

### Rollback

```bash
kubectl -n staging set env deploy/api AUDIT_CHAIN_ANCHOR_ENABLED=false
```

Existing anchors stay; the verifier still uses them but no new ones
are written.

## Task 2 — Notification suppression / gate

The gate ships in PR 8.2 but **does not** auto-wire into existing
sends. Domain modules that emit notifications adopt the gate by
calling `notificationGate.check(...)` before each send.

Until they do, the gate is observability-only — it doesn't affect
sends, but admins can manually populate the suppression list:

```sql
INSERT INTO notification_suppressions
  (id, channel, destination, reason, expires_at, added_by, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'EMAIL', 'bounced@example.com', 'BOUNCED', NULL, NULL, NOW(), NOW());
```

Once the call sites adopt the gate, this row will block sends to
that destination immediately (60s cache TTL).

### Webhook integration (follow-up)

The gate exposes `addSuppression(...)` for use from the email-provider
bounce / complaint webhook. Wire that webhook in a separate PR — it's
the highest-volume reason a suppression row gets created.

## Task 3 — Cron heartbeat

### Seed targets

There's no shipped seed because every environment has a different
crontab. Insert your expected cadences:

```sql
INSERT INTO cron_heartbeat_targets
  (job_name, expected_interval_seconds, tolerance_multiplier, enabled, description, created_at, updated_at)
VALUES
  ('idempotency.sweeper',         600,   3, true, 'Idempotency key sweep — every 10 min', NOW(), NOW()),
  ('outbox.publisher',            5,     6, true, 'Outbox publisher — every 5 sec',       NOW(), NOW()),
  ('sla.breach-detector',         300,   3, true, 'SLA breach detector — every 5 min',    NOW(), NOW()),
  ('retention.enforcer',          86400, 3, true, 'Retention enforcer — daily 03:00',     NOW(), NOW()),
  ('integrity.verifier',          3600,  3, true, 'Integrity verifier — hourly',          NOW(), NOW()),
  ('audit.chain-anchor',          3600,  3, true, 'Audit chain anchor — hourly',          NOW(), NOW()),
  ('erasure.processor',           3600,  3, true, 'Erasure processor — hourly',           NOW(), NOW());
```

Adjust `expected_interval_seconds` to whatever the cron actually runs at.

### Adopt instrumentation in cron handlers

Existing cron pattern:

```typescript
@Cron(CronExpression.EVERY_10_MINUTES)
async sweep() {
  // … job body …
}
```

Phase 8 pattern:

```typescript
@Cron(CronExpression.EVERY_10_MINUTES)
async sweep() {
  await this.instrumentation.wrap('idempotency.sweeper', async () => {
    // … job body …
    return { swept: count };
  });
}
```

Adoption is a follow-up PR per cron — Phase 8 lands the infrastructure,
not the call sites. Until a cron is adopted, it never writes to
`cron_runs`, so the heartbeat alerts on it (silently dropping the
adoption job into the alerting queue is the desired forcing function).

### Flip

```bash
kubectl -n staging set env deploy/api CRON_HEARTBEAT_ENABLED=true
```

The heartbeat cron runs every 5 minutes. Watch for `cron.silent` events
in the outbox; each one is a missed heartbeat.

```sql
SELECT * FROM outbox_events
WHERE event_name = 'cron.silent'
  AND created_at > NOW() - INTERVAL '15 minutes';
```

### Rollback

```bash
kubectl -n staging set env deploy/api CRON_HEARTBEAT_ENABLED=false
```

## Task 4 — Prometheus metrics

### Set the bearer token

```bash
kubectl -n staging set env deploy/api METRICS_BEARER_TOKEN=$(openssl rand -hex 32)
```

Test:

```bash
curl -H "Authorization: Bearer $METRICS_BEARER_TOKEN" \
  https://api.staging.example.com/metrics
```

Expected: `text/plain` body in Prometheus exposition format. With no
metrics yet registered, the body is just a trailing newline.

### Adopt counters / histograms in domain code

Phase 8 ships the registry; domain modules add metrics via:

```typescript
// at construction time
private readonly returnsCreated =
  this.metrics.counter('returns_created_total', 'Returns opened.');

// in the handler
this.returnsCreated.inc({ initiator: 'CUSTOMER' });
```

For latency histograms:

```typescript
private readonly refundLatency = this.metrics.histogram(
  'refund_latency_ms',
  'End-to-end refund latency.',
);

const start = Date.now();
await this.refund(...);
this.refundLatency.observe(Date.now() - start, { method: 'WALLET' });
```

The exact set of metrics is a follow-up — Phase 8 doesn't add domain
counters; it adds the surface they live on.

### Configure scraping

Sample Prometheus job config:

```yaml
- job_name: 'sportsmart-api'
  scrape_interval: 30s
  static_configs:
    - targets: ['api.production.example.com']
  metrics_path: /metrics
  scheme: https
  authorization:
    type: Bearer
    credentials: $METRICS_BEARER_TOKEN
```

### Rollback

Unset `METRICS_BEARER_TOKEN`. The endpoint returns 404 again.

## Common gotchas

* **`/admin/audit/verify-chain-fast` reports `anchorSequence: null`.**
  No anchors exist yet. Either the cron hasn't run or
  `AUDIT_CHAIN_ANCHOR_ENABLED=false`. Verifier falls back to walking
  from genesis — the response is correct but slower.
* **Suppression rows ignored.** Either the gate isn't called from the
  send path (Phase 8 ships the gate; per-module adoption is a
  follow-up), or the suppression has an `expires_at` in the past.
* **`cron.silent` fires for a job that's running.** Most likely the
  job throws on every run — failures don't update "last successful
  run". Check `cron_runs` for the job_name with status='FAILED'.
* **Metrics endpoint returns 404 on prod.** `METRICS_BEARER_TOKEN`
  unset. Set it (rotate by deploying a new value).
* **Histograms have negative cumulative counts.** Should be impossible
  with the current renderer. If you see this, file a bug — it's a
  regression in `MetricsRegistry.render()`.
