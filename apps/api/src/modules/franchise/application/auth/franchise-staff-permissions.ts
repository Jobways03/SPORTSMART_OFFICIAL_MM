/**
 * Phase 159u (staff-auth B2) — the franchise-staff permission catalog,
 * role→permission defaults, and the effective-permission resolver.
 *
 * Permissions are coarse capability strings checked by @StaffPermissions on the
 * franchise business endpoints. The franchise OWNER implicitly holds all of
 * them (the owner is not a staff row); these govern STAFF tokens only.
 */

export const STAFF_PERMISSIONS = {
  POS_SELL: 'pos.sell',
  POS_VOID: 'pos.void',
  POS_RETURN: 'pos.return',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  PROCUREMENT_CREATE: 'procurement.create',
  REPORT_READ: 'report.read',
} as const;

export type StaffPermission =
  (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS];

export const ALL_STAFF_PERMISSIONS: string[] = Object.values(STAFF_PERMISSIONS);

/**
 * Default capability set per role. OWNER is included defensively (a staff row
 * should never be OWNER — the DTO blocks it — but if one exists it gets the
 * full set rather than silently nothing).
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  OWNER: [...ALL_STAFF_PERMISSIONS],
  MANAGER: [
    STAFF_PERMISSIONS.POS_SELL,
    STAFF_PERMISSIONS.POS_VOID,
    STAFF_PERMISSIONS.POS_RETURN,
    STAFF_PERMISSIONS.REPORT_READ,
    STAFF_PERMISSIONS.INVENTORY_VIEW,
  ],
  POS_OPERATOR: [STAFF_PERMISSIONS.POS_SELL, STAFF_PERMISSIONS.POS_RETURN],
  WAREHOUSE_STAFF: [
    STAFF_PERMISSIONS.INVENTORY_VIEW,
    STAFF_PERMISSIONS.INVENTORY_ADJUST,
    STAFF_PERMISSIONS.PROCUREMENT_CREATE,
  ],
};

/**
 * Effective permissions = the per-staff override set when present + non-empty
 * (it fully REPLACES the role defaults, so the owner grants an explicit set),
 * otherwise the role defaults. Unknown permission strings in an override are
 * dropped. Always returns a de-duplicated array.
 */
export function resolveStaffPermissions(
  role: string,
  overrides?: unknown,
): string[] {
  if (Array.isArray(overrides)) {
    const valid = overrides.filter(
      (p): p is string =>
        typeof p === 'string' && ALL_STAFF_PERMISSIONS.includes(p),
    );
    if (valid.length > 0) return Array.from(new Set(valid));
  }
  return [...(ROLE_DEFAULT_PERMISSIONS[role] ?? [])];
}
