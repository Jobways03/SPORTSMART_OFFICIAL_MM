# ADR-020 — Deferred RBAC / authorization work (tracking record)

**Date:** 2026-05-11
**Status:** Accepted (as a tracking record — these items are NOT yet built)
**Related:** ADR-010 ABAC, ADR-019 RBAC canonical mechanism

---

## Purpose

PR 4.6 fixed the live RBAC wiring bug (`req.user.permissions` was never populated) and shipped the operational hardening that lets us safely flip `PERMISSIONS_GUARD_STRICT=true`. The original brief contained additional hardening that is **valuable but bigger than one PR**; this ADR captures each item as a tracked deferral so the next reader doesn't have to re-derive the gap from the brief.

Each section names the gap, the user-visible risk, a sketch of the implementation, the prerequisite work, and a rough size estimate.

---

## 1. Centralised tenant / resource scope guard

**Gap.** Seller and franchise routes today read `req.sellerId` / `req.franchiseId` from the auth guard and pass it down to every service method. If a developer forgets to filter, the service returns another seller's data — an IDOR.

**Risk.** High. The check is invisible to code review (a missing argument doesn't fail any test) and would never appear in `authorization_audits` because no guard ran.

**Sketch.**
- New decorator `@ScopedResource({ type, paramName, ownerField })`.
- New guard `ScopeGuard` that loads the resource by the path param and asserts `resource[ownerField] === req.sellerId | req.franchiseId`.
- A separate decorator `@AnyOwner()` for admin routes that legitimately fetch any seller's row.
- Where the resource needs eager-loaded fields downstream, the guard stuffs the row into `request.scopedResource` so handlers don't double-fetch.

**Prerequisites.** A canonical mapping from path-param → repository-method. Today repositories are scattered across modules — without a `ResourceRegistry` (or a per-module decorator that wires the loader), the guard would need a `switch` on `type`.

**Size.** 2–3 days for the framework + 1 day per scoped resource type to migrate. ~12 days total.

**Interim mitigation.** Add a code-review checklist item: "every seller/franchise controller method takes `sellerId`/`franchiseId` from `req`, never from `@Body` or `@Param`."

---

## 2. Seller-side permissions layer

**Gap.** `SellerAuthGuard` authenticates the seller but no `@Permissions(...)` layer exists on seller routes. Any authenticated seller can hit any seller endpoint. There is currently only one seller-account type so the absence is not exploitable today, but the moment "seller staff" (sub-users with limited access — e.g. someone who can list orders but not change bank details) becomes a feature, the missing layer is the bottleneck.

**Sketch.**
- New permission catalog: `seller-permission-registry.ts` with keys like `seller.orders.read`, `seller.orders.ship`, `seller.payouts.read`, `seller.kyc.write`.
- `SellerAuthGuard` populates `req.user.permissions` from a seller-side role/permission model (TBD: `SellerStaff` table + `SellerRole` enum).
- Re-use `PermissionsGuard` — its logic is persona-agnostic; it only needs `req.user.permissions` set.

**Prerequisites.** Decide whether the seller account model gains sub-users in this round or stays single-account. The permission layer is overkill for a single owner-account.

**Size.** 1 week if seller-staff is in scope, otherwise just a registry stub + a TODO note on `SellerAuthGuard`.

---

## 3. MFA for admin + step-up auth for money-moving actions

**Gap.** Admin login is password-only. SUPER_ADMIN can drain the platform wallet via `/admin/wallets/:userId/adjust` with one leaked password.

**Sketch.**
- TOTP MFA on admin login. Store `mfaSecretEncrypted` (AES-256, key in env), `mfaEnabled`, `mfaLastVerifiedAt` on `Admin`.
- Token claim `mfaVerifiedAt` (timestamp).
- New decorator `@RequireMfa({ withinMinutes: 5 })` on CRITICAL routes. A guard reads the claim and 403s if older than the threshold.
- Allow-list which permissions trigger step-up:
  - `wallets.adjust`, `refunds.confirm`, `settlements.approve`, `discounts.write` (approval branch),
  - `sellers.suspend`, `customers.impersonate`, `roles.write`.

**Prerequisites.** Admin UI screen for MFA enrolment + recovery codes. Backup-code storage.

**Size.** 5–7 days backend + 2 days frontend.

**Interim mitigation.** Rotate admin passwords on a quarterly cadence; flag suspicious-IP logins with an alert.

---

## 4. JWT hardening (jti, blacklist, shorter TTL, refresh rotation)

**Gap.** Admin tokens carry a `sessionId` claim and the session row's `revokedAt` is checked on every request. That's the good part. The remaining gap:

- No `jti` claim → can't invalidate a specific token without invalidating the whole session.
- No emergency token blacklist → if a session lookup is racing a revoke, a request mid-flight can still succeed.
- `JWT_ACCESS_TTL=7d` by default for admin (set in env). Should be much shorter for admins; `1h` with a `30d` refresh token.
- Refresh tokens are not rotated on use (each refresh hands back the same refresh token).

**Sketch.**
- Add `jti` to every minted token.
- Add `admin_session_blacklisted_jti` table (small, TTL-evicted via cron). `AdminAuthGuard` rejects any `jti` listed there. Use only for emergency.
- Tighten `JWT_ACCESS_TTL` for admin to 1h; refresh issues a new access token + a new refresh token; old refresh token marked `usedAt`. Reuse detection → revoke the whole session chain.
- Log session-reuse events to `admin_action_audit_logs` with `actionType='SESSION_REUSE_DETECTED'`.

**Size.** 3 days backend.

**Interim mitigation.** Operators can revoke any admin session manually via `admin_sessions.revoked_at`. The wall-clock window for race-condition exploitation is the session-lookup latency (~5ms in dev).

---

## 5. Admin UI permission consistency

**Gap.** The admin UI hides/disables buttons based on the admin's role enum, not their effective permissions. With custom roles in scope, this is wrong — a SELLER_SUPPORT admin granted a custom role with `wallets.adjust` would see the adjust button hidden by the role-enum check but the API would allow the action.

**Sketch.**
- The admin SPA already calls `/admin/me` (or equivalent) at boot. Extend the response to include `permissions: string[]` from the new resolver.
- Replace every `role === 'SUPER_ADMIN'` check in the admin UI with a `hasPermission('wallets.adjust')` helper.
- Hide-on-no-permission for buttons; clear "You do not have permission" empty-state for entire pages.

**Prerequisites.** None — the resolver already populates this for the API. Just a frontend change.

**Size.** 1–2 days frontend.

**Interim mitigation.** None needed for security — the API is the enforcement point. UI mismatch is only a UX issue (users see buttons they can't use).

---

## 6. ABAC policy lifecycle (admin UI + cache invalidation)

**Gap.** `ResourcePolicy` rows have a 60s in-memory cache (`PolicyEvaluatorService`). A policy change takes up to 60s to apply unless `invalidate()` is called. There is no admin UI today for editing policies — seed via SQL or repo-script only.

**Sketch.**
- Admin controller `AdminPolicyController` exposing CRUD on `ResourcePolicy`, gated by `@Permissions('roles.write')`.
- Every mutation calls `PolicyEvaluatorService.invalidate(resourceType, action)` after the DB write commits.
- Pub/sub on Redis if we ever go multi-instance — for now single-instance is enough.

**Size.** 2 days backend + 2 days frontend.

**Interim mitigation.** Operators with DB access can edit `resource_policies` directly and restart the API to clear the cache.

---

## Summary of risk vs. effort

| Item | Risk if unaddressed | Effort | Order |
|---|---|---|---|
| 1. Scope guard | High (silent IDOR) | 12 days | After strict-mode flip — needs design |
| 2. Seller permissions | Medium (only when seller-staff lands) | 5 days | Conditional on seller-staff scope |
| 3. MFA + step-up | High (any admin compromise = full damage) | 7 days | Next priority after scope guard |
| 4. JWT hardening | Medium (narrow race window) | 3 days | Bundle with MFA work |
| 5. UI permission consistency | Low (UX only, API enforces) | 2 days | Coordinate with admin UI sprint |
| 6. ABAC lifecycle UI | Low | 4 days | When policies multiply (today: 3 in use) |

None of these items is required to enable strict mode for the existing permission-based gating. They are the next-mile hardening.
