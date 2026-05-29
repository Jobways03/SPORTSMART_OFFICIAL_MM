import { Logger } from '@nestjs/common';
import { ForbiddenAppException } from '../exceptions';
import type { EnvService } from '../../bootstrap/env/env.service';

const logger = new Logger('RuntimePermissionCheck');

/**
 * Phase 134 — runtime, BODY-DEPENDENT permission check.
 *
 * Some authorization rules can't be expressed by the static `@Permissions`
 * guard because they depend on the request body, e.g.:
 *   - a dispute decision needs `disputes.decide.high_value` only when the
 *     awarded amount exceeds a threshold;
 *   - posting a dispute message needs `disputes.internalNote` only when
 *     `isInternalNote` is set.
 *
 * This helper performs that finer check at runtime while MIRRORING the
 * PermissionsGuard's strict/soak contract, so the gate rolls out exactly like
 * the route guards did:
 *   - strict (PERMISSIONS_GUARD_STRICT=true): a missing permission throws
 *     ForbiddenAppException (generic message — no permission-name leak, same
 *     as the guard).
 *   - soak (the default during rollout): the would-be denial is logged and the
 *     request is ALLOWED through, so turning the check on never hard-403s a
 *     legitimate operator mid-rollout.
 *
 * Reads the resolved permission set the AdminAuthGuard already attached to
 * `req.user.permissions` — no extra DB round-trip.
 */
export function requirePermissionOrSoak(args: {
  req: { user?: { permissions?: string[]; id?: string }; adminId?: string };
  permission: string;
  env: EnvService;
  /** Short label for the deny log line, e.g. 'dispute.decide.high_value'. */
  context: string;
}): void {
  const { req, permission, env, context } = args;
  if (req.user?.permissions?.includes(permission)) return;

  const strict = env.getBoolean('PERMISSIONS_GUARD_STRICT', false);
  const detail = {
    event: 'authz.deny.runtime',
    strict,
    permission,
    context,
    actorId: req.adminId ?? req.user?.id ?? null,
  };

  if (strict) {
    logger.warn(JSON.stringify(detail));
    throw new ForbiddenAppException('Forbidden');
  }

  logger.warn(
    JSON.stringify({
      ...detail,
      wouldHaveBeenBlocked: true,
      note: 'PERMISSIONS_GUARD_STRICT=false; allowing through during soak',
    }),
  );
}
