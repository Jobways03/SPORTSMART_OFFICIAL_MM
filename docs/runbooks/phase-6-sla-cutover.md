# Phase 6 — SLA + risk + queues cutover runbook

**Owner**: Platform / Ops
**ADR**: [011 — SLA tracking, risk scoring, and unified queues](../decisions/011-sla-risk-queues.md)
**Status**: Ready to soak

This runbook walks through enabling the SLA breach detector cron and
introducing the unified queue UI to ops. The risk scorer is hookless
in PR 6.4 — its rollout doesn't need a flag and arrives via a separate
hook PR (see "Hooking risk scores into createReturn / createDispute").

## Pre-flight

### 1. Migrations

```bash
pnpm --filter @apps/api exec prisma migrate deploy
```

Required tables:
* `sla_policies` (PR 6.1)
* `sla_breaches` (PR 6.1)
* `risk_scores` (PR 6.3)

Verify with `psql` — the Prisma client also generates only after the
migrations are present, so the API won't boot if any are missing.

### 2. Seed example policies

```bash
pnpm --filter @apps/api exec ts-node prisma/seed/seed-sla-policies.ts
```

Re-runnable. Existing rows are updated, missing rows are inserted.

Then **review the seeded values** with the team that owns each queue:

```sql
SELECT name, resource_type, status,
       deadline_minutes, escalate_after_minutes, escalate_action
FROM sla_policies
ORDER BY resource_type, deadline_minutes;
```

The defaults are illustrative — every team should sign off on their
deadlines before the cron runs in their environment.

### 3. Verify the queue UI works against empty `sla_breaches`

```bash
curl -H "Authorization: Bearer <admin-token>" \
  https://api.staging.example.com/admin/queues/dispute
```

Expected: `data.items` populated, every row's `slaState` set. Without
the cron running, the state still computes from the policy table —
breach state cells should show OK / WARNING / BREACHED based on the
case age vs the policy. No rows should appear in the `sla_breaches`
table yet (no cron writes).

### 4. Wire the cutover queries

```sql
-- Daily breach summary
SELECT
  resource_type,
  status,
  COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_breaches,
  AVG(overdue_minutes) FILTER (WHERE resolved_at IS NOT NULL) AS avg_overdue
FROM sla_breaches
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY open_breaches DESC;
```

```sql
-- Top-policy breach offenders this week
SELECT
  p.name,
  COUNT(*) AS breach_count
FROM sla_breaches b
JOIN sla_policies p ON p.id = b.policy_id
WHERE b.created_at > NOW() - INTERVAL '7 days'
GROUP BY p.name
ORDER BY breach_count DESC
LIMIT 20;
```

```sql
-- Risk distribution
SELECT
  resource_type,
  tier,
  COUNT(*) AS cases
FROM risk_scores
GROUP BY 1, 2
ORDER BY 1, 2;
```

## Flip — `SLA_BREACH_DETECTOR_ENABLED=true`

### Soak

The detector is off by default. Soak in this order:

1. **Staging, 7 days**. Flip the flag, observe `sla_breaches` populate.
   Watch the API log for `"SLA cron: opened=X escalated=Y resolved=Z"`
   lines — should fire every 5 minutes once a breach exists. Confirm
   escalations actually do their thing:
   * `BOOST_SEVERITY` → `dispute.severity = 95`.
   * `REASSIGN_SENIOR` → `dispute.assignedAdminId = NULL` (or ticket).
   * `NOTIFY_MANAGER` → `sla.escalated` event lands in
     `outbox_events` (per Phase 2).

2. **Production, after sign-off**. Flip the flag during a low-traffic
   window. The first run touches every non-terminal dispute / return /
   ticket, so expect a brief CPU bump on the API pod for the first
   few minutes.

### Verify

```bash
kubectl logs -n production deploy/api -c api --tail=200 | grep -E 'SLA cron|sla.escalated'
```

```sql
-- Should be non-zero within 10 minutes of flipping
SELECT COUNT(*) FROM sla_breaches WHERE created_at > NOW() - INTERVAL '10 minutes';
```

If the breach count is zero after 10+ minutes:
* Confirm the env flag is set (`kubectl exec ... env | grep SLA_BREACH`).
* Confirm policies are enabled (`SELECT name, enabled FROM sla_policies`).
* Confirm there are non-terminal cases (the cron only writes when at
  least one case is past its deadline).

### Rollback

```bash
kubectl -n production set env deploy/api SLA_BREACH_DETECTOR_ENABLED=false
```

The cron returns to no-op mode immediately. Existing `sla_breaches`
rows stay as historical record. To freeze escalations without losing
the detection layer, set individual policies to `enabled=false`
instead.

## Hooking risk scores into createReturn / createDispute

PR 6.4 lands the infrastructure but not the call sites. To enable
risk scoring on case creation, follow up with a small PR that:

1. Injects `RiskScoreService` into `ReturnService` and `DisputeService`.
2. Calls `riskScoreService.recompute('return', returnId, signals)` in
   a `try/catch` after `createReturn` returns. Same shape for disputes.
3. Builds the `RiskSignals` from the resource fields:
   * `amountInPaise`: from the order's total (or refund estimate)
   * `customerFlaggedForAbuse`: read from `customer_abuse_counters`
   * `hoursSinceOrder`: now - `masterOrder.createdAt`
   * `refundMethod`: from the inferred / requested method
   * `reasonCategory`: the customer's stated reason

The hook is intentionally outside the transaction. A failed score
write should never fail the underlying create operation.

## Common gotchas

* **Stale policy cache.** `SlaTrackerService` caches policies for 60
  seconds. After editing a policy in the DB, give the API up to 60s
  before re-checking. To force-refresh: bounce one pod.
* **Breach counts that "look wrong"** are usually a status-timestamp
  proxy artifact (see ADR-011 §"Status-change timestamps"). When in
  doubt, compare with `dispute.updatedAt` directly — the cron treats
  that as the SLA-start time for v1.
* **Same case has multiple breach rows.** Only one breach per
  `(policyId, resourceType, resourceId)` tuple is allowed; the upsert
  enforces it. Multiple rows would mean someone bypassed the upsert
  path. Investigate.
* **Large breach backlog after first flip.** The first cron run
  catches every overdue case at once. If the count looks alarming,
  remember: those cases were already overdue — the cron didn't make
  them so. Review the top-by-policy and top-by-status rollups, then
  reach out to the team owning the queue.
* **Risk-tier-based gating.** As of PR 6.4 the tier is informational —
  no service refuses to act on a HIGH-tier case. If/when we want
  hard gating ("HIGH-risk refunds require two admins"), a `@Policy`
  rule (Phase 4 ABAC) is the right surface — not a hard-coded check
  in the service.
