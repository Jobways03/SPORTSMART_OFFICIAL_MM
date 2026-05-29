import { Injectable } from '@nestjs/common';
import type { DeliveryMethod } from '@prisma/client';

import {
  type CourierGatewayPort,
  type CourierGatewayResolver,
} from '../../application/ports/outbound/courier-gateway.port';

import { SelfDeliveryCourierAdapter } from '../adapters/self-delivery-courier.adapter';

/**
 * Strategy resolver: takes a SubOrder's `deliveryMethod` and returns
 * the right adapter implementation. New methods are added by:
 *   1. Adding a value to the DeliveryMethod Prisma enum,
 *   2. Implementing a CourierGatewayPort for it,
 *   3. Registering a case here.
 *
 * Use cases inject `COURIER_GATEWAY_RESOLVER` rather than individual
 * adapters so they stay carrier-agnostic. Only SELF_DELIVERY is wired
 * today (iThink removed); a future courier drops in as a new case.
 */
@Injectable()
export class CourierGatewayResolverImpl implements CourierGatewayResolver {
  constructor(private readonly selfDelivery: SelfDeliveryCourierAdapter) {}

  forMethod(method: DeliveryMethod): CourierGatewayPort {
    switch (method) {
      case 'SELF_DELIVERY':
        return this.selfDelivery;
      default: {
        // Exhaustiveness check — if a new DeliveryMethod is added to
        // the Prisma enum without a case here, TypeScript fails the
        // build instead of falling through silently at runtime.
        const _exhaustive: never = method;
        throw new Error(`Unknown DeliveryMethod: ${_exhaustive}`);
      }
    }
  }
}
