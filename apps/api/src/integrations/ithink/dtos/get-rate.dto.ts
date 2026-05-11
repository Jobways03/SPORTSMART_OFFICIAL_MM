/**
 * Get Rate — POST /api_v3/rate/check.json
 *
 * Per-shipment rate quote across all carriers serviceable for the
 * given route. Use at checkout to display shipping cost or to pick
 * the cheapest carrier for a particular SubOrder. Response is an
 * array indexed by carrier — NOT a map.
 *
 * NOTE: response uses array-with-string-keys format ("0", "1", ...)
 * which JSON.parse turns into a regular array.
 */

export interface IThinkGetRateRequest {
  from_pincode: string;
  to_pincode: string;
  shipping_length_cms?: string;
  shipping_width_cms?: string;
  shipping_height_cms?: string;
  /** kg, ≤ 10. */
  shipping_weight_kg: string;
  order_type?: 'forward' | 'reverse' | '';
  payment_method: 'Prepaid' | 'cod';
  product_mrp: string;
}

export interface IThinkGetRateCarrierRow {
  logistic_name: string;
  /** Often blank — only fedex distinguishes (standard/priority/ground). */
  logistic_service_type: string;
  prepaid: 'Y' | 'N' | string;
  cod: 'Y' | 'N' | string;
  pickup: 'Y' | 'N' | string;
  /** Whether reverse pickup is supported for this carrier on this route. */
  rev_pickup: 'Y' | 'N' | '' | string;
  rate: number;
  logistics_zone: string;
  /** Days as a string (eg. "1", "1 to 2"). */
  delivery_tat: string;
}

export interface IThinkGetRateResponse {
  status: 'success' | string;
  status_code: number;
  data: IThinkGetRateCarrierRow[];
  zone: string;
  /** Human-readable, e.g., "1 to 2 Days". */
  expected_delivery_date: string;
}
