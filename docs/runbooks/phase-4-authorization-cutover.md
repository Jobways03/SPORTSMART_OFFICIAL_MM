# Phase 4 — Authorization cutover runbook

**Owner**: Platform / SRE
**ADR**: [010 — ABAC ResourcePolicies](../decisions/010-abac-resource-policies.md)
**Status**: Ready to soak

This runbook drives the staged enablement of `PERMISSIONS_GUARD_STRICT`
and `ABAC_ENABLED` from the all-off "log-only" state shipped in PRs
4.1–4.4 to the all-on enforced state.

The work was split into three independent flags so each can be rolled
back without dragging the others. Treat each flag flip as its own
cutover — separate change ticket, separate soak window, separate
sign-off.

## Pre-flight (one-time — before starting any flip)

### 1. Verify the schema is migrated

```sql
\d resource_policies
\d authorization_audits
```

Both tables should exist with the indexes from
`20260505160000_add_resource_policies` and
`20260505170000_add_authorization_audit`. If not, abort and re-run
`pnpm prisma migrate deploy`.

### 2. Confirm `AUTHZ_AUDIT_ENABLED=true` in every environment

`AUTHZ_AUDIT_ENABLED` ships defaulted to `true` in `env.schema.ts` and
should *stay* on for the entire cutover. The audit table is the only
source of truth for "what would have been blocked" decisions; turning
it off blinds you to the very signal you're soaking for.

```bash
# Every environment should show AUTHZ_AUDIT_ENABLED=true (or unset, which
# defaults to true). If any environment has AUTHZ_AUDIT_ENABLED=false,
# fix that before continuing.
kubectl -n production exec deploy/api -- env | grep -E '^AUTHZ_AUDIT_ENABLED='
```

### 3. Seed the example resource policies

```bash
pnpm --filter @apps/api exec ts-node prisma/seed/seed-resource-policies.ts
```

This upserts the Tier-1 caps (₹10k wallet, ₹50k franchise ledger). The
team owning finance controls should review and adjust before flipping
`ABAC_ENABLED=true`.

### 4. Wire the audit query helpers

The queries below are the operational rollups used during each soak
window. Save them as Grafana panels or as a Metabase dashboard before
starting — you'll be running them every day for two weeks.

```sql
-- "Would-have-been-blocked" rate by route, last 24h
SELECT
  route_label,
  required_permissions,
  COUNT(*) AS hits,
  COUNT(*) FILTER (WHERE would_have_blocked) AS would_block
FROM authorization_audits
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND layer = 'PERMISSIONS'
GROUP BY route_label, required_permissions
HAVING COUNT(*) FILTER (WHERE would_have_blocked) > 0
ORDER BY would_block DESC;
```

```sql
-- ABAC no-match rate by (resource, action), last 24h
SELECT
  resource_type,
  action,
  COUNT(*) AS hits,
  COUNT(*) FILTER (WHERE would_have_blocked) AS would_block
FROM authorization_audits
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND layer = 'POLICY'
GROUP BY resource_type, action
HAVING COUNT(*) FILTER (WHERE would_have_blocked) > 0
ORDER BY would_block DESC;
```

```sql
-- Top admins triggering would-have-blocked decisions
SELECT
  admin_id,
  layer,
  COUNT(*) AS hits
FROM authorization_audits
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND would_have_blocked = true
GROUP BY admin_id, layer
ORDER BY hits DESC
LIMIT 50;
```

## Flip 1 — `PERMISSIONS_GUARD_STRICT=true`

### Soak (minimum 7 days, expect 14)

Watch the queries above. Every non-zero `would_block` row is a route
where the actor lacked the declared permission key. There are three
common causes:

1. **The actor genuinely shouldn't have access.** No action — the flip
   will start returning 403 to them. Document it.
2. **The route was tagged with the wrong permission key.** Edit the
   `@Permissions(...)` declaration on the route.
3. **The role was missing the permission grant.** Either update
   `SYSTEM_ROLE_PERMISSIONS` in `permission-registry.ts` (if it should
   apply to the system role globally) or add the permission to the
   actor's `AdminCustomRole` via the admin UI.

The soak window is "done" when:

* the daily would-block count for *each* route has been zero for at
  least three consecutive business days; **and**
* every legitimate admin operation is exercised at least once during
  the window (verified by the route-coverage query below).

```sql
-- Route coverage: every distinct route_label that the audit table has
-- seen at least one ALLOW for in the last 14 days. Cross-reference
-- against your Postman/Newman test suite to make sure you've actually
-- run the routes that matter.
SELECT route_label, COUNT(*) AS hits
FROM authorization_audits
WHERE created_at > NOW() - INTERVAL '14 days'
  AND decision = 'ALLOW'
GROUP BY route_label
ORDER BY route_label;
```

