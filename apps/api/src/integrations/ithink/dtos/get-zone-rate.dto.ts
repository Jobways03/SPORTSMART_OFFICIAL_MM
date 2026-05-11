/**
 * Get Zone Rate — POST /api_v3/rate/zone_rate.json
 *
 * Returns per-carrier slabs for all 6 zones (A-F) WITHOUT requiring a
 * to_pincode. Useful for cart-side "from ₹X" estimates and for
 * cataloguing shipping-cost tiers when bulk-pricing products.
 *
 * Response shape: data is keyed by carrier name, each value is a
 * zone → rate map.
 *   data['Delhivery']['A'] === "100"
 */

export interface IThinkGetZoneRateRequest {
  from_pincode: string;
  shipping_length_cms?: string;
  shipping_width_cms?: string;
  shipping_height_cms?: string;
  shipping_weight_kg: string;
  order_type?: 'forward' | 'reverse' | '';
  payment_method: 'Prepaid' | 'cod';
  service_type?: 'Air' | 'Surface' | '';
  product_mrp: string;
}

export type IThinkZoneSlabs = Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', string>;

export interface IThinkGetZoneRateResponseData {
  [carrier: string]: IThinkZoneSlabs;
}
