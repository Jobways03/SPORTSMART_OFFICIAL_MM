import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { JWT_VERIFY_OPTIONS } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
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

    // Follow-up #H40 — accept token from Bearer OR any of the five
    // persona httpOnly cookies. When a Bearer header is present it
    // wins (one persona); otherwise we try each cookie in order so
    // a browser logged in as multiple personas resolves the request
    // to whichever persona's cookie verifies first.
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7) || undefined
        : undefined;

    type AttemptKey = { type: ActorType; secret: string; token: string };
    const personaSecrets: Array<{
      type: ActorType;
      persona: Parameters<typeof readAccessCookie>[1];
      secret: string;
    }> = [
      { type: 'CUSTOMER',  persona: 'customer',  secret: this.envService.getString('JWT_CUSTOMER_SECRET') },
      { type: 'SELLER',    persona: 'seller',    secret: this.envService.getString('JWT_SELLER_SECRET') },
      { type: 'FRANCHISE', persona: 'franchise', secret: this.envService.getString('JWT_FRANCHISE_SECRET') },
      { type: 'ADMIN',     persona: 'admin',     secret: this.envService.getString('JWT_ADMIN_SECRET') },
      { type: 'AFFILIATE', persona: 'affiliate', secret: this.envService.getString('JWT_AFFILIATE_SECRET') },
    ];

    const attempts: AttemptKey[] = [];
    if (bearer) {
      // Bearer present: try it against every persona secret.
      for (const p of personaSecrets) {
        attempts.push({ type: p.type, secret: p.secret, token: bearer });
      }
    } else {
      // No Bearer: try the persona-scoped cookie for each persona.
      for (const p of personaSecrets) {
        const cookieToken = readAccessCookie(request, p.persona);
        if (cookieToken) {
          attempts.push({ type: p.type, secret: p.secret, token: cookieToken });
        }
      }
    }

    if (attempts.length === 0) {
      throw new UnauthorizedAppException('Authentication required');
    }

    for (const { type, secret, token } of attempts) {
      try {
        const payload = jwt.verify(token, secret, JWT_VERIFY_OPTIONS) as any;
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
