import { Injectable } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import type {
  IThinkCheckPincodeRequest,
  IThinkCheckPincodeResponseData,
} from '../dtos/check-pincode.dto';
import type {
  IThinkGetRateRequest,
  IThinkGetRateResponse,
} from '../dtos/get-rate.dto';
import type {
  IThinkGetZoneRateRequest,
  IThinkGetZoneRateResponseData,
} from '../dtos/get-zone-rate.dto';
import {
  normalisePincode,
  normaliseRateRow,
  type PincodeCapability,
  type RateQuote,
} from '../mappers/ithink-rate.mapper';

/**
 * Serviceability + pricing endpoints. Cart and checkout use these to
 * decide whether to enable COD, what shipping cost to display, and
 * which carrier to pre-select for an Add Order call.
 */
@Injectable()
export class IThinkRatesService {
  constructor(private readonly client: IThinkClient) {}

  /**
   * Resolve which carriers can serve a pincode and with what payment
   * modes. Cart uses `cod` boolean to enable/disable the COD radio.
   *
   * The response is dominated by a few stable carriers per pincode —
   * cache aggressively (24h TTL) in Redis to avoid hammering iThink
   * with every page view.
   */
  async checkPincode(pincode: string): Promise<PincodeCapability> {
    // Phase 5.2 (2026-05-16) — input validation.
    //
    // Pre-2026-05-16 this method passed the raw `pincode` argument
    // through to iThink. A caller bug (or a hostile customer payload)
    // could send arbitrary strings; iThink would reject them but only
    // after burning a network round-trip and surfacing a noisy error
    // log. Validate here so we fail fast at the application boundary
    // and never spend an iThink call on garbage input.
    const normalized = String(pincode ?? '').trim();
    if (!/^\d{6}$/.test(normalized)) {
      throw new Error(
        `iThink checkPincode: pincode must be 6 digits (got "${pincode}")`,
      );
    }
    const body: IThinkCheckPincodeRequest = { pincode: normalized };
    const response = await this.client.post<IThinkCheckPincodeResponseData>(
      'CHECK_PINCODE',
      body as unknown as Record<string, unknown>,
    );
    const data = response.data?.[normalized];
    if (!data) {
      // iThink returns an empty/missing entry when the pincode isn't
      // serviceable by any carrier. Surface as an explicit "no carriers"
      // capability so cart can gate accordingly.
      return {
        pincode: normalized,
        prepaid: false,
        cod: false,
        pickup: false,
        carriers: [],
      };
    }
    return normalisePincode(normalized, data);
  }

  /**
   * Per-shipment rate quote for a specific route. Returns one row per
   * carrier that can serve the route — cheapest-first ordering happens
   * at the call site.
   */
  async getRate(input: {
    fromPincode: string;
    toPincode: string;
    weightKg: number;
    paymentMethod: 'Prepaid' | 'cod';
    productMrpRupees: string;
    direction?: 'forward' | 'reverse';
    dimensions?: { length: number; width: number; height: number };
  }): Promise<{ quotes: RateQuote[]; zone: string; eta: string }> {
    const body: IThinkGetRateRequest = {
      from_pincode: input.fromPincode,
      to_pincode: input.toPincode,
      shipping_length_cms: input.dimensions ? String(input.dimensions.length) : undefined,
      shipping_width_cms: input.dimensions ? String(input.dimensions.width) : undefined,
      shipping_height_cms: input.dimensions ? String(input.dimensions.height) : undefined,
      shipping_weight_kg: input.weightKg.toFixed(2),
      order_type: input.direction ?? 'forward',
      payment_method: input.paymentMethod,
      product_mrp: input.productMrpRupees,
    };
    const response = (await this.client.post<unknown>(
      'GET_RATE',
      body as unknown as Record<string, unknown>,
    )) as unknown as IThinkGetRateResponse;

    const rows = response.data ?? [];
    return {
      quotes: rows.map(normaliseRateRow),
      zone: response.zone ?? '',
      eta: response.expected_delivery_date ?? '',
    };
  }

  /**
   * Zone-slab pricing. Returns the full A-F matrix per carrier so the
   * UI can show "delivery from ₹X" without committing to a destination.
   */
  async getZoneRate(input: {
    fromPincode: string;
    weightKg: number;
    paymentMethod: 'Prepaid' | 'cod';
    productMrpRupees: string;
    serviceType?: 'Air' | 'Surface';
  }): Promise<IThinkGetZoneRateResponseData> {
    const body: IThinkGetZoneRateRequest = {
      from_pincode: input.fromPincode,
      shipping_weight_kg: input.weightKg.toFixed(2),
      order_type: 'forward',
      payment_method: input.paymentMethod,
      service_type: input.serviceType,
      product_mrp: input.productMrpRupees,
    };
    const response = await this.client.post<IThinkGetZoneRateResponseData>(
      'GET_ZONE_RATE',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? ({} as IThinkGetZoneRateResponseData);
  }
}
