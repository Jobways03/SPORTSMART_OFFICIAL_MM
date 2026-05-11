# ADR-019 — `@Permissions` is the canonical admin RBAC mechanism; `@Roles` is legacy

**Date:** 2026-05-11
**Status:** Accepted
**Supersedes (partially):** ADR-010 (ABAC resource policies — still authoritative for context-bound rules)
**Related:** ADR-010 ABAC resource policies, ADR-017 refund finance-approval gate

---

## Context

Today the admin surface has **three** decorators wired to **three** different guards:

| Decorator        | Guard              | Reads                          | Phase |
|------------------|--------------------|--------------------------------|-------|
| `@Roles('X')`    | `RolesGuard`       | `req.user.roles`               | Legacy (pre-Phase-4) |
| `@Permissions('module.verb')` | `PermissionsGuard` | `req.user.permissions`        | Phase 4 PR 4.2 |
| `@Policy({...})` | `PolicyGuard`      | `req.user.permissions` + `req.user.customRoles` + ResourcePolicy rows | Phase 4 PR 4.3 |

`RolesGuard` was the original RBAC: the controller declared "you must be SUPER_ADMIN to call this," the guard read the admin's role enum, and that was the whole check. It cannot express:

- **Tier-splitting within a role** ("tier-1 support may schedule pickups, tier-2 may decide QC")
- **Granular capabilities per controller method** (one role grants many verbs; `@Roles` forces you to add the same role list everywhere)
- **Custom roles** that the admin UI lets ops invent without a code deploy
- **Context-bound rules** ("any role with `refunds.initiate`, but capped at ₹10k unless they also have `refunds.approve`")

Permission-based RBAC fixes (1)–(3). ABAC (ADR-010) fixes (4). The codebase already has all three layers built; what was missing was a clear rule about which to use for new routes.

A real symptom we observed: 11 admin controllers still carry `@Roles(...)` (sometimes also `@Permissions(...)`). When both are present, both guards run in the order declared in `@UseGuards(...)`. When only `@Roles` is present, the permission system is silently bypassed — and the route can't be capped by ABAC either, because PolicyGuard layers AFTER PermissionsGuard.

We also saw a real production bug ([incident `actorPermissionCount=0` on SUPER_ADMIN](../runbooks/rbac-incident-2026-05-11.md)) where `AdminAuthGuard` failed to populate `req.user.permissions`, leaving the entire `@Permissions` layer dead. That has been fixed (PR 4.6) but the existence of two parallel mechanisms made it easy for the failure to hide for weeks.

## Decision

1. **`@Permissions('module.verb')` is the canonical mechanism** for declaring "what an admin must be able to do" on every new admin route.
2. **`@Roles(...)` is legacy** and not to be added to new routes. The decorator and guard stay in the codebase because two narrow use-cases still need them (see below) and removing the guard wholesale would silently un-protect any forgotten route.
3. **Every admin controller MUST use `AdminAuthGuard` first**, then `PermissionsGuard`, then (optionally) `PolicyGuard`:
   ```ts
   @UseGuards(AdminAuthGuard, PermissionsGuard)        // typical
   @UseGuards(AdminAuthGuard, PermissionsGuard, PolicyGuard)  // money-moving
   ```
4. **When a route currently has `@Roles` only**, the migration plan is:
   - Pick the equivalent permission key from the registry (`apps/api/src/core/authorization/permission-registry.ts`).
   - Add `@Permissions('module.verb')`.
   - Add `PermissionsGuard` to the controller's `@UseGuards` if missing.
   - Leave `@Roles` in place for the duration of the soak; remove in the same PR that flips `PERMISSIONS_GUARD_STRICT=true` in production.
