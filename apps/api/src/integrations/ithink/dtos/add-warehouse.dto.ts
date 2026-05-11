/**
 * Add Warehouse — POST /api_v3/warehouse/add.json
 *
 * Registers a pickup address with iThink. Approval is asynchronous —
 * the response returns immediately with `status: pending`; iThink ops
 * approves within 24h. The returned `warehouse_id` becomes the
 * `pickup_address_id` used on every subsequent Add Order call for
 * this seller / franchise.
 *
 * country_id 101 = India. state_id / city_id come from Get State /
 * Get City for the relevant country.
 */

export interface IThinkAddWarehouseRequest {
  company_name: string;
  /** Apartment / wing / building. */
  address1: string;
  address2?: string;
  mobile: string;
  pincode: string;
  city_id: string;
  state_id: string;
  /** 101 for India. */
  country_id: string;
  /** Lat,long string. Optional. */
  gps?: string;
}

/**
 * Note: warehouse_id is at the envelope's top level, NOT inside `data`.
 * status is the approval state — 'pending' initially, flips to
 * 'approved' once iThink ops sign off.
 */
export interface IThinkAddWarehouseResponse {
  status: 'success' | string;
  status_code: number;
  html_message: string;
  warehouse_id: number;
}
