/**
 * Shadowfax serviceability wire shapes. Two endpoints, distinct
 * request bodies; the response shape is unified.
 *
 *   • Intracity: `POST /api/v1/intracity/serviceability`
 *   • Express:   `POST /api/v1/express/serviceability`
 */

export interface ShadowfaxIntracityServiceabilityRequest {
  pickup_pincode: string;
  drop_pincode: string;
}

export interface ShadowfaxExpressServiceabilityRequest {
  pickup_pincode: string;
  drop_pincode: string;
  weight_grams?: number;
  /** "PREPAID" | "COD" — affects whether COD eligibility is checked. */
  payment_mode?: 'PREPAID' | 'COD';
}

export interface ShadowfaxServiceabilityResponse {
  serviceable: boolean;
  /** True when prepaid forward delivery is available. */
  prepaid_available: boolean;
  /** True when COD collection is available. */
  cod_available: boolean;
  /** True when reverse pickup is available. */
  reverse_available: boolean;
  /** Estimated TAT in days; null when Shadowfax cannot commit. */
  estimated_delivery_days?: number | null;
  /** Quote in INR (decimal string); null when no live quote returned. */
  quoted_price?: string | null;
  /** Zone label e.g. "WITHIN_CITY" / "REGIONAL" / "NATIONAL". */
  zone?: string;
}
