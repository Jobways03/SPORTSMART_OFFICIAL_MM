# ADR-013: Audit anchors, notification gate, cron observability, metrics

**Status**: Accepted

**Date**: 2026-05-06

**Phase**: 8 (PRs 8.1–8.5) of the 10-phase Returns + Disputes redesign

## Context

Four distinct gaps surfaced in the Phase 0 audit:

1. **Audit chain verification was O(n).** The `/admin/audit/verify-chain`
   endpoint walks from the genesis row every time. As of mid-Phase-7
   the chain has 4M+ rows; verification takes >30s. Compliance asks
   "is the chain healthy?" and we answer with a 30-second pause.
2. **Notification preferences existed but had no central enforcement.**
   The `notification_preferences` table was wired to the user-facing
   opt-out UI, but most send paths in domain modules called the
   notifications facade directly without checking preferences. Result:
   users opting out of marketing still got marketing emails through
   the order-promotion flow.
3. **No cron observability.** Background jobs ran on @nestjs/schedule's
   in-process cron. When one stopped — silent crash, env-flag flip,
   anything — we found out by noticing the side effects (settlements
   not running, breaches not detected) days later.
4. **No metrics surface.** Logs are good for incidents; they're terrible
   for "what's the 95th-percentile refund latency?". We had nothing
   for Prometheus / Grafana to scrape.

Phase 8 closes all four with thin-but-real layers that don't depend
on any new external service.

## Decision

Five PRs:

| PR | Lands |
|---|---|
| **8.1** | `audit_chain_anchors` table + `AuditChainAnchorService` (pin + verify-from-latest-anchor) + hourly `AuditChainAnchorCron` + admin endpoint `/admin/audit/verify-chain-fast`. Walks forward from the most recent anchor, O(rows-since-anchor). |
| **8.2** | `notification_suppressions` table + `NotificationGateService` (one chokepoint applied before any send). Three checks in order: suppression list → transactional bypass → user preference. Hooks left for the notifications module to call before each send. |
| **8.3** | `cron_runs` + `cron_heartbeat_targets` tables; `CronInstrumentationService.wrap(name, fn)` recording start/end/duration/result/error; `CronHeartbeatCron` emitting `cron.silent` events when expected runs go missing. |
| **8.4** | In-process `MetricsRegistry` (counter / gauge / histogram, prom-client-shaped API), `/metrics` endpoint gated by a bearer token. No new dependency — emits Prometheus text exposition directly. |
| **8.5** | This ADR + runbook. |

### Audit anchors are append-only and one-row-per-pin

A more sophisticated design would Merkle-tree the anchors (each anchor
covers `[prev.upTo, this.upTo]` and stores the hash of the hashes).
Rejected for v1: the linear "anchor every hour" strategy is
operationally simpler, the storage cost is trivial (8.7K anchors per
year at hourly cadence), and verifying a window is still O(rows-since-
anchor). We can layer Merkle trees on later if anchor-table growth
ever becomes a problem.

The verifier's `/admin/audit/verify-chain-fast` endpoint reads the
latest anchor in O(1) (BTree primary key), checks the anchored row's
stored hash matches the anchor's `expected_hash`, then walks forward
verifying each row's `prev_hash` chain. The legacy
`/admin/audit/verify-chain` endpoint (genesis-walk) stays for cases
where ops needs full historical verification.

### Notification gate: one chokepoint, three checks

The hard rule: every send goes through the gate. The gate's three
checks in order:

1. **Suppression list** (hard block). Bounced / spam-complaint /
   compliance request. Always wins. The `expiresAt` field lets us
   set a temporary block that auto-clears.
2. **Transactional bypass**. Caller passes `transactional: true` for
   safety-critical messages (password reset, refund credited, OTP).
   The gate skips the preference check but NOT the suppression list —
   we still respect a user who unsubscribed via the email provider's
   built-in unsubscribe link.
3. **User preference**. Default is allow (no row = enabled); opt-out
   inserts an `enabled = false` row keyed on `(userId, eventClass,
   channel)`.

### Why an in-house Prometheus exporter

