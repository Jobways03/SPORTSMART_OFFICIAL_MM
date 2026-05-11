import type { Provider } from '@nestjs/common';

import { COURIER_GATEWAY_RESOLVER } from '../../application/ports/outbound/courier-gateway.port';

import { IThinkCourierAdapter } from '../adapters/ithink-courier.adapter';
import { SelfDeliveryCourierAdapter } from '../adapters/self-delivery-courier.adapter';
import { CourierGatewayResolverImpl } from '../factories/courier-gateway.resolver';

/**
 * Concrete providers for the shipping module. Two adapter classes
 * register themselves directly (Nest resolves them from their
 * constructor signatures); the resolver is bound to a symbol token
 * so use cases inject the *interface* instead of the concrete class.
 */
export const shippingProviders: Provider[] = [
  IThinkCourierAdapter,
  SelfDeliveryCourierAdapter,
  CourierGatewayResolverImpl,
  {
    provide: COURIER_GATEWAY_RESOLVER,
    useExisting: CourierGatewayResolverImpl,
  },
];