### Flip

```bash
kubectl -n production set env deploy/api PERMISSIONS_GUARD_STRICT=true
kubectl -n production rollout status deploy/api
```

Within 60 seconds (one cache TTL) the next admin request hitting an
unauthorized route returns a 403 problem-details payload with type
`permission-denied`.

### Verify

* `kubectl logs ... | grep '"event":"authz.deny"'` — there should still
  be deny logs, but now without the `wouldHaveBeenBlocked` field
  (because they're hard denies, not soak-passes).
* Run the would-block query immediately after the flip; it should
  drop to zero within minutes (anyone who previously hit a soak-deny
  is now getting a 403, so they stop trying or escalate).
* Hit the support inbox / on-call. If admin ops are filing tickets
  saying "I can't do my job", that's a missed permission grant —
  pause and investigate before adding the perm; usually means the
  permission key was misnamed.

### Rollback

```bash
kubectl -n production set env deploy/api PERMISSIONS_GUARD_STRICT=false
```

The guard returns to log-only mode immediately. No data migration.

## Flip 2 — `ABAC_ENABLED=true`

**Do NOT start this flip until at least 7 days after PR 4.5 + Flip 1.
ABAC denials are conditional on request context, so the failure modes
are subtler than missing-permission denials.**

### Soak (minimum 7 days)

Watch the policy-layer would-block query. Each row is a route + actor
combo where no `ALLOW` policy fires. Causes:

1. **The route is tagged with `@Policy` but no policy exists yet.**
   Add an ALLOW policy with the right principal selector. Often a
   broad `principalType=ROLE, principalKey=SUPER_ADMIN` to start.
2. **The policy exists but the conditions are too tight.** Check the
   `context` column on the audit row to see what the matcher saw,
   then adjust either the condition or the application code that
   builds the context.
3. **The policy was disabled.** `enabled=false` rows are filtered at
   the evaluator level. Re-enable, or add a different rule.

### Flip

```bash
kubectl -n production set env deploy/api ABAC_ENABLED=true
kubectl -n production rollout status deploy/api
```

### Verify

```sql
-- Policy denials in the first 30 minutes after the flip
SELECT route_label, resource_type, action, matched_policy_name, COUNT(*)
FROM authorization_audits
WHERE layer = 'POLICY'
  AND decision = 'DENY'
  AND created_at > NOW() - INTERVAL '30 minutes'
GROUP BY 1, 2, 3, 4
ORDER BY count DESC;
```

A spike here that you haven't seen during soak is a regression — roll
back immediately.

### Rollback

```bash
kubectl -n production set env deploy/api ABAC_ENABLED=false
```

Policy denials revert to log-only. Hard `DENY` rules (rare) still fire
in both modes; rolling back doesn't disable them. To disable a
specific DENY rule:

```sql
UPDATE resource_policies SET enabled = false WHERE name = 'rule-name';
```

The evaluator picks up the change within 60s (cache TTL).

## Adding a new policy mid-cutover

Policies are data, not code. To add one:

```sql
INSERT INTO resource_policies
  (id, name, description, effect, principal_type, principal_key,
   resource_type, action, conditions, priority, enabled, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'tier-1-refund-cap-25k', 'Tier-1 admins may approve refunds up to ₹25k.',
   'ALLOW', 'ROLE', 'SELLER_OPERATIONS',
   'refund', 'approve',
   '{"amountInPaise": {"$lte": 2500000}}'::jsonb,
   100, true, NOW(), NOW());
```

Within 60s the evaluator picks it up. To force-flush the cache:

```bash
# Restart one pod to invalidate its in-process cache.
kubectl -n production rollout restart deploy/api
```

## Common gotchas

* **The audit table grows ~5-10 rows per admin request.** Plan a
  retention policy. The default is "keep forever"; consider partitioning
  by month and dropping >90 days. Track this as a follow-up to PR 4.5.
* **A misconfigured `@Policy` `context` map shows up as undefined values
  in the audit `context` column.** Easy to spot: filter for
  `context @> '{"<key>": null}'`.
* **Don't tag every admin route with `@Policy` immediately.** The
  decorator is opt-in for a reason — only routes that need
  attribute-based gating (caps, time-of-day, segment) should carry it.
* **`AUTHZ_AUDIT_ENABLED=false` means no authorization audit trail.**
  The flag exists for emergencies (DB pressure during an incident);
  re-enable as soon as the incident is resolved. Treat `false` as a
  temporary workaround, not a configuration choice.
