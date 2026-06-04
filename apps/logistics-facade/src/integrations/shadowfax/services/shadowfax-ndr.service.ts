import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';
import type { NdrActionResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import { CarrierCapabilityError } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  SHADOWFAX_DISPLAY_NAME,
} from '../shadowfax.constants';

/**
 * NDR action surface — reattempt only. Shadowfax does NOT currently
 * expose a programmatic RTO-initiate endpoint, so `initiateRto`
 * surfaces a `CarrierCapabilityError` (see adapter docstring).
 */
@Injectable()
export class ShadowfaxNdrService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Reattempt delivery on an NDR'd Shadowfax order.
   *
   * TODO (M1): Implement
   *   • POST to `${SHADOWFAX_PATHS.NDR_REATTEMPT}/${orderId}/reattempt`.
   *   • Body: `ShadowfaxReattemptRequest` shape with `reattempt_date`,
   *     optional address block + phone + address_type.
   *   • Treat `success: true` as success.
   *   • Reference: https://docs.shadowfax.in/api/ndr-actions
   *
   * NOTE: The carrier-neutral port keys by AWB; Shadowfax keys by
   * `order_id`. The adapter does the AWB -> order_id lookup before
   * calling this service.
   */
  async reattempt(_input: {
    orderId: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    void this.client;
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxNdrService.reattempt is a scaffold. ` +
        `Endpoint: POST /api/v1/orders/{id}/reattempt — ` +
        `reference https://docs.shadowfax.in/api/ndr-actions`,
    );
  }

  /**
   * RTO initiate. Shadowfax does NOT expose this programmatically as
   * of M1 planning — ops triggers RTO from the Shadowfax dashboard
   * after N undelivered attempts. The adapter surfaces this via the
   * carrier-neutral `CarrierCapabilityError` so the caller can fall
   * back gracefully.
   */
  initiateRto(_input: { awb: string; remark: string }): never {
    throw new CarrierCapabilityError(SHADOWFAX_DISPLAY_NAME, 'initiateRto');
  }
}