We considered `prom-client` (the de facto Node.js Prometheus library).
Its histogram with native quantile estimation, Summary type, and
per-pid registries are nice but unused at our scale. Our exporter is
~250 lines, has no dependency, and matches prom-client's public API
(`registry.counter().inc()`, `.gauge().set()`, `.histogram().observe()`).
A future swap to prom-client for the histogram-quantile work is a
mechanical change.

### Why bearer-token auth on /metrics, not admin JWT

Prometheus scrape pods don't carry user JWTs. Bearer tokens rotate
via env-var change without re-auth flow on the scraper. The default
is empty (endpoint returns 404 — not 401 — so the path doesn't
advertise its existence in environments that don't need scraping).

### Cron registry separates audit (cron_runs) from heartbeat config (cron_heartbeat_targets)

The two tables exist for different lifecycles:

* `cron_runs` is append-only audit. Rows persist for the retention
  window (60 days default) so dashboards can chart historical
  performance.
* `cron_heartbeat_targets` is config — admins edit it when adjusting
  expected cadences. One row per `jobName`.

The heartbeat cron (cron-of-crons) walks `cron_heartbeat_targets`,
joins to "latest SUCCEEDED run per job in cron_runs", and alerts when
the gap exceeds tolerance. Tolerance is a multiplier on the expected
interval (default 3x): a 5-minute job that hasn't succeeded in 15
minutes triggers a `cron.silent` event.

## Consequences

* Compliance asks "is the chain healthy?" and the answer is now
  near-instant. The full genesis walk still exists for audits that
  need it.
* Domain modules that emit notifications must adopt the gate. The
  module shipping doesn't add the call sites — that's a follow-up
  PR. Until each path adopts the gate, the existing preference table
  is enforced only where it was already enforced.
* Cron audit storage: 60-day retention at our current job count
  (~12 distinct crons, ~5min average cadence) = ~200K rows. Trivial.
* Metrics endpoint adds zero latency to non-/metrics paths. The
  in-process counters are O(1) updates.
* Heartbeat alerting depends on the outbox + notifications path
  working. A silent cron-of-crons fails closed (no alert), so the
  outermost loop is still "humans noticing nothing fired" — which is
  why the ADR also recommends external uptime monitoring of the
  /metrics endpoint as a third line of defence.

## Alternatives considered

* **OpenTelemetry traces** for cron observability. Overkill for what's
  essentially "did this hourly job run today?". OTel arrives in
  Phase 9 for HTTP request tracing; cron observability needs are
  served well enough by the registry table.
* **Kafka / Redis Streams** for cron heartbeat. Same conclusion —
  Postgres SELECT + cron is sufficient at our scale, and removes a
  dependency on the streams infrastructure for what's an ops feature.
* **Per-channel suppression on User row** instead of a separate table.
  Rejected because user-level suppression doesn't capture "this email
  bounced; the user has another email that's still good". The
  suppression list keys on (channel, destination) so granularity is
  preserved.
* **Use Postgres NOTIFY for cron events.** Would couple the alerting
  layer to Postgres connectivity; the outbox path was already paid
  for by Phase 2 and uses the standard event flow.

## Migration / rollout

* Apply migrations 20260506140000 (anchors), 20260506150000
  (suppressions), 20260506160000 (cron observability).
* Roll the four crons (anchor, retention enforcer, heartbeat, integrity
  verifier) with their flags off. Soak in staging.
* Flip `AUDIT_CHAIN_ANCHOR_ENABLED=true` first. After one hour, hit
  `/admin/audit/verify-chain-fast` and confirm the response includes
  a non-null `anchorSequence`.
* Seed `cron_heartbeat_targets` with the expected cadences for every
  cron currently in production. Then flip
  `CRON_HEARTBEAT_ENABLED=true`. Confirm the table populates over
  the first day, then expect zero `cron.silent` events on a healthy
  fleet.
* Set `METRICS_BEARER_TOKEN` to a long random string. Test the
  scrape with `curl -H "Authorization: Bearer ..." /metrics`.
* Domain modules adopt `CronInstrumentationService.wrap(...)` and the
  notification gate as separate small PRs. Phase 8 doesn't itself
  touch every cron handler — it ships the infrastructure.
* Operational runbook:
  [docs/runbooks/phase-8-audit-cron-metrics-cutover.md](../runbooks/phase-8-audit-cron-metrics-cutover.md).
