// Phase 38 (admin enforcement — breadth pass) — seller-type scope guards for
// admin routes keyed by an ORDER / SUB-ORDER / RETURN / PRODUCT id (rather than
// a seller id). Each resolves the seller type(s) the targeted entity belongs to
// and rejects (404) when none are in the admin's scope. Stack AFTER
// AdminAuthGuard (which populates req.user.permissions).
//
// Multi-seller note: a MasterOrder spans sub-orders that may belong to
// different sellers/types, so the order-level check allows the order if AT LEAST
// ONE sub-order is in scope (mixed-cart orders are necessarily visible to both
// teams — they can't be cleanly partitioned). Sub-orders, returns and products
// are single-seller and check exactly.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../exceptions/not-found.exception';
import {
  resolveSellerScope,
  scopeAllowsType,
  type SellerType,
} from '../authorization/seller-scope';

/**
 * Base class: resolves scope, then delegates entity → seller-type resolution to
 * the subclass. `resolveTypes` returns:
 *   - `null`        → no single target on this route (list / non-id route) → allow,
 *   - `'not_found'` → the id didn't resolve → 404,
 *   - `SellerType[]`→ the entity's seller type(s); allowed iff ≥1 is in scope.
 */
@Injectable()
abstract class EntitySellerScopeGuardBase implements CanActivate {
  constructor(protected readonly prisma: PrismaService) {}

  protected abstract resolveTypes(
    req: any,
  ): Promise<SellerType[] | null | 'not_found'>;

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const scope = resolveSellerScope(req.user?.permissions);
    if (scope.unrestricted) return true;

    const types = await this.resolveTypes(req);
    if (types === null) return true; // list / non-entity route — handler self-scopes
    if (types === 'not_found' || !types.some((t) => scopeAllowsType(scope, t))) {
      throw new NotFoundAppException('Resource not found');
    }
    return true;
  }
}

@Injectable()
export class AdminReturnSellerScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.returnId;
    if (!id) return null;
    const row = await this.prisma.return.findUnique({
      where: { id },
      select: {
        subOrder: { select: { seller: { select: { sellerType: true } } } },
      } as any,
    });
    if (!row) return 'not_found' as const;
    const t = (row as any)?.subOrder?.seller?.sellerType as
      | SellerType
      | undefined;
    return t ? [t] : []; // a return with no resolvable seller → out of every scope
  }
}

@Injectable()
export class AdminProductSellerScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.productId;
    if (!id) return null;
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: { seller: { select: { sellerType: true } } } as any,
    });
    if (!row) return 'not_found' as const;
    // Scope by the OWNING seller. Platform-owned products (no owner) have no
    // type → out of scope for a scoped admin (they remain visible to unrestricted
    // admins / SUPER_ADMIN).
    const t = (row as any)?.seller?.sellerType as SellerType | undefined;
    return t ? [t] : [];
  }
}

@Injectable()
export class AdminOrderSellerScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    // The admin-orders controller mixes order-level (`:id`) and sub-order-level
    // (`sub-orders/:id` | `:subOrderId`) routes. Disambiguate by the path/param.
    const haystack = `${req.route?.path ?? ''} ${req.originalUrl ?? ''}`;
    const isSubOrder = !!req.params?.subOrderId || haystack.includes('sub-orders');

    if (isSubOrder) {
      const id: string | undefined = req.params?.subOrderId ?? req.params?.id;
      if (!id) return null;
      const row = await this.prisma.subOrder.findUnique({
        where: { id },
        select: { seller: { select: { sellerType: true } } } as any,
      });
      if (!row) return 'not_found' as const;
      const t = (row as any)?.seller?.sellerType as SellerType | undefined;
      return t ? [t] : [];
    }

    const id: string | undefined = req.params?.id;
    if (!id) return null; // list / non-id order route
    const row = await this.prisma.masterOrder.findUnique({
      where: { id },
      select: {
        subOrders: { select: { seller: { select: { sellerType: true } } } },
      } as any,
    });
    if (!row) return 'not_found' as const;
    // ≥1 in-scope sub-order ⇒ visible (base uses .some over the returned types).
    return ((row as any)?.subOrders ?? [])
      .map((so: any) => so?.seller?.sellerType)
      .filter(Boolean) as SellerType[];
  }
}
