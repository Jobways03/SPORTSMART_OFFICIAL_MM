// Phase E (P1.2) — Discount stacking service.
//
// Thin wrapper around the pure stacking engine. Responsibilities:
//   1. Resolve a Discount row + source into the StackableDiscount
//      shape the engine expects.
//   2. Evaluate compatibility of a candidate against the cart's
//      already-applied discounts.
//   3. Surface the customer-friendly rejection reason for the
//      caller (checkout / customer coupon validation) to throw.
//
// The customer-side checkout flow today supports only one coupon at
// a time (`couponCode` on the session). When multi-coupon support
// lands in P2 customer UI, this service is the integration point —
// the new "applyAdditionalCoupon" handler reads existing applied
// codes from the session and calls `evaluate` here before adding
// the candidate.

import { Injectable } from '@nestjs/common';
import { canStack } from '../../domain/stacking/can-stack';
import type {
  StackableDiscount,
  StackingDecision,
} from '../../domain/stacking/types';

@Injectable()
export class DiscountStackingService {
  /**
   * Evaluate whether a candidate discount can be added to a cart
   * already carrying `applied` discounts. Pure pass-through to the
   * engine; service exists only so the engine can be injected via
   * NestJS DI.
   */
  evaluate(
    applied: ReadonlyArray<StackableDiscount>,
    candidate: StackableDiscount,
  ): StackingDecision {
    return canStack(applied, candidate);
  }

  /**
   * Convenience: turn a raw Discount row + source into the
   * StackableDiscount shape. Caller maps from Prisma's Discount /
   * affiliate-coupon shape and feeds the result into `evaluate`.
   */
  toStackable(
    row: {
      id: string;
      type: string;
      method: string;
      combineProduct: boolean;
      combineOrder: boolean;
      combineShipping: boolean;
    },
    source: 'CODE' | 'AUTOMATIC' | 'AFFILIATE',
  ): StackableDiscount {
    return {
      id: row.id,
      type: row.type as StackableDiscount['type'],
      method: row.method as StackableDiscount['method'],
      source,
      combineProduct: row.combineProduct,
      combineOrder: row.combineOrder,
      combineShipping: row.combineShipping,
    };
  }
}
