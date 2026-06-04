import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { ForbiddenAppException } from '../exceptions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthorizationAuditService } from '../authorization/authorization-audit.service';
import { AuthzModeService } from '../authorization/authz-mode.service';
import { AuditPublicFacade } from '../../modules/audit/application/facades/audit-public.facade';
import { PERMISSION_RISK } from '../authorization/permission-registry';
import { REQUIRES_STEP_UP_METADATA_KEY } from '../step-up/requires-step-up.decorator';

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
// Phase 24 (2026-05-20) — Auto-step-up: when ANY required permission
// is classified CRITICAL in PERMISSION_RISK, the guard demands a
// fresh AdminSession.stepUpVerifiedAt within this window before
// allowing the request through. Overridable per-route via the
// `@RequiresStepUp({ maxAgeMs })` decorator (lower = stricter).
const CRITICAL_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

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
    // Phase 24 (2026-05-20) — needed for the CRITICAL auto-step-up
    // check. Looks up AdminSession.stepUpVerifiedAt by req.sessionId.
    private readonly prisma: PrismaService,
    // Resolves effective strict mode (env OR tighten-only runtime override).
    private readonly authzMode: AuthzModeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      // Phase 24 (2026-05-20) — Auto-step-up for CRITICAL risk-tier
      // permissions. If any of the required permissions is classified
      // CRITICAL in PERMISSION_RISK, the request must come from a
      // session that recently passed an MFA step-up challenge. The
      // dedicated StepUpGuard (@RequiresStepUp decorator) still works
      // for finer-grained windows or non-permission-driven gates;
      // this branch is the safety net for routes that haven't been
      // explicitly annotated.
      const isCritical = requiredPermissions.some(
        (p) => PERMISSION_RISK[p as keyof typeof PERMISSION_RISK] === 'CRITICAL',
      );
      // Skip the auto-step-up if the route explicitly opts in via
      // @RequiresStepUp — that guard runs separately and we want to
      // avoid double-checking with a potentially different window.
      const hasExplicitStepUp = !!this.reflector.getAllAndOverride(
        REQUIRES_STEP_UP_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (isCritical && !hasExplicitStepUp) {
        const stepUpOk = await this.assertFreshStepUp(req);
        if (!stepUpOk) {
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
            reason: 'CRITICAL permission requires fresh MFA step-up',
          });
          throw new ForbiddenException({
            code: 'STEP_UP_REQUIRED',
            message:
              'This action requires a fresh MFA step-up. POST a TOTP code to /admin/mfa/step-up to elevate the session, then retry.',
            meta: { maxAgeMs: CRITICAL_STEP_UP_MAX_AGE_MS },
          });
        }
      }
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
      // Phase 24 (2026-05-20) — generic 403 message in strict mode.
      // Pre-Phase-24 the message included the exact list of missing
      // permission keys ("Missing required permission(s): roles.write")
      // — a mild API-enumeration vector since an attacker hitting
      // unauthenticated endpoints could learn permission names from
      // the error body. The detail still lives in the
      // authorization_audits + unified audit log rows so legitimate
      // operators can diagnose denials; only the body the requester
      // sees is generic.
      throw new ForbiddenAppException('Forbidden');
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
  /**
   * Phase 24 (2026-05-20) — checks AdminSession.stepUpVerifiedAt
   * for the request's session id. Returns true if the session passed
   * an MFA step-up within CRITICAL_STEP_UP_MAX_AGE_MS. Falls open on
   * lookup errors (degrades to "step-up missing") to preserve the
   * fail-closed default — incident-response can still observe the
   * denial via the audit log.
   */
  private async assertFreshStepUp(req: any): Promise<boolean> {
    const sessionId = req?.sessionId ?? req?.user?.sessionId;
    if (!sessionId) return false;
    try {
      const session = (await (
        this.prisma.adminSession.findUnique as any
      )({
        where: { id: sessionId },
        select: { stepUpVerifiedAt: true, revokedAt: true },
      })) as { stepUpVerifiedAt: Date | null; revokedAt: Date | null } | null;
      if (!session || session.revokedAt) return false;
      const verifiedAt = session.stepUpVerifiedAt?.getTime();
      if (!verifiedAt) return false;
      return Date.now() - verifiedAt <= CRITICAL_STEP_UP_MAX_AGE_MS;
    } catch (err) {
      this.logger.error(
        `Step-up lookup failed for session ${sessionId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

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
    return this.authzMode.isStrict();
  }

  private routeLabel(ctx: ExecutionContext): string {
    const handler = ctx.getHandler()?.name ?? 'unknown';
    const klass = ctx.getClass()?.name ?? 'unknown';
    return `${klass}.${handler}`;
  }
}
