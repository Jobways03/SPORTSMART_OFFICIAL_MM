// Phase 38 (admin enforcement) — enforces an admin's seller-type scope on
// per-seller admin routes (`/admin/sellers/:sellerId/*`, and the seller
// delivery-method routes keyed by `:id`). Stack AFTER AdminAuthGuard, which
// populates `req.user.permissions`.
//
// For routes with no seller id in the path (the list endpoint, the
// impersonation-by-jti route) it is a deliberate no-op — the list handler
// applies the scope filter itself, and the jti route is not seller-scoped.
//
// An out-of-scope (or unknown) seller is reported as 404 — NOT 403 — so a
// D2C-scoped admin cannot even confirm that a RETAIL seller exists (and
// vice-versa). Unrestricted admins (SUPER_ADMIN, legacy unscoped roles) pass
// through untouched.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../exceptions/not-found.exception';
import {
  resolveSellerScope,
  scopeAllowsType,
  type SellerType,
} from '../authorization/seller-scope';

@Injectable()
export class AdminSellerScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const scope = resolveSellerScope(req.user?.permissions);
    if (scope.unrestricted) return true;

    // `:sellerId` on the seller controllers; `:id` on the seller
    // delivery-methods controller. Routes without either (list, jti) have no
    // single seller target → nothing to gate here.
    const sellerId: string | undefined = req.params?.sellerId ?? req.params?.id;
    if (!sellerId) return true;

    const row = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { sellerType: true } as any,
    });
    const type = (row as any)?.sellerType as SellerType | undefined;
    if (!scopeAllowsType(scope, type ?? null)) {
      throw new NotFoundAppException('Seller not found');
    }
    return true;
  }
}
