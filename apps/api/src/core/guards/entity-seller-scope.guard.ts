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

/**
 * Isolation fix (2026-06-16) — routes keyed directly by a SELLER id
 * (`:sellerId`), e.g. the accounts/commission/settlement per-seller drill-downs.
 * Resolves the seller's own type and rejects (404) when it isn't in the admin's
 * scope, so a D2C_ADMIN can't pull a specific RETAIL seller's financial bundle
 * (and vice versa). Unrestricted admins (SUPER_ADMIN, and the cross-domain
 * FRANCHISE_ADMIN) pass — the D2C/RETAIL axis is the only one this guard speaks.
 */
@Injectable()
export class AdminSellerIdScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.sellerId;
    if (!id) return null; // non-seller route — handler self-scopes
    const row = await this.prisma.seller.findUnique({
      where: { id },
      select: { sellerType: true } as any,
    });
    if (!row) return 'not_found' as const;
    const t = (row as any)?.sellerType as SellerType | undefined;
    return t ? [t] : [];
  }
}

/**
 * Isolation fix (2026-06-16) — routes keyed by a SELLER-SETTLEMENT id
 * (`:settlementId`), e.g. the per-settlement commission-invoice / statement /
 * adjustments reads. Resolves the owning seller's type; cross-type → 404.
 */
@Injectable()
export class AdminSettlementSellerScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.settlementId;
    if (!id) return null;
    const row = await this.prisma.sellerSettlement.findUnique({
      where: { id },
      select: { seller: { select: { sellerType: true } } } as any,
    });
    if (!row) return 'not_found' as const;
    const t = (row as any)?.seller?.sellerType as SellerType | undefined;
    return t ? [t] : [];
  }
}

/**
 * Isolation fix (2026-06-16) — routes keyed by a COMMISSION-RECORD id (`:id`),
 * e.g. the per-record history timeline (which exposes dispute-resolution notes).
 * Resolves the owning seller's type; cross-type → 404.
 */
@Injectable()
export class AdminCommissionRecordScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.id;
    if (!id) return null;
    const row = await this.prisma.commissionRecord.findUnique({
      where: { id },
      select: { seller: { select: { sellerType: true } } } as any,
    });
    if (!row) return 'not_found' as const;
    const t = (row as any)?.seller?.sellerType as SellerType | undefined;
    return t ? [t] : [];
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
export class AdminMappingSellerScopeGuard extends EntitySellerScopeGuardBase {
  protected async resolveTypes(req: any) {
    const id: string | undefined = req.params?.mappingId;
    if (!id) return null; // list / bulk / non-mapping route — handler self-scopes
    const row = await this.prisma.sellerProductMapping.findUnique({
      where: { id },
      select: { seller: { select: { sellerType: true } } } as any,
    });
    if (!row) return 'not_found' as const;
    // A mapping always has exactly one owning seller (single-seller, unlike a
    // mixed-cart order), so scope by that seller's type exactly.
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
