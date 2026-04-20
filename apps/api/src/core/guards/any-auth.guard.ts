import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { UnauthorizedAppException } from '../exceptions';

/**
 * AnyAuthGuard — accepts a JWT signed with any of the four actor-scoped
 * secrets (customer / seller / franchise / admin). Use sparingly, only
 * for endpoints that are genuinely cross-actor and don't need tenant
 * scoping — AI content generation is the motivating case: both admins
 * creating products and sellers editing their catalog use it.
 *
 * The per-actor guards (UserAuthGuard, SellerAuthGuard, …) remain the
 * preferred option because they also do DB-backed session / status
 * checks. AnyAuthGuard does only signature + expiry verification — it
 * is strong enough to rule out anonymous traffic but not strong enough
 * to make access-control decisions on the request's actor id.
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
    const secrets = [
      this.envService.getString('JWT_CUSTOMER_SECRET'),
      this.envService.getString('JWT_SELLER_SECRET'),
      this.envService.getString('JWT_FRANCHISE_SECRET'),
      this.envService.getString('JWT_ADMIN_SECRET'),
    ];

    for (const secret of secrets) {
      try {
        const payload = jwt.verify(token, secret) as any;
        if (payload?.sub) {
          // Attach a coarse identity so handlers can log the caller
          // without inventing an actor type. Don't use this for authz.
          request.authActorId = payload.sub;
          return true;
        }
      } catch {
        // try the next secret
      }
    }

    throw new UnauthorizedAppException('Invalid or expired token');
  }
}
