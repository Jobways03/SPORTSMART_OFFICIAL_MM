// Phase 38 — Seller-type guards.
//
// Gate an endpoint to D2C-only or RETAIL-only callers. Pair with one
// of the auth guards (SellerAuthGuard for seller-facing endpoints,
// AdminAuthGuard for admin endpoints), e.g.:
//
//   @UseGuards(SellerAuthGuard, D2cOnlyGuard)
//   @Post('promo-videos')
//
//   @UseGuards(AdminAuthGuard, PermissionsGuard, RetailOnlyGuard)
//   @Permissions('seller.retail.write')
//   @Patch(':id/retail-only-flag')
//
// Two resolution paths:
//
// 1. SELLER-authenticated requests (request.sellerId set by
//    SellerAuthGuard) — the guard looks up `seller.sellerType` from
//    the DB. The DB row is authoritative; a curl with a forged
//    X-Seller-Type header cannot bypass.
//
// 2. ADMIN-authenticated requests (no request.sellerId; the admin
//    apps stamp X-Seller-Type from a build-time constant on every
//    request) — the guard trusts the header. Real defence-in-depth
//    for admins is the role / permission system (seller.d2c.* vs
//    seller.retail.*); this guard just narrows wire-level routing.
//
// Unauthenticated endpoints should NOT use these guards.
//
// STATUS (MVP-1) — intentionally applied to ZERO endpoints today. The flows
// that span both seller types (disputes, returns, settlements, tax) DELIBERATELY
// share one code path: D2C and RETAIL sellers traverse the same controllers,
// gated by SellerAuthGuard + service-level ownership checks. These guards are
// retained as the ready, DB-authoritative mechanism for any future endpoint
// that is genuinely type-specific (e.g. a D2C-only promo feature). "Unused"
// here is by design — do NOT read a shared endpoint as "missing" a type guard.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';

export type SellerType = 'D2C' | 'RETAIL';

const SELLER_TYPE_HEADER = 'x-seller-type';

@Injectable()
class SellerTypeGuardBase implements CanActivate {
  constructor(
    private readonly required: SellerType,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const observed = await this.resolveSellerType(req);
    if (observed !== this.required) {
      throw new ForbiddenException(
        `This endpoint is restricted to ${this.required} sellers; observed scope was ${observed ?? 'unknown'}.`,
      );
    }
    return true;
  }

  /**
   * Prefer the DB row when a seller is authenticated. Fall back to
   * the X-Seller-Type header (stamped by the admin / seller apps'
   * api-client `defaultHeaders`) when there is no seller context —
   * i.e. when the caller is an admin or another service-bound role.
   */
  private async resolveSellerType(req: any): Promise<SellerType | null> {
    const sellerId: string | undefined = req.sellerId;
    if (sellerId) {
      const row = await this.prisma.seller.findUnique({
        where: { id: sellerId },
        select: { sellerType: true } as any,
      });
      const t = (row as any)?.sellerType as SellerType | undefined;
      if (t === 'D2C' || t === 'RETAIL') return t;
      // The seller row is missing the column (e.g. legacy row before
      // backfill). Treat as unknown — guard rejects.
      return null;
    }
    const header = req.headers?.[SELLER_TYPE_HEADER];
    const headerValue = Array.isArray(header) ? header[0] : header;
    if (headerValue === 'D2C' || headerValue === 'RETAIL') return headerValue;
    return null;
  }
}

@Injectable()
export class D2cOnlyGuard extends SellerTypeGuardBase {
  constructor(prisma: PrismaService) {
    super('D2C', prisma);
  }
}

@Injectable()
export class RetailOnlyGuard extends SellerTypeGuardBase {
  constructor(prisma: PrismaService) {
    super('RETAIL', prisma);
  }
}
