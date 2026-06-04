import type { Provider } from '@nestjs/common';

import { COURIER_GATEWAY_RESOLVER } from '../../application/ports/outbound/courier-gateway.port';

import { SelfDeliveryCourierAdapter } from '../adapters/self-delivery-courier.adapter';
import { DelhiveryCourierAdapter } from '../adapters/delhivery-courier.adapter';
import { CourierGatewayResolverImpl } from '../factories/courier-gateway.resolver';

/**
 * Concrete providers for the shipping module. The self-delivery adapter
 * registers directly (Nest resolves it from its constructor signature);
 * the resolver is bound to a symbol token so use cases inject the
 * *interface* instead of the concrete class. (iThink adapter removed.)
 */
export const shippingProviders: Provider[] = [
  SelfDeliveryCourierAdapter,
  DelhiveryCourierAdapter,
  CourierGatewayResolverImpl,
  {
    provide: COURIER_GATEWAY_RESOLVER,
    useExisting: CourierGatewayResolverImpl,
  },
];
