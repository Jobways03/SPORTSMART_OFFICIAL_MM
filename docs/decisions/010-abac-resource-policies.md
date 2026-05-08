# ADR-010: Authorization layering — Permissions + ABAC + AuthorizationAudit

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 4 (PRs 4.1–4.5) of the 10-phase Returns + Disputes redesign

## Context

Phase 0 audit found three concrete gaps in the admin authorization layer:

1. `AdminAuthGuard` checks "is this an authenticated admin?" — that's it.
   `RolesGuard` reads `@Roles(...)` metadata and checks the AdminRole
   enum, but only ~30% of admin controllers had `@Roles` declarations.
   The other ~70% would let any logged-in admin fire any action.
2. The role enum (`SUPER_ADMIN`, `SELLER_ADMIN`, `SELLER_SUPPORT`,
   `SELLER_OPERATIONS`, `AFFILIATE_ADMIN`) is too coarse for finance
   controls. We can't say "tier-1 may credit wallets up to ₹10,000 but
   not ₹1,00,000."
3. There's no audit trail for authorization decisions. We log which
   business actions an admin took (`admin_action_audit_logs`), but not
   which actions were *attempted-and-blocked* — exactly the trace
   needed when investigating a possible compromise.

Phase 4 closes all three with a layered authorization stack rather than
a single mega-guard, so each layer can evolve independently.

## Decision

Five PRs land the layered stack and the operational rails:

| PR | Lands |
|---|---|
| **4.1** | Permission registry — 66 `<module>.<verb>` keys, system-role default grants, `AdminCustomRole` + `admin_custom_role_active` flag. |
| **4.2** | `PermissionsGuard` + `@Permissions(...)` decorator on every admin controller. Log-only mode (`PERMISSIONS_GUARD_STRICT=false`) so we can soak in production without a single 403. |
| **4.3** | `ResourcePolicy` table + `PolicyEvaluatorService` + `PolicyGuard` + `@Policy(...)` decorator. JSON-condition matcher with an explicit operator allow-list. ABAC also runs in log-only mode by default (`ABAC_ENABLED=false`). |
| **4.4** | `AuthorizationAudit` table — every guard decision (allow + deny) flushed asynchronously so we have ground truth in incident response. |
| **4.5** | Documented flag-flip plan (this ADR) + ramp checklist. |

### Layer order

A request to a guarded admin route flows through:

```
AdminAuthGuard          — is the JWT valid for *some* admin?
  ↓
RolesGuard              — does @Roles match this admin's enum role?
                          (only enforced where decorator is present;
                          legacy routes pass through)
  ↓
PermissionsGuard        — does the admin's permission set include
                          every key from @Permissions(...)?
                          (log-only when PERMISSIONS_GUARD_STRICT=false)
  ↓
PolicyGuard             — for routes annotated with @Policy(...),
                          evaluate ResourcePolicy rows for the
                          (resourceType, action) pair.
                          (log-only when ABAC_ENABLED=false)
```

Each layer is independent: removing `@Permissions` from a route doesn't
disable `@Policy`, and vice versa. Layers ahead in the chain (Auth,
Roles) still gate the request.

### Three flags, three soak windows

| Flag | Default | Effect when ON | Effect when OFF |
|---|---|---|---|
| `PERMISSIONS_GUARD_STRICT` | `false` | Missing permission ⇒ 403. | Missing permission ⇒ WARN log + allow-through. |
| `ABAC_ENABLED` | `false` | No matching ALLOW for a `@Policy` route ⇒ 403. DENY rules always fire. | No matching ALLOW ⇒ WARN log + allow-through. DENY rules still fire. |
| `AUTHZ_AUDIT_ENABLED` (PR 4.4) | `true` | Every guard decision is buffered + flushed to `authorization_audit`. | No-op. |

Treat the ON-ramp as three sequential cutovers, each with its own soak:

1. Roll PR 4.2 + 4.3 + 4.4 to staging with all flags OFF except
   `AUTHZ_AUDIT_ENABLED`. Observe the WARN logs and audit table for at
   least seven days under realistic load. Triaging the no-match list
   *before* flipping any strict flag is the entire point.
2. Flip `PERMISSIONS_GUARD_STRICT=true` first — the permission keys are
   the more conservative gate (no conditional logic), so failures are
   easier to reason about than ABAC denies.
