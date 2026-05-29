import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Phase 32 (2026-05-21) — typed parameter decorators that replace the
 * `(req as any).adminId` / `(req as any).sellerId` idiom scattered
 * across ~40 controllers.
 *
 * Each guard attaches its actor id to the request:
 *   - AdminAuthGuard      → req.adminId
 *   - SellerAuthGuard     → req.sellerId
 *   - FranchiseAuthGuard  → req.franchiseId
 *   - AffiliateAuthGuard  → req.affiliateId
 *   - UserAuthGuard       → req.userId  (customer)
 *
 * These decorators read the corresponding field with a real type
 * instead of `as any`. If the guard chain ever drops a populator, the
 * handler receives `undefined` instead of silently casting through —
 * TypeScript will then catch the misuse.
 *
 * Usage:
 *
 *   @Patch(':id/approve')
 *   approveProduct(@CurrentAdmin() adminId: string, @Param('id') id: string) {
 *     ...
 *   }
 *
 * Migration is incremental: existing `(req as any).adminId` callsites
 * can adopt this gradually. The Phase 32 audit noted the typing churn
 * across 40+ controllers; that migration is deferred but the surface
 * now exists.
 */

type ActorField =
  | 'adminId'
  | 'sellerId'
  | 'franchiseId'
  | 'affiliateId'
  | 'userId';

function readActor(req: Request, field: ActorField): string {
  const value = (req as Request & Record<ActorField, unknown>)[field];
  if (typeof value !== 'string' || value.length === 0) {
    // Reach here only if a route forgot its auth guard. The
    // controller's first call will surface the empty-id error
    // immediately instead of writing to the wrong actor's data.
    throw new Error(
      `${field} missing on request — route is not behind the matching auth guard.`,
    );
  }
  return value;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    readActor(ctx.switchToHttp().getRequest<Request>(), 'adminId'),
);

export const CurrentSeller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    readActor(ctx.switchToHttp().getRequest<Request>(), 'sellerId'),
);

export const CurrentFranchise = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    readActor(ctx.switchToHttp().getRequest<Request>(), 'franchiseId'),
);

export const CurrentAffiliate = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    readActor(ctx.switchToHttp().getRequest<Request>(), 'affiliateId'),
);

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    readActor(ctx.switchToHttp().getRequest<Request>(), 'userId'),
);
