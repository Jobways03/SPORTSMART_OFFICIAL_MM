import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { UnauthorizedAppException } from '../exceptions';

export type ActorType = 'CUSTOMER' | 'SELLER' | 'FRANCHISE' | 'ADMIN' | 'AFFILIATE';

/**
 * AnyAuthGuard — accepts a JWT signed with any of the five actor-scoped
 * secrets (customer / seller / franchise / admin / affiliate). Use
 * sparingly, only for endpoints that are genuinely cross-actor and
 * don't need tenant scoping — AI content generation is the motivating
 * case: both admins creating products and sellers editing their
 * catalog use it.
 *
 * The per-actor guards (UserAuthGuard, SellerAuthGuard, …) remain the
 * preferred option because they also do DB-backed session / status
 * checks. AnyAuthGuard does only signature + expiry verification — it
 * is strong enough to rule out anonymous traffic but not strong enough
 * to make access-control decisions on the request's actor id.
 *
 * PR 4.6 — added the missing affiliate secret (was a gap; affiliates
 * couldn't hit any cross-actor endpoint) and started populating
 * `request.user.type` so downstream code can disambiguate the persona
 * without re-parsing the token.
 */
@Injectable()
export class AnyAuthGuard implements CanActivate {
  constructor(private readonly envService: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedAppException('Authentication required');
    }

    const token = authHeader.slice(7);

    // Order matters only as a microopt — most traffic is customer.
    // We try every secret because there's no in-band hint of which
    // persona issued the token.
    const attempts: Array<{ type: ActorType; secret: string }> = [
      { type: 'CUSTOMER',  secret: this.envService.getString('JWT_CUSTOMER_SECRET') },
      { type: 'SELLER',    secret: this.envService.getString('JWT_SELLER_SECRET') },
      { type: 'FRANCHISE', secret: this.envService.getString('JWT_FRANCHISE_SECRET') },
      { type: 'ADMIN',     secret: this.envService.getString('JWT_ADMIN_SECRET') },
      { type: 'AFFILIATE', secret: this.envService.getString('JWT_AFFILIATE_SECRET') },
    ];

    for (const { type, secret } of attempts) {
      try {
        const payload = jwt.verify(token, secret) as any;
        if (payload?.sub) {
          // Attach a coarse identity so handlers can log the caller
          // and disambiguate persona. AnyAuthGuard intentionally does
          // NOT populate permissions / customRoles — for that, route
          // the endpoint through the persona-specific guard.
          request.authActorId = payload.sub;
          request.user = {
            id: payload.sub,
            type,
            // Roles preserved from the token if present; permissions
            // intentionally left undefined so PermissionsGuard's
            // "no decorator → open" path is the only safe pairing.
            roles: Array.isArray(payload.roles)
              ? payload.roles
              : payload.role
                ? [payload.role]
                : [],
          };
          return true;
        }
      } catch {
        // try the next secret
      }
    }

    throw new UnauthorizedAppException('Invalid or expired token');
  }
}
