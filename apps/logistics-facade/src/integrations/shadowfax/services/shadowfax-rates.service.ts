import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';
import type { ServiceabilityCheckResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import type { ShadowfaxProductLine } from '../shadowfax.constants';

/**
 * Serviceability + rate surface. Shadowfax exposes serviceability
 * checks on both product lines — the adapter calls both and merges
 * the result so the storefront sees a single "can-deliver" answer
 * irrespective of product line.
 */
@Injectable()
export class ShadowfaxRatesService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Check serviceability on a specific product line.
   *
   * TODO (M1): Implement
   *   • For INTRACITY: POST to
   *     `SHADOWFAX_PATHS.INTRACITY_SERVICEABILITY` with
   *     `{ pickup_pincode, drop_pincode }`.
   *     Reference: https://docs.shadowfax.in/api/intracity/serviceability
   *   • For EXPRESS: POST to
   *     `SHADOWFAX_PATHS.EXPRESS_SERVICEABILITY` with the optional
   *     weight + payment_mode fields.
   *     Reference: https://docs.shadowfax.in/api/express/serviceability
   *   • Map `quoted_price` (INR string) -> bigint paise.
   */
  async checkServiceability(
    _input: {
      pickupPincode: string;
      dropPincode: string;
      productLine: ShadowfaxProductLine;
      weightGrams?: number;
      cod?: boolean;
    },
  ): Promise<ServiceabilityCheckResult> {
    void this.client;
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxRatesService.checkServiceability is a scaffold. ` +
        `Endpoints: POST /api/v1/intracity/serviceability, ` +
        `POST /api/v1/express/serviceability — ` +
        `references https://docs.shadowfax.in/api/intracity/serviceability, ` +
        `https://docs.shadowfax.in/api/express/serviceability`,
    );
  }

  /**
   * Express-only live rate quote. Intracity prices are slot-based
   * and surfaced inline on the serviceability call.
   *
   * TODO (M1): Implement
   *   • POST to `/api/v1/express/rate`.
   *   • Reference: https://docs.shadowfax.in/api/express/rate
   */
  async getExpressRate(_input: {
    pickupPincode: string;
    dropPincode: string;
    weightGrams: number;
    cod: boolean;
    codAmountPaise?: bigint;
  }): Promise<{ pricePaise: bigint; etaDays: number }> {
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxRatesService.getExpressRate is a scaffold. ` +
        `Endpoint: POST /api/v1/express/rate — ` +
        `reference https://docs.shadowfax.in/api/express/rate`,
    );
  }
}
