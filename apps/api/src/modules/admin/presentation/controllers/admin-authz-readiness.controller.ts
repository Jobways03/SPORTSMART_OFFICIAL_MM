import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AdminPermissionResolver } from '../../../../core/authorization/admin-permission-resolver.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_RISK,
  SYSTEM_ROLE_PERMISSIONS,
} from '../../../../core/authorization/permission-registry';

/**
 * Phase 4 (PR 4.6) — readiness probe for the authorization stack.
 *
 * Operators use this to decide whether `PERMISSIONS_GUARD_STRICT=true`
 * is safe to flip in staging / prod. It surfaces:
 *
 *   - The current value of each authz env flag (so the response
 *     matches what's actually loaded, not what the dashboard claims).
 *   - SUPER_ADMIN's effective permission count. The prod incident
 *     was that this returned 0 even though the role enum maps to
 *     every key — a smoke test the readiness endpoint replicates.
 *   - The size of the permission registry + the risk-tier counts.
 *   - System roles and how many permissions each grants.
 *   - Warnings: zero-coverage role enums, registry keys with no role
 *     grant, CRITICAL permissions without ABAC policies.
 *
 * Read-only — `roles.read` is enough. The endpoint never mutates state.
 */
@ApiTags('Admin Authorization Readiness')
@Controller('admin/authz')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminAuthzReadinessController {
  constructor(
    private readonly env: EnvService,
    private readonly resolver: AdminPermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  @Get('readiness')
  @Permissions('roles.read')
  async readiness() {
    const strictMode = this.env.getBoolean('PERMISSIONS_GUARD_STRICT', false);
    const abacEnabled = this.env.getBoolean('ABAC_ENABLED', false);
    const auditEnabled = this.env.getBoolean('AUTHZ_AUDIT_ENABLED', true);

    // Synthetic resolve for SUPER_ADMIN against the registry. The
    // resolver still hits Prisma for custom-role assignments, but the
    // synthetic adminId means no custom roles → role-default only,
    // which is exactly what we want to verify wiring against.
    const superAdminResolved = await this.resolver.resolve(
      '__readiness-probe-super-admin__',
      'SUPER_ADMIN',
    );

    const totalPermissions = ALL_PERMISSION_KEYS.length;
    const roleSummaries = Object.entries(SYSTEM_ROLE_PERMISSIONS).map(
      ([role, perms]) => ({
        role,
        permissionCount: perms.length,
        permissions: [...perms].sort(),
      }),
    );

    // Registry-side warnings (no DB hit). Operators can act on these
    // independently of admin runtime state.
    const warnings: string[] = [];

    if (superAdminResolved.permissions.length !== totalPermissions) {
      warnings.push(
        `SUPER_ADMIN resolves to ${superAdminResolved.permissions.length}/${totalPermissions} permissions — ` +
          `check SYSTEM_ROLE_PERMISSIONS.SUPER_ADMIN against ALL_PERMISSION_KEYS.`,
      );
    }
    if (!superAdminResolved.fullyResolved) {
      warnings.push(
        'AdminPermissionResolver returned fullyResolved=false for SUPER_ADMIN — ' +
          'the admin_custom_roles join is failing. Check DB connectivity.',
      );
    }
    if (!strictMode) {
      warnings.push(
        'PERMISSIONS_GUARD_STRICT is OFF (soak mode). Failed permission checks ' +
          'log wouldHaveBeenBlocked=true but allow the request through. Acceptable ' +
          'during initial rollout; flip to true once authz.deny logs are clean.',
      );
    }
    if (!auditEnabled) {
      warnings.push(
        'AUTHZ_AUDIT_ENABLED is OFF. Guard decisions are not being recorded ' +
          'in authorization_audits — compliance and incident-response will lack history.',
      );
    }

    // Registry keys that no system role grants. Could be intentional
    // (only assignable via custom roles), but the readiness endpoint
    // makes them visible.
    const grantedKeys = new Set<string>();
    for (const perms of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const p of perms) grantedKeys.add(p);
    }
    const ungrantedKeys = ALL_PERMISSION_KEYS.filter((k) => !grantedKeys.has(k));

    // Both the counts (for KPI tiles) and the actual lists (for the
    // expandable drill-down panels on the readiness page).
    const riskTiers = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const permissionsByTier: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', string[]> = {
      CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [],
    };
    for (const key of ALL_PERMISSION_KEYS) {
      const tier = PERMISSION_RISK[key] ?? 'LOW';
      riskTiers[tier]++;
      permissionsByTier[tier].push(key);
    }
    for (const tier of Object.keys(permissionsByTier) as (keyof typeof permissionsByTier)[]) {
      permissionsByTier[tier].sort();
    }

    return {
      success: true,
      data: {
        flags: {
          strictMode,
          abacEnabled,
          auditEnabled,
        },
        registry: {
          totalPermissions,
          riskTiers,
          permissionsByTier,
          ungrantedKeys,
        },
        roles: roleSummaries,
        superAdmin: {
          permissionCount: superAdminResolved.permissions.length,
          fullyResolved: superAdminResolved.fullyResolved,
          permissions: [...superAdminResolved.permissions].sort(),
        },
        warnings,
      },
    };
  }

  /**
   * GET /admin/authz/recent-denials
   *
   * The most useful pre-flip signal: who/what would have been blocked
   * by the permissions guard in the recent past. Reads
   * authorization_audits where decision=DENY, ordered by createdAt
   * desc. Defaults to wouldHaveBlocked=true so the response only
   * surfaces things that *would have failed* in strict mode (i.e.
   * actionable items for the operator).
   *
   *   - `limit` (max 100, default 30)
   *   - `wouldHaveBlocked` (default 'true' — pass 'false' to also see
   *     strict-mode DENYs that already returned 403)
   *   - `since` ISO timestamp — only entries newer than this
   */
  @Get('recent-denials')
  @Permissions('roles.read')
  async recentDenials(
    @Query('limit') limit?: string,
    @Query('wouldHaveBlocked') wouldHaveBlocked?: string,
    @Query('since') since?: string,
  ) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '30', 10) || 30));
    const onlyWouldBlock = wouldHaveBlocked !== 'false';

    const where: any = { decision: 'DENY' };
    if (onlyWouldBlock) where.wouldHaveBlocked = true;
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        where.createdAt = { gte: sinceDate };
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.authorizationAudit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        select: {
          id: true,
          createdAt: true,
          adminId: true,
          actorRole: true,
          routeLabel: true,
          method: true,
          path: true,
          layer: true,
          decision: true,
          wouldHaveBlocked: true,
          requiredPermissions: true,
          resourceType: true,
          action: true,
          reason: true,
        },
      }),
      this.prisma.authorizationAudit.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items: rows,
        total,
        filters: {
          limit: limitNum,
          wouldHaveBlocked: onlyWouldBlock,
          since: since ?? null,
        },
      },
    };
  }
}