3. Once permission strict has been clean for at least seven days, flip
   `ABAC_ENABLED=true`. Roll back at the first sign of a stuck ops flow.

### `ResourcePolicy` schema

Stored attributes:

* `principalType` — `ROLE` / `PERMISSION` / `CUSTOM_ROLE` / `ANY`. Lets a
  policy attach to a built-in role, a permission key (registry-driven, so
  policies survive role rename/restructure), an `AdminCustomRole` name,
  or every actor.
* `resourceType` + `action` — domain object and action verb. Free-form
  strings; no enum so we can add new resources without a migration.
* `conditions` — JSON expression matched against a request context that
  the `PolicyGuard` builds via the `@Policy({ context: ... })` map.
  Operators: `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`,
  `$exists`. Multiple keys = AND.
* `priority` + `effect` — higher priority wins; `DENY` rules can
  preempt broad `ALLOW` rules.

The matcher fails closed: unknown operators, non-numeric actuals on
numeric operators, and undefined contexts on `$lte` all return false.
A buggy policy can over-deny; it cannot over-allow.

### Why a separate ABAC table and not just more permission keys

We considered encoding the ₹10k cap as a permission key like
`wallets.adjust.upto-10k`. Rejected for three reasons:

1. The cap is a *policy decision* (changes with quarterly finance review),
   not a code change. Editing rows in a table is the right granularity.
2. Permission keys are coarse boolean grants by design (so the registry
   stays small and learnable). Caps and conditions push them past their
   ergonomic limit.
3. The same approach scales to per-customer-segment, per-time-window,
   per-region rules without inventing more permission keys for each.

### Default-allow vs default-deny

The matcher itself fails closed, but the *evaluator* defaults to ALLOW
when no policy matches a `@Policy` route in soak mode. This is
deliberate: turning ABAC on would otherwise 403 every guarded route on
day one. In strict mode (`ABAC_ENABLED=true`) the evaluator flips to
default-deny for `@Policy` routes only. Routes without `@Policy` are
never affected.

## Consequences

* Adding finance controls is a row insert. No redeploy.
* Three soak windows mean no flag-day. Each can be rolled back
  independently.
* Audit trail (PR 4.4) gives incident response a single table to pivot
  on: "show me every action this admin attempted in the last 24h, allow
  or deny."
* The fail-closed matcher means a malformed policy denies legitimate
  traffic. Mitigated by the seed file shipping example rules and by the
  cache having a 60s TTL — admins can correct typos quickly.
* Policy evaluation adds one DB read per `@Policy` route on cache miss,
  and zero on hit. We accept a one-minute lag between an admin editing
  a policy and it taking effect; the alternative (write-through cache
  invalidation across pods) is not worth the complexity.

## Alternatives considered

* **Casbin / OPA** — heavier dependency, our condition needs are small
  (a handful of operators), and we wanted policies persisted in our DB
  alongside the admin RBAC tables for joined audit queries.
* **Encoding caps in a configuration file** — fast, but config files
  don't have a per-actor edit history. A `ResourcePolicy.created_by_admin_id`
  column lets us trace who relaxed which rule without `git log`.
* **Skipping log-only mode and going straight to strict** — tried in
  the Phase 0 plan; would have produced production 403s on day one.
  Three soak windows are mandatory.

## Migration / rollout

* Every admin controller now has `@UseGuards(AdminAuthGuard, PermissionsGuard)`
  and high-stakes routes carry `@Permissions(...)`. Lower-stakes routes
  remain untagged in PR 4.3 and inherit allow-by-default; they will be
  tagged in a follow-up sub-PR before the strict flag flips.
* `seed-resource-policies.ts` ships the example Tier-1 caps. Production
  teams should review and adjust before the soak window starts.
* Admin UI for managing policies (`/admin/authz/policies`) lands as part
  of the admin dashboard work in Phase 9.
* Operational runbook for the cutover lives at
  [docs/runbooks/phase-4-authorization-cutover.md](../runbooks/phase-4-authorization-cutover.md).
  The runbook owns the soak-day-by-day checks, the rollback steps, and
  the queries you'll be running off `authorization_audits` during each
  flag flip.
