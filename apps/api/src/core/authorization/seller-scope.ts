// Phase 38 (admin enforcement) — resolve an admin's seller-type scope from
// their effective permissions (`req.user.permissions`, populated by
// admin-permission-resolver). This is the AUTHORITATIVE source the backend
// trusts — NOT the client-supplied `X-Seller-Type` header / `sellerType`
// query param, which an admin could forge with a raw HTTP client.
//
// Semantics (deliberately backward-compatible — opt-in tightening, zero
// regression vs. the pre-enforcement behaviour where every admin saw all):
//   - holds `sellers.scope.d2c` and/or `sellers.scope.retail` → restricted to
//     exactly those seller types.
//   - holds NEITHER → unrestricted (legacy: sees all seller types). Keeps
//     existing SELLER_OPERATIONS admins working; you create the hard boundary
//     for a team by granting ONE scope permission to their (custom) role.
//   - SUPER_ADMIN holds both (via ALL_PERMISSION_KEYS) → sees all.

export type SellerType = 'D2C' | 'RETAIL';

/** Maps a seller type to the permission key that grants access to it. */
export const SELLER_SCOPE_PERMISSION: Record<SellerType, string> = {
  D2C: 'sellers.scope.d2c',
  RETAIL: 'sellers.scope.retail',
};

export interface SellerScope {
  /** true when the admin holds NO scope permission → unrestricted (all types). */
  unrestricted: boolean;
  /** the seller types this admin may access; meaningful only when not unrestricted. */
  allowed: SellerType[];
}

/**
 * Derive an admin's seller-type scope from their effective permission set.
 * Pure + synchronous — safe to call in a guard or a controller with no DB hit.
 */
export function resolveSellerScope(
  permissions: readonly string[] | undefined | null,
): SellerScope {
  const perms = permissions ?? [];
  const allowed: SellerType[] = [];
  if (perms.includes(SELLER_SCOPE_PERMISSION.D2C)) allowed.push('D2C');
  if (perms.includes(SELLER_SCOPE_PERMISSION.RETAIL)) allowed.push('RETAIL');
  return allowed.length === 0
    ? { unrestricted: true, allowed: [] }
    : { unrestricted: false, allowed };
}

/** Whether `scope` permits acting on a seller of the given type. */
export function scopeAllowsType(
  scope: SellerScope,
  type: SellerType | null | undefined,
): boolean {
  if (scope.unrestricted) return true;
  return type != null && scope.allowed.includes(type);
}

/**
 * The allowed seller types as a list for a Prisma `{ in: [...] }` filter, or
 * `null` when the admin is unrestricted (→ apply no seller-type filter at all).
 * Convenience for scoping list endpoints.
 */
export function scopedTypesOrNull(scope: SellerScope): SellerType[] | null {
  return scope.unrestricted ? null : scope.allowed;
}

/** Resolve straight from a permission set to the list filter (or null = all). */
export function resolveScopedTypes(
  permissions: readonly string[] | undefined | null,
): SellerType[] | null {
  return scopedTypesOrNull(resolveSellerScope(permissions));
}
