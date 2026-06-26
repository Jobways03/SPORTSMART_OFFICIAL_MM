import 'reflect-metadata';
import { AdminPermissionResolver } from './admin-permission-resolver.service';
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  SUPER_ADMIN_DELEGATED_PERMISSIONS,
} from './permission-registry';

// SUPER_ADMIN holds every registered permission EXCEPT the seller/franchise
// lifecycle-management set, which is delegated to the dedicated D2C/Retailer/
// Franchise admin roles. See SUPER_ADMIN_DELEGATED_PERMISSIONS.
const SUPER_ADMIN_EXPECTED_COUNT =
  ALL_PERMISSION_KEYS.length - SUPER_ADMIN_DELEGATED_PERMISSIONS.length;

/**
 * Phase 4 (PR 4.6) — resolver behaviour matrix.
 *
 * The resolver is the single source of truth for "what permissions does
 * this admin have right now?". Both AdminAuthGuard (per request) and
 * RoleService.resolvePermissionsForAdmin (admin UI) delegate to it.
 *
 * Tested cases:
 *  - SUPER_ADMIN gets every registered permission key (regression for
 *    the actorPermissionCount=0 incident).
 *  - System roles get exactly their declared default set when no
 *    custom-role assignments exist.
 *  - Custom-role grants are unioned with role defaults (no dedup bugs).
 *  - Unknown role enum value falls back to an empty set.
 *  - A custom-role query failure degrades cleanly: returns role-default
 *    permissions and sets fullyResolved=false instead of throwing.
 */
describe('AdminPermissionResolver', () => {
  function mockPrisma(
    assignments: Array<{ role: { name: string; permissions: Array<{ permissionKey: string }> } }> | Error,
  ) {
    return {
      adminRoleAssignment: {
        findMany: jest.fn().mockImplementation(async () => {
          if (assignments instanceof Error) throw assignments;
          return assignments;
        }),
      },
    } as any;
  }

  it('SUPER_ADMIN resolves to every registered permission key EXCEPT the delegated seller/franchise set', async () => {
    const resolver = new AdminPermissionResolver(mockPrisma([]));
    const result = await resolver.resolve('admin-1', 'SUPER_ADMIN');

    expect(result.fullyResolved).toBe(true);
    expect(result.permissions.length).toBeGreaterThan(0);
    // Regression: this is the exact failure we observed in prod
    // (actorPermissionCount=0 for SUPER_ADMIN under PERMISSIONS_GUARD_STRICT=false).
    expect(result.permissions.length).toBe(SUPER_ADMIN_EXPECTED_COUNT);
    for (const key of ALL_PERMISSION_KEYS) {
      if (SUPER_ADMIN_DELEGATED_PERMISSIONS.includes(key)) {
        // Seller/franchise lifecycle management is delegated away from SUPER_ADMIN.
        expect(result.permissions).not.toContain(key);
      } else {
        expect(result.permissions).toContain(key);
      }
    }
  });

  it('SELLER_OPERATIONS resolves to its declared default set (no custom roles)', async () => {
    const resolver = new AdminPermissionResolver(mockPrisma([]));
    const result = await resolver.resolve('admin-2', 'SELLER_OPERATIONS');

    expect(result.fullyResolved).toBe(true);
    const expected = SYSTEM_ROLE_PERMISSIONS['SELLER_OPERATIONS']!;

    for (const key of expected) {
      expect(result.permissions).toContain(key);
    }
    expect(result.permissions.length).toBe(expected.length);
    expect(result.customRoles).toEqual([]);
  });

  it('unknown role enum value resolves to an empty set, not a throw', async () => {
    const resolver = new AdminPermissionResolver(mockPrisma([]));
    const result = await resolver.resolve('admin-3', 'NOT_A_REAL_ROLE');

    expect(result.fullyResolved).toBe(true);
    expect(result.permissions).toEqual([]);
  });

  it('unions custom-role grants with the role-default set, deduplicated', async () => {
    const resolver = new AdminPermissionResolver(
      mockPrisma([
        {
          role: {
            name: 'finance-tier-2',
            // 'wallets.read' is already in SELLER_SUPPORT defaults — should
            // appear once in the result, not twice.
            permissions: [
              { permissionKey: 'wallets.read' },
              { permissionKey: 'refunds.confirm' },
            ],
          },
        },
      ]),
    );

    const result = await resolver.resolve('admin-4', 'SELLER_SUPPORT');

    expect(result.fullyResolved).toBe(true);
    expect(result.permissions).toContain('wallets.read');
    expect(result.permissions).toContain('refunds.confirm');
    expect(result.customRoles).toEqual(['finance-tier-2']);
    // No duplicates.
    expect(new Set(result.permissions).size).toBe(result.permissions.length);
  });

  it('degrades gracefully when custom-role lookup throws', async () => {
    const resolver = new AdminPermissionResolver(
      mockPrisma(new Error('connection terminated')),
    );

    const result = await resolver.resolve('admin-5', 'SUPER_ADMIN');

    expect(result.fullyResolved).toBe(false);
    // Falls back to role-default permissions so SUPER_ADMIN still works
    // even when the admin_custom_roles table is unreachable. A hard
    // throw here would 403 every admin route in strict mode — worse
    // than degraded resolution.
    expect(result.permissions.length).toBe(SUPER_ADMIN_EXPECTED_COUNT);
  });
});
