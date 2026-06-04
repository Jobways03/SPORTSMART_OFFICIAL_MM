/**
 * Delhivery Heavy product-type serviceability wire shapes.
 *
 * `GET /api/dc/fetch/serviceability/pincode`
 *
 * Query params:
 *   • pincode      (required, int)
 *   • product_type (required, pass "Heavy")
 *
 * Distinct endpoint from the regular B2C serviceability check. The
 * response body surfaces "NSZ" when the pincode is non-serviceable
 * for heavy products. Otherwise it returns the serviceable zone
 * breakdown.
 */

export interface DelhiveryHeavyServiceabilityRequest {
  /** 6-digit Indian pincode as integer. */
  pincode: number;
  /** Always "Heavy" for this endpoint. */
  product_type: 'Heavy';
}

export interface DelhiveryHeavyServiceabilityResponse {
  /** "NSZ" => non-serviceable; otherwise serviceable code. */
  status?: string;
  pincode?: string | number;
  product_type?: string;
  /** Zone / sub-zone / route info when serviceable. */
  zone?: string;
  remarks?: string | string[];
}
