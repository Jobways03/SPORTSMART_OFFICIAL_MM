import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CourierGatewayPort,
  CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';
import { DelhiveryCourierAdapter } from '../../../../integrations/delhivery/adapters/delhivery-courier.adapter';
import { ShadowfaxCourierAdapter } from '../../../../integrations/shadowfax/adapters/shadowfax-courier.adapter';

/**
 * Strategy registry that maps a `PartnerCode` to the concrete
 * `CourierGatewayPort` implementation. Constructor-injects every
 * adapter so the module graph is the single source of truth for
 * "which partners are wired in" — no on-init hooks, no manual
 * `register()` plumbing.
 *
 * Adding a new partner is now a four-line patch:
 *   1. Add a constructor parameter for the new adapter.
 *   2. Add a `case` to the `forPartner` switch.
 *   3. Add the adapter to the `all()` array.
 *   4. Import the new integration module in `shipments.module.ts`.
 *
 * Pattern mirrors apps/api/src/modules/shipping/infrastructure/factories/courier-gateway.resolver.ts.
 */
@Injectable()
export class DefaultCourierGatewayResolver implements CourierGatewayResolver {
  constructor(
    private readonly delhivery: DelhiveryCourierAdapter,
    private readonly shadowfax: ShadowfaxCourierAdapter,
  ) {}

  forPartner(partner: string): CourierGatewayPort {
    switch (partner) {
      case this.delhivery.meta.partner:
        return this.delhivery;
      case this.shadowfax.meta.partner:
        return this.shadowfax;
      default:
        throw new NotFoundException(
          `No partner adapter registered for code '${partner}'. ` +
            `Known partners: ${this.all()
              .map((a) => a.meta.partner)
              .join(', ')}. ` +
            `Add a new code via the three-step playbook in ` +
            `packages/logistics-contracts/src/partner.ts.`,
        );
    }
  }

  all(): CourierGatewayPort[] {
    return [this.delhivery, this.shadowfax];
  }
}
