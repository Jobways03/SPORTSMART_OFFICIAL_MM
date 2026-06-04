/**
 * Shadowfax rate-quote wire shapes. Folded into the serviceability
 * response on the Shadowfax side — the dedicated rate call is only
 * needed for the express line when a heavy / oversized shipment
 * needs a separate quote.
 *
 * Source: `POST /api/v1/express/rate`.
 */

export interface ShadowfaxRateRequest {
  pickup_pincode: string;
  drop_pincode: string;
  weight_grams: number;
  dimensions?: {
    length_cm: number;
    width_cm: number;
    height_cm: number;
  };
  payment_mode: 'PREPAID' | 'COD';
  cod_amount?: string;
  declared_value: string;
}

export interface ShadowfaxRateResponse {
  /** INR, decimal string with two places. */
  total_price: string;
  /** Estimated TAT in days. */
  estimated_delivery_days: number;
  /** Zone label e.g. "REGIONAL" / "NATIONAL". */
  zone: string;
  /** Per-charge breakdown. */
  breakdown?: {
    base_charge?: string;
    cod_charge?: string;
    fuel_surcharge?: string;
    gst?: string;
  };
}
