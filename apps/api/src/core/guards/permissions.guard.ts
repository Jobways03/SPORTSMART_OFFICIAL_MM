import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnvService } from '../../bootstrap/env/env.service';
import { ForbiddenAppException } from '../exceptions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthorizationAuditService } from '../authorization/authorization-audit.service';
import { AuditPublicFacade } from '../../modules/audit/application/facades/audit-public.facade';

/**
 * Phase 4 (PR 4.2) — PermissionsGuard with log-only mode.
 *
 * Two modes, switched by `PERMISSIONS_GUARD_STRICT`:
 *
 *   strict=false (default — soak window):
 *     Always returns true. When the actor would FAIL the check, logs
 *     a structured WARN line. Lets us roll the guard out across every
 *     admin controller without a single 403, then watch the logs to
 *     verify nobody legitimately needed access we'd block.
 *
 *   strict=true (steady state):
 *     Returns true on success. Throws ForbiddenAppException with a
 *     stable problem-type slug (`permission-denied`) on failure.
 *
 * The log line shape is JSON-friendly so it greps cleanly against
 * `event=authz.deny`. Phase 4.4 swaps the WARN log for a structured
 * `AuthorizationAudit` row.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly env: EnvService,
    private readonly audit: AuthorizationAuditService,
    // Phase 13 — mirror DENY events to the unified AuditLog so the
    // generic audit search surfaces them alongside return/refund/etc.
    // entries. ALLOW events stay in the dedicated authorization_audits
    // table only — mirroring every successful request would 10x the
    // unified log volume for negligible incremental signal.
    private readonly unifiedAudit: AuditPublicFacade,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user = req.user as
      | { id?: string; roles?: string[]; permissions?: string[] }
      | undefined;

    const granted =
      !!user?.permissions &&
      requiredPermissions.every((perm) => user.permissions!.includes(perm));

    const routeLabel = this.routeLabel(context);
    const adminId = req.adminId ?? user?.id ?? null;
    const actorRoles = user?.roles ?? [];

    if (granted) {
      this.audit.record({
        layer: 'PERMISSIONS',
        decision: 'ALLOW',
        wouldHaveBlocked: false,
        routeLabel,
        adminId,
        actorRole: actorRoles[0] ?? null,
        actorRoles,
        method: req.method,
        path: req.originalUrl ?? req.url,
        ipAddress: req.ip ?? null,
        userAgent: req.headers?.['user-agent'] ?? null,
        requestId: req.id ?? req.requestId ?? null,
        requiredPermissions,
      });
      return true;
    }

    // Denial — strict-mode rejects, log-only mode warns and lets through.
    const detail = {
      event: 'authz.deny',
      strict: this.strict(),
      route: routeLabel,
      requiredPermissions,
      actorId: adminId,
      actorRoles,
      actorPermissionCount: user?.permissions?.length ?? 0,
    };

    if (this.strict()) {
      this.logger.warn(JSON.stringify(detail));
      this.audit.record({
        layer: 'PERMISSIONS',
        decision: 'DENY',
        wouldHaveBlocked: false,
        routeLabel,
        adminId,
        actorRole: actorRoles[0] ?? null,
        actorRoles,
        method: req.method,
        path: req.originalUrl ?? req.url,
        ipAddress: req.ip ?? null,
        userAgent: req.headers?.['user-agent'] ?? null,
        requestId: req.id ?? req.requestId ?? null,
        requiredPermissions,
        reason: `Missing required permission(s): ${requiredPermissions.join(', ')}`,
      });
      this.mirrorDenyToUnifiedAudit({
        adminId,
        actorRoles,
        routeLabel,
        method: req.method,
        path: req.originalUrl ?? req.url,
        requiredPermissions,
        wouldHaveBlocked: false,
        strictMode: true,
      });
      throw new ForbiddenAppException(
        `Missing required permission(s): ${requiredPermissions.join(', ')}`,
      );
    }

    // Log-only soak mode.
    this.logger.warn(
      JSON.stringify({
        ...detail,
        wouldHaveBeenBlocked: true,
        note: 'PERMISSIONS_GUARD_STRICT=false; allowing through during soak',
      }),
    );
    this.audit.record({
      layer: 'PERMISSIONS',
      decision: 'ALLOW',
      wouldHaveBlocked: true,
      routeLabel,
      adminId,
      actorRole: actorRoles[0] ?? null,
      actorRoles,
      method: req.method,
      path: req.originalUrl ?? req.url,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
      requestId: req.id ?? req.requestId ?? null,
      requiredPermissions,
      reason: 'soak: would have been blocked under PERMISSIONS_GUARD_STRICT=true',
    });
    this.mirrorDenyToUnifiedAudit({
      adminId,
      actorRoles,
      routeLabel,
      method: req.method,
      path: req.originalUrl ?? req.url,
      requiredPermissions,
      wouldHaveBlocked: true,
      strictMode: false,
    });
    return true;
  }

  /**
   * Phase 13 — mirror permission denials to the unified AuditLog so
   * compliance / incident-response can find authz events through the
   * same audit search as return / refund / wallet entries. Best-effort.
   * Only DENY events get mirrored (ALLOW would 10x the audit volume
   * for no incremental signal — the dedicated authorization_audits
   * table covers full-fidelity history).
   */
  private mirrorDenyToUnifiedAudit(args: {
    adminId: string | null;
    actorRoles: string[];
    routeLabel: string;
    method: string;
    path: string;
    requiredPermissions: string[];
    wouldHaveBlocked: boolean;
    strictMode: boolean;
  }): void {
    this.unifiedAudit
      .writeAuditLog({
        actorId: args.adminId ?? undefined,
        actorRole: args.actorRoles[0],
        action: 'authz.evaluate',
        module: 'authorization',
        resource: 'route',
        resourceId: args.routeLabel,
        newValue: {
          decision: 'DENY',
          wouldHaveBlocked: args.wouldHaveBlocked,
          strictMode: args.strictMode,
          requiredPermissions: args.requiredPermissions,
          method: args.method,
          path: args.path,
        },
      })
      .catch(() => undefined);
  }

  private strict(): boolean {
    return this.env.getBoolean('PERMISSIONS_GUARD_STRICT', false);
  }

  private routeLabel(ctx: ExecutionContext): string {
    const handler = ctx.getHandler()?.name ?? 'unknown';
    const klass = ctx.getClass()?.name ?? 'unknown';
    return `${klass}.${handler}`;
  }
}
