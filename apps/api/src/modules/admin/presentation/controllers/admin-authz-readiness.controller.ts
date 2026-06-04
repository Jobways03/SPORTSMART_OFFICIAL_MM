import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { ForbiddenAppException, NotFoundAppException } from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AdminPermissionResolver } from '../../../../core/authorization/admin-permission-resolver.service';
import { RouteAuthzInventoryService } from '../../../../core/authorization/route-authz-inventory.service';
import { AuthzModeService } from '../../../../core/authorization/authz-mode.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { ReviewDenialDto, SetAuthzModeDto } from '../dtos/admin-authz.dtos';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_RISK,
  SYSTEM_ROLE_PERMISSIONS,
} from '../../../../core/authorization/permission-registry';

/**
 * Phase 4 (PR 4.6) — readiness probe for the authorization stack.
 *
 * Hardened (Authz-Readiness audit): the full permission/role key lists are
 * a privilege-escalation recon surface, so they are TIERED — `roles.read`
 * sees counts + summary; the `authz.readiness.full` key is required for the
 * actual key lists, the route inventory, and denial detail. Every read is
 * audited. A new route inventory endpoint walks the live controller graph
 * to find any route carrying PermissionsGuard but no @Permissions key (a
 * no-op guard) + registry drift.
 */
