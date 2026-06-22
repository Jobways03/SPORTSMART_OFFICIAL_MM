import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Nest stores `@UseGuards(...)` classes under this metadata key on the
// handler/class (GUARDS_METADATA from @nestjs/common). APP_GUARD-registered
// guards (the throttler, this guard) are NOT recorded here, so reading it
// tells us purely whether the route declared its OWN guards.
const GUARDS_METADATA = '__guards__';

// The actor auth guards. A route carrying any of these (directly or by the
// `*AuthGuard` naming convention) is considered authenticated — the real
// guard runs after this one and does the actual token check.
const AUTH_GUARD_NAMES = new Set([
  'AdminAuthGuard',
  'SellerAuthGuard',
  'UserAuthGuard',
  'FranchiseAuthGuard',
  'FranchiseStaffAuthGuard',
  'AffiliateAuthGuard',
  'AnyAuthGuard',
]);

/**
 * Global authentication safety net (APP_GUARD).
 *
 * Closes the "forgot a `@UseGuards`" gap: a route reachable with NEITHER an
 * auth guard NOR an explicit `@Public()` is a misconfiguration. This guard
 * does NOT authenticate (the per-route auth guards still do that) — it only
 * fails CLOSED when a route declares no auth posture at all.
 *
 * Two modes, switched by GLOBAL_AUTH_GUARD_STRICT (mirrors
 * PERMISSIONS_GUARD_STRICT):
 *   - SOAK (default 'false'): allow, but log `event=authz.unguarded` once per
 *     route so ops can see exactly which endpoints need `@Public()` or a guard
 *     before flipping the switch.
 *   - STRICT ('true'): throw 401 for any unguarded, non-public route.
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
  private readonly logger = new Logger('GlobalAuthGuard');
  private readonly warned = new Set<string>();
  private readonly strict =
    String(process.env.GLOBAL_AUTH_GUARD_STRICT).toLowerCase() === 'true';

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Only HTTP routes are in scope (no RPC/WS surface here).
    if (context.getType() !== 'http') return true;

    const handler = context.getHandler();
    const cls = context.getClass();

    // 1) Explicitly public → allow.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      cls,
    ]);
    if (isPublic) return true;

    // 2) Has its own auth guard → allow (that guard enforces auth next).
    if (this.hasAuthGuard(handler) || this.hasAuthGuard(cls)) return true;

    // 3) Neither → misconfigured. Fail closed (strict) or warn (soak).
    const req = context.switchToHttp().getRequest();
    const route = `${req?.method ?? '?'} ${req?.route?.path ?? cls.name + '.' + handler.name}`;

    if (this.strict) {
      throw new UnauthorizedException(
        'Endpoint is not configured for access (no authentication guard and not marked public).',
      );
    }

    if (!this.warned.has(route)) {
      this.warned.add(route);
      this.logger.warn(
        `event=authz.unguarded route="${route}" — no auth @UseGuards and no @Public(); allowed in SOAK mode. ` +
          'Add an auth guard or @Public(), then set GLOBAL_AUTH_GUARD_STRICT=true.',
      );
    }
    return true;
  }

  private hasAuthGuard(target: object | (() => void)): boolean {
    const guards: unknown[] =
      (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
    return guards.some((g) => {
      const name =
        typeof g === 'function'
          ? g.name
          : ((g as { constructor?: { name?: string } })?.constructor?.name ??
            '');
      return !!name && (AUTH_GUARD_NAMES.has(name) || /AuthGuard$/.test(name));
    });
  }
}
