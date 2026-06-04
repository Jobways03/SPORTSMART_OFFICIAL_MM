import { Injectable, Logger } from '@nestjs/common';
import type { ResourcePolicy } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { AuthzModeService } from './authz-mode.service';
import { matchesConditions, type Conditions } from './policy-condition.matcher';

export interface PolicyActor {
  adminId: string;
  role: string;            // AdminRole enum value (SUPER_ADMIN / SELLER_ADMIN / …)
  customRoles?: string[];  // AdminCustomRole.name list (optional)
  permissions: string[];   // permission keys granted to this actor
}

export interface PolicyEvaluationInput {
  actor: PolicyActor;
  resourceType: string;
  action: string;
  context: Record<string, unknown>;
}

export type PolicyDecisionKind = 'ALLOW' | 'DENY';

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  /** True when ABAC was active and a matching rule fired. */
  matched: boolean;
  matchedPolicyId?: string;
  matchedPolicyName?: string;
  reason: string;
}

/**
 * ABAC evaluator. Reads ResourcePolicy rows for the given resourceType
 * + action, filters to those whose principal selector matches the
 * actor, evaluates conditions in priority order (descending), and
 * returns the first match.
 *
 * Default semantics depend on ABAC_ENABLED:
 *
 *   ABAC_ENABLED=false  (default — soak)
 *     - DENY hits still throw (sharp tools always armed).
 *     - No matching ALLOW → decision=ALLOW with matched=false. The guard
 *       lets the request through and a log line shows what *would*
 *       have happened in strict mode.
 *
 *   ABAC_ENABLED=true   (strict)
 *     - DENY hits throw.
 *     - No matching ALLOW + the route had @Policy → decision=DENY with
 *       matched=false. Routes without @Policy are unaffected.
 *
 * Caching: list of policies for a (resourceType, action) is cached in
 * memory for 60s. Admins editing policies via the UI should call
 * invalidate() (wired into the admin controller) — until then they
 * wait at most one minute for the new rule to take effect.
 */
@Injectable()
export class PolicyEvaluatorService {
  private readonly logger = new Logger('PolicyEvaluator');
  private readonly cache = new Map<string, { rows: ResourcePolicy[]; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly authzMode: AuthzModeService,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  isStrict(): boolean {
    // Effective ABAC flag (env OR tighten-only runtime override).
    return this.authzMode.isAbacEnabled();
  }

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    const policies = await this.loadPolicies(input.resourceType, input.action);

    // Filter by principal selector + sort by priority desc.
    const candidates = policies
      .filter((p) => this.matchesPrincipal(p, input.actor))
      .sort((a, b) => b.priority - a.priority);

    for (const p of candidates) {
      const conds = (p.conditions ?? null) as Conditions | null;
      if (matchesConditions(conds, input.context)) {
        return {
          decision: p.effect === 'DENY' ? 'DENY' : 'ALLOW',
          matched: true,
          matchedPolicyId: p.id,
          matchedPolicyName: p.name,
          reason:
            p.effect === 'DENY'
              ? `Denied by policy "${p.name}"`
              : `Allowed by policy "${p.name}"`,
        };
      }
    }

    // No match. Behavior depends on strict mode.
    if (this.isStrict()) {
      return {
        decision: 'DENY',
        matched: false,
        reason: `ABAC strict: no policy granted ${input.resourceType}.${input.action}`,
      };
    }
    return {
      decision: 'ALLOW',
      matched: false,
      reason: `ABAC soak: no matching policy — would-have-been-denied in strict mode`,
    };
  }

  private async loadPolicies(
    resourceType: string,
    action: string,
  ): Promise<ResourcePolicy[]> {
    const key = `${resourceType}::${action}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.rows;

    const rows = await this.prisma.resourcePolicy.findMany({
      where: { resourceType, action, enabled: true },
    });
    this.cache.set(key, { rows, expiresAt: now + this.CACHE_TTL_MS });
    return rows;
  }

  private matchesPrincipal(p: ResourcePolicy, actor: PolicyActor): boolean {
    switch (p.principalType) {
      case 'ANY':
        return true;
      case 'ROLE':
        return p.principalKey === '*' || p.principalKey === actor.role;
      case 'PERMISSION':
        return (
          p.principalKey === '*' || actor.permissions.includes(p.principalKey)
        );
      case 'CUSTOM_ROLE':
        return (
          p.principalKey === '*' ||
          (actor.customRoles ?? []).includes(p.principalKey)
        );
      default:
        // Unknown principal type → fail closed for that policy row.
        this.logger.warn(
          `Unknown principalType ${p.principalType} on policy ${p.id}; skipping`,
        );
        return false;
    }
  }
}