@ApiTags('Admin Authorization Readiness')
@Controller('admin/authz')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminAuthzReadinessController {
  constructor(
    private readonly env: EnvService,
    private readonly resolver: AdminPermissionResolver,
    private readonly prisma: PrismaService,
    private readonly routeInventory: RouteAuthzInventoryService,
    private readonly authzMode: AuthzModeService,
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  /** Does the caller hold the higher-tier full-detail permission? */
  private callerHasFull(req: Request): boolean {
    const perms = ((req as any).user?.permissions ?? []) as string[];
    return Array.isArray(perms) && perms.includes('authz.readiness.full');
  }

  private auditRead(req: Request, endpoint: string): void {
    const actorId = (req as any).adminId ?? (req as any).user?.id ?? 'unknown';
    void this.audit
      ?.writeAuditLog({
        actorId,
        actorType: 'ADMIN',
        action: 'authz.readiness.viewed',
        module: 'authorization',
        resource: 'authz_readiness',
        resourceId: endpoint,
        newValue: { full: this.callerHasFull(req) },
      })
      .catch(() => undefined);
  }

  @Get('readiness')
  @Permissions('roles.read')
  async readiness(@Req() req: Request) {
    this.auditRead(req, 'readiness');
    const full = this.callerHasFull(req);

    // EFFECTIVE flags (env baseline OR tighten-only runtime override).
    const modeInfo = this.authzMode.getModeInfo();
    const strictMode = modeInfo.strictMode.effective;
    const abacEnabled = modeInfo.abacEnabled.effective;
    const auditEnabled = modeInfo.auditEnabled.effective;

    const superAdminResolved = await this.resolver.resolve(
      '__readiness-probe-super-admin__',
      'SUPER_ADMIN',
    );

    const totalPermissions = ALL_PERMISSION_KEYS.length;
    const roleSummaries = Object.entries(SYSTEM_ROLE_PERMISSIONS).map(([role, perms]) => ({
      role,
      permissionCount: perms.length,
      // Full key lists only for the higher-tier caller.
      permissions: full ? [...perms].sort() : undefined,
    }));

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
          'log wouldHaveBlocked=true but allow the request through. Acceptable ' +
          'during initial rollout; flip to true once authz.deny logs are clean.',
      );
    }
    if (!auditEnabled) {
      warnings.push(
        'AUTHZ_AUDIT_ENABLED is OFF. Guard decisions are not being recorded ' +
          'in authorization_audits — compliance and incident-response will lack history.',
      );
    }

    // CRITICAL-without-ABAC warning (was documented but never implemented).
    // ABAC rules live in ResourcePolicy (resourceType+action). If a CRITICAL
    // permission is held, the action runs unconditionally unless an enabled
    // policy adds attribute/amount gating on top.
    const criticalKeys = ALL_PERMISSION_KEYS.filter((k) => PERMISSION_RISK[k] === 'CRITICAL');
    const enabledPolicyCount = await this.prisma.resourcePolicy.count({
      where: { enabled: true },
    });
    if (criticalKeys.length > 0 && enabledPolicyCount === 0) {
      warnings.push(
        `${criticalKeys.length} CRITICAL permissions are defined but NO enabled ABAC ResourcePolicy ` +
          `rows exist — attribute/amount gating (e.g. refund caps) is not enforced. Holding a CRITICAL ` +
          `permission grants the action unconditionally.`,
      );
    } else if (!abacEnabled && criticalKeys.length > 0) {
      warnings.push(
        `ABAC_ENABLED is OFF — the ${enabledPolicyCount} configured ResourcePolicy rows are NOT evaluated, ` +
          `so CRITICAL permissions run without attribute/amount caps.`,
      );
    }

    const grantedKeys = new Set<string>();
    for (const perms of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const p of perms) grantedKeys.add(p);
    }
    const ungrantedKeys = ALL_PERMISSION_KEYS.filter((k) => !grantedKeys.has(k));

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
        full,
        flags: { strictMode, abacEnabled, auditEnabled, enabledPolicyCount },
        // env vs runtime-override vs effective, with source + who/when.
        mode: modeInfo,
        registry: {
          totalPermissions,
          riskTiers,
          // Full per-tier key lists only for the higher-tier caller.
          permissionsByTier: full ? permissionsByTier : undefined,
          ungrantedCount: ungrantedKeys.length,
          ungrantedKeys: full ? ungrantedKeys : undefined,
        },
        roles: roleSummaries,
        superAdmin: {
          permissionCount: superAdminResolved.permissions.length,
          fullyResolved: superAdminResolved.fullyResolved,
          permissions: full ? [...superAdminResolved.permissions].sort() : undefined,
        },
        warnings,
      },
    };
  }

  /**
   * GET /admin/authz/route-inventory — walks the live controller graph and
   * reports the authz posture of every route. The headline check: routes
   * with PermissionsGuard but no @Permissions key (no-op guard). Higher-tier
   * only (exposes the full route map + permission keys).
   */
  @Get('route-inventory')
  @Permissions('authz.readiness.full')
  async getRouteInventory(@Req() req: Request) {
    this.auditRead(req, 'route-inventory');
    const inv = this.routeInventory.scan();
    return {
      success: true,
      data: {
        totalRoutes: inv.totalRoutes,
        unprotectedCount: inv.unprotectedRoutes.length,
        unprotectedRoutes: inv.unprotectedRoutes,
        driftKeys: inv.driftKeys,
        orphanKeyCount: inv.orphanKeys.length,
        orphanKeys: inv.orphanKeys,
        routes: inv.routes,
      },
    };
  }

  /**
   * POST /admin/authz/mode — runtime authz-mode override. SUPER_ADMIN only.
   *
   * TIGHTEN-ONLY by construction: AuthzModeService applies the override with
   * OR-semantics over the env baseline, so this can ENABLE strict/abac/audit
   * early (the rollout action) but can NEVER disable a deploy-mandated flag —
   * that still requires an env change + redeploy. Every change is audited.
   */
  @Post('mode')
  @Permissions('roles.write')
  async setMode(@Req() req: Request, @Body() dto: SetAuthzModeDto) {
    if ((req as any).adminRole !== 'SUPER_ADMIN') {
      throw new ForbiddenAppException('Only SUPER_ADMIN may change authorization mode.');
    }
    const adminId = (req as any).adminId ?? (req as any).user?.id ?? null;
    const before = this.authzMode.getModeInfo();
    const override = await this.authzMode.setOverride(
      { strictMode: dto.strictMode, abacEnabled: dto.abacEnabled, auditEnabled: dto.auditEnabled },
      adminId,
    );
    const after = this.authzMode.getModeInfo();
    void this.audit
      ?.writeAuditLog({
        actorId: adminId ?? 'unknown',
        actorType: 'ADMIN',
        action: 'authz.mode.changed',
        module: 'authorization',
        resource: 'system_setting',
        resourceId: 'authz.mode',
        newValue: {
          override,
          effectiveBefore: {
            strict: before.strictMode.effective,
            abac: before.abacEnabled.effective,
            audit: before.auditEnabled.effective,
          },
          effectiveAfter: {
            strict: after.strictMode.effective,
            abac: after.abacEnabled.effective,
            audit: after.auditEnabled.effective,
          },
        },
      })
      .catch(() => undefined);
    return { success: true, data: after };
  }

  /**
   * PATCH /admin/authz/denials/:id/review — triage a logged denial so the
   * feed converges toward strict-mode readiness instead of re-surfacing the
   * same noise. SUPER_ADMIN / roles.write only; audited.
   */
  @Patch('denials/:id/review')
  @Permissions('roles.write')
  async reviewDenial(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReviewDenialDto,
  ) {
    const adminId = (req as any).adminId ?? (req as any).user?.id ?? 'unknown';
    const existing = await this.prisma.authorizationAudit.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundAppException('Denial not found');
    const updated = await this.prisma.authorizationAudit.update({
      where: { id },
      data: {
        reviewStatus: dto.reviewStatus,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote ?? null,
      },
      select: {
        id: true,
        reviewStatus: true,
        reviewedByAdminId: true,
        reviewedAt: true,
        reviewNote: true,
      },
    });
    void this.audit
      ?.writeAuditLog({
        actorId: adminId,
        actorType: 'ADMIN',
        action: 'authz.denial.reviewed',
        module: 'authorization',
        resource: 'authorization_audit',
        resourceId: id,
        newValue: { reviewStatus: dto.reviewStatus },
      })
      .catch(() => undefined);
    return { success: true, data: updated };
  }

  @Get('recent-denials')
  @Permissions('roles.read')
  async recentDenials(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('wouldHaveBlocked') wouldHaveBlocked?: string,
    @Query('since') since?: string,
    @Query('requiredPermission') requiredPermission?: string,
    @Query('actorRole') actorRole?: string,
    @Query('routeLabel') routeLabel?: string,
    @Query('reviewStatus') reviewStatus?: string,
  ) {
    this.auditRead(req, 'recent-denials');
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '30', 10) || 30));
    const onlyWouldBlock = wouldHaveBlocked !== 'false';

    const where: any = { decision: 'DENY' };
    if (onlyWouldBlock) where.wouldHaveBlocked = true;
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) where.createdAt = { gte: sinceDate };
    }
    // New filters — let operators drill into "which permission/role/route
    // produces the most denials" instead of paging the whole feed.
    if (requiredPermission) where.requiredPermissions = { has: requiredPermission };
    if (actorRole) where.actorRole = actorRole;
    if (routeLabel) where.routeLabel = { contains: routeLabel, mode: 'insensitive' };
    // Default to UNREVIEWED so triaged denials drop out of the feed;
    // ?reviewStatus=all shows everything, a specific status filters to it.
    const VALID_REVIEW = ['UNREVIEWED', 'FALSE_POSITIVE', 'EXPECTED_DENY', 'FIXED', 'IGNORED'];
    const reviewFilter =
      reviewStatus === 'all'
        ? undefined
        : reviewStatus && VALID_REVIEW.includes(reviewStatus)
          ? reviewStatus
          : 'UNREVIEWED';
    if (reviewFilter) where.reviewStatus = reviewFilter as never;

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
          actorRoles: true, // multi-role context (was unused)
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
          requestId: true, // correlate with the access log (was unused)
          reviewStatus: true,
          reviewedByAdminId: true,
          reviewedAt: true,
          reviewNote: true,
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
          requiredPermission: requiredPermission ?? null,
          actorRole: actorRole ?? null,
          routeLabel: routeLabel ?? null,
          reviewStatus: reviewFilter ?? 'all',
        },
      },
    };
  }
}