5. **When a route has both `@Roles` and `@Permissions`**, both guards run. The route is allowed only if both checks pass. This is the safe state during migration; document it in the route's comment so a future reader doesn't think the `@Roles` is dead.
6. **ABAC (`@Policy(...)`) layers on top of `@Permissions`**. It does NOT replace permissions. A money-moving route needs `@Permissions('refunds.initiate')` AND `@Policy({resourceType:'refund', action:'initiate', context:{amountInPaise:'body.amountInPaise'}})`.
7. **Permission keys live in one file:** `apps/api/src/core/authorization/permission-registry.ts`. `permission-registry.coverage.spec.ts` fails the build if a `@Permissions('foo')` string isn't in the registry. Don't ship a permission you can't grant.
8. **SUPER_ADMIN must always resolve to every permission.** This is enforced by the readiness endpoint (`GET /api/admin/authz/readiness`) and by the `SUPER_ADMIN grants every registered permission` test. A change to the registry that breaks this rule fails CI.

### When `@Roles` is still acceptable

Two narrow cases:

1. **Bootstrap / break-glass endpoints** that must be reachable even if the permission system itself is broken — e.g. the future `/admin/authz/repair` endpoint that would re-seed system role permissions. Reading `req.user.roles` directly is the only way to survive a corrupted `admin_custom_role_permissions` table.
2. **Persona-shape gating** ("this route is admin-only, no permission can grant it to a seller"). In practice `AdminAuthGuard` already enforces that by rejecting non-admin tokens, so `@Roles('SUPER_ADMIN')` on top of `AdminAuthGuard` is mostly redundant — but it documents intent at the call site.

Both cases require a `// ADR-019 exception:` comment justifying the use.

## Consequences

**Positive**
- One mechanism for new routes → no ambiguity for reviewers, easier audit.
- Permission keys are testable (the coverage spec catches typos in CI).
- The readiness endpoint becomes the source of truth for "can we flip strict mode?".
- ABAC and PermissionsGuard share `req.user.permissions` — fixing the populator (PR 4.6) unlocked both layers at once.

**Negative**
- Migrating the 11 routes still on `@Roles`-only is manual work. Cost: ~30 minutes per controller (pick keys, add decorator + guard, write test).
- `RolesGuard` lives in the codebase indefinitely for the two acceptable cases. Mitigated by requiring an inline justification comment.

## Implementation status (2026-05-11)

| Item | Status |
|---|---|
| `AdminAuthGuard` populates `req.user.permissions` | ✅ done (PR 4.6) |
| `permission-registry.coverage.spec.ts` in CI | ✅ done (PR 4.6) |
| Readiness endpoint `/admin/authz/readiness` | ✅ done (PR 4.6) |
| Boot banner logs flag state | ✅ done (PR 4.6) |
| Migrate the 11 `@Roles`-only controllers to `@Permissions` | ⏳ in progress |
| Flip `PERMISSIONS_GUARD_STRICT=true` in staging | 🔜 after migration |
| Flip `PERMISSIONS_GUARD_STRICT=true` in production | 🔜 after 2-week staging soak |

## Migration backlog (as of writing)

Run `grep -rln "@Roles(" apps/api/src --include="*.ts" | grep -v ".spec.ts"` to refresh:

```
apps/api/src/modules/commission/presentation/controllers/admin-commission.controller.ts
apps/api/src/modules/admin-control-tower/presentation/controllers/admin-dashboard.controller.ts
apps/api/src/modules/settlements/admin-settlement.controller.ts
apps/api/src/modules/admin/presentation/controllers/admin-sellers.controller.ts
apps/api/src/modules/discounts/presentation/controllers/admin-discounts.controller.ts
apps/api/src/modules/franchise/presentation/controllers/admin-franchise-settlements.controller.ts
apps/api/src/modules/franchise/presentation/controllers/admin-franchise.controller.ts
apps/api/src/modules/accounts/presentation/controllers/accounts-settlements.controller.ts
apps/api/src/modules/returns/presentation/controllers/admin-returns.controller.ts
apps/api/src/modules/orders/presentation/controllers/admin-orders.controller.ts
apps/api/src/modules/shipping-options/presentation/controllers/admin-shipping-options.controller.ts
```

Several already carry `@Permissions` too — these are the "both guards run" case from rule 5 above. The migration is to drop `@Roles` once strict mode is on and stable.
