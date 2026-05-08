import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenAppException } from '../exceptions';
import {
  POLICY_METADATA,
  type PolicyDescriptor,
} from '../decorators/policy.decorator';
import {
  PolicyEvaluatorService,
  type PolicyActor,
} from '../authorization/policy-evaluator.service';
import { AuthorizationAuditService } from '../authorization/authorization-audit.service';

/**
 * Phase 4 (PR 4.3) — ABAC PolicyGuard. Layered AFTER PermissionsGuard.
 *
 * Reads @Policy(...) metadata, builds the request context from the
 * descriptor's `context` map, evaluates ResourcePolicy rows via
 * PolicyEvaluatorService, and:
 *   - DENY  → ForbiddenAppException (always)
 *   - ALLOW with matched=true  → request proceeds
 *   - ALLOW with matched=false → request proceeds (soak); logs WARN
 *
 * In strict mode (ABAC_ENABLED=true) the evaluator already returns
 * DENY on no-match, so there's no extra branch to handle here.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly logger = new Logger(PolicyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly evaluator: PolicyEvaluatorService,
    private readonly audit: AuthorizationAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const descriptor = this.reflector.getAllAndOverride<PolicyDescriptor>(
      POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!descriptor) return true;

    const req = context.switchToHttp().getRequest();
    const actor = this.buildActor(req);
    if (!actor) {
      // No actor → deny, regardless of mode. PermissionsGuard would
      // normally catch this earlier; defensive double-check.
      throw new ForbiddenAppException(
        'Authentication required for policy-gated route',
      );
    }

    const ctx = this.buildContext(descriptor, req);
    const decision = await this.evaluator.evaluate({
      actor,
      resourceType: descriptor.resourceType,
      action: descriptor.action,
      context: ctx,
    });

    const routeLabel = this.routeLabel(context);
    const baseAudit = {
      layer: 'POLICY' as const,
      routeLabel,
      adminId: actor.adminId,
      actorRole: actor.role,
      actorRoles: [actor.role],
      method: req.method,
      path: req.originalUrl ?? req.url,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
      requestId: req.id ?? req.requestId ?? null,
      resourceType: descriptor.resourceType,
      action: descriptor.action,
      matchedPolicyId: decision.matchedPolicyId ?? null,
      matchedPolicyName: decision.matchedPolicyName ?? null,
      context: ctx,
      reason: decision.reason,
    };

    if (decision.decision === 'DENY') {
      this.logger.warn(
        JSON.stringify({
          event: 'abac.deny',
          route: routeLabel,
          resourceType: descriptor.resourceType,
          action: descriptor.action,
          actorId: actor.adminId,
          actorRole: actor.role,
          matchedPolicyId: decision.matchedPolicyId ?? null,
          matchedPolicyName: decision.matchedPolicyName ?? null,
          reason: decision.reason,
        }),
      );
      this.audit.record({
        ...baseAudit,
        decision: 'DENY',
        wouldHaveBlocked: false,
      });
      throw new ForbiddenAppException(decision.reason);
    }

    if (!decision.matched) {
      this.logger.warn(
        JSON.stringify({
          event: 'abac.allow.no-match',
          route: routeLabel,
          resourceType: descriptor.resourceType,
          action: descriptor.action,
          actorId: actor.adminId,
          actorRole: actor.role,
          strict: this.evaluator.isStrict(),
          reason: decision.reason,
        }),
      );
    }
    this.audit.record({
      ...baseAudit,
      decision: 'ALLOW',
      // In soak mode (ABAC_ENABLED=false) a no-match would be a deny
      // under strict semantics. Surface that for the audit reader.
      wouldHaveBlocked: !decision.matched && !this.evaluator.isStrict(),
    });
    return true;
  }

  private buildActor(req: any): PolicyActor | null {
    const adminId = req.adminId ?? req.user?.id ?? null;
    if (!adminId) return null;
    return {
      adminId,
      role: req.adminRole ?? req.user?.role ?? '',
      customRoles: req.user?.customRoles ?? [],
      permissions: req.user?.permissions ?? [],
    };
  }

  private buildContext(
    descriptor: PolicyDescriptor,
    req: any,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!descriptor.context) return out;

    for (const [key, source] of Object.entries(descriptor.context)) {
      const [bucket, ...pathParts] = source.split('.');
      const path = pathParts.join('.');
      const root = req[bucket as keyof typeof req];
      out[key] = readPath(root, path);
    }
    return out;
  }

  private routeLabel(ctx: ExecutionContext): string {
    const handler = ctx.getHandler()?.name ?? 'unknown';
    const klass = ctx.getClass()?.name ?? 'unknown';
    return `${klass}.${handler}`;
  }
}

function readPath(root: unknown, path: string): unknown {
  if (root == null || path === '') return root;
  const segs = path.split('.');
  let cur: any = root;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}
