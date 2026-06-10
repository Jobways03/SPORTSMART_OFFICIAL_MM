import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { SYSTEM_ROLE_PERMISSIONS } from './permission-registry';

export interface ResolvedAdminPermissions {
  /** Effective permission keys (union of role-default + custom-role grants). */
  permissions: string[];
  /** Custom-role names attached to this admin, for ABAC principalType=CUSTOM_ROLE. */
  customRoles: string[];
  /**
   * True iff resolution actually queried the DB and produced a result.
   * False means the resolver fell back to enum-derived permissions only
   * (e.g. the custom-role join failed). The PermissionsGuard does not
   * differentiate, but the readiness endpoint surfaces this as a warning.
   */
  fullyResolved: boolean;
}

/**
 * Phase 4 (PR 4.6) — single source of truth for "what permissions does
 * this admin effectively have?". Lives in /core/authorization so the
 * AdminAuthGuard (also in /core) can populate req.user.permissions
 * without a /core → /modules import that would violate ADR-001's
 * modular-monolith boundary.
 *
 * Effective permissions = (defaults from Admin.role enum) ∪
 *   (permissions granted via AdminRoleAssignment → AdminCustomRole).
 *
 * Semantics:
 *   - We always return *something*: at minimum the enum-derived set,
 *     because Admin.role is loaded synchronously by AdminAuthGuard from
 *     a trusted source (the admins table). Returning [] on a DB error
 *     would 403 every SUPER_ADMIN route in strict mode and is worse
 *     than a degraded but accurate set.
 *   - On hard failure (custom-role query throws) we still return the
 *     enum-derived permissions and set `fullyResolved=false`. The
 *     caller decides whether that's acceptable (in soak it is; in
 *     strict the request will simply fail any route that requires a
 *     custom-role-only permission, which is the safer outcome).
 *   - SUPER_ADMIN gets ALL_PERMISSION_KEYS because the registry says so;
 *     no special-cased short-circuit in this resolver. That keeps a
 *     misconfigured registry recoverable through normal role edits.
 */
@Injectable()
export class AdminPermissionResolver {
  private readonly logger = new Logger(AdminPermissionResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(adminId: string, adminRole: string): Promise<ResolvedAdminPermissions> {
    const fromEnum = SYSTEM_ROLE_PERMISSIONS[adminRole] ?? [];
    const set = new Set<string>(fromEnum);
    const customRoleNames: string[] = [];
    let fullyResolved = true;

    try {
      const assignments = await this.prisma.adminRoleAssignment.findMany({
        where: { adminId },
        include: { role: { include: { permissions: true } } },
      });
      for (const a of assignments) {
        // A disabled role grants nothing: skip its permissions AND omit it
        // from the admin's reported custom-role list. Re-enabling restores
        // both on the next resolve.
        if (a.role?.isActive === false) continue;
        if (a.role?.name) customRoleNames.push(a.role.name);
        for (const p of a.role?.permissions ?? []) {
          if (p?.permissionKey) set.add(p.permissionKey);
        }
      }
    } catch (err) {
      // Degraded path — log so observability surfaces this, but return
      // the enum-derived permissions so the request can still proceed
      // through routes that the role enum alone grants. A custom-role
      // outage shouldn't 403 a SUPER_ADMIN.
      fullyResolved = false;
      this.logger.error(
        `Failed to resolve custom-role permissions for admin=${adminId}: ${
          (err as Error).message
        }`,
      );
    }

    return {
      permissions: Array.from(set),
      customRoles: customRoleNames,
      fullyResolved,
    };
  }
}
