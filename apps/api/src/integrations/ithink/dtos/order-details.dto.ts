/**
 * Order Details — POST /api_v3/order/get_details.json
 *
 * Returns the canonical billed/unbilled state of a shipment plus
 * weight/zone/dates. Use this as the source of truth for:
 *   - Commission calculations (we charge seller `billing_*_charges`)
 *   - Detecting iThink weight reweighs (vol_weight vs billing_weight)
 *   - Promise vs expected delivery (SLA breach detection)
 *
 * AWB number list max 500 per request. Date range is mandatory even
 * when filtering by AWB list.
 */

export interface IThinkOrderDetailsRequest {
  /** Comma-separated AWB numbers. Empty string fetches all in date range. */
  awb_number_list: string;
  /** Empty string falls back to AWB list filtering. */
  order_no?: string;
  /** Format: 'YYYY-MM-DD'. */
  start_date: string;
  /** Format: 'YYYY-MM-DD'. */
  end_date: string;
}

export interface IThinkOrderDetailsProduct {
  product_name: string;
  product_sku: string;
  product_quantity: string;
  product_price: string;
  product_total?: string;
  product_tax_rate: string;
  product_hsn_code: string;
  product_discount: string;
}

/**
 * The response under `data` keys by iThink's internal order id (a numeric
 * string), NOT by the merchant `order` value. Service code must iterate
 * Object.values rather than look up by our own order id.
 */
export interface IThinkOrderDetailsRow {
  awb_no: string;
  order: string;
  sub_order: string;
  order_date: string;
  awb_created_date: string;
  total_amount: string;
  customer_name: string;
  company_name: string;
  customer_address: string;
  customer_address1: string;
  customer_address2: string;
  customer_address3: string;
  customer_pincode: string;
  customer_city: string;
  customer_state: string;
  customer_country: string;
  customer_phone: string;
  customer_email: string;
  is_billing_same_as_shipping: string;
  billing_name: string;
  billing_company_name: string;
  billing_add: string;
  billing_add1: string;
  billing_add2: string;
  billing_add3: string;
  billing_pincode: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;
  billing_phone: string;
  billing_alt_phone: string;
  billing_email: string;
  seller_email_id: string;
  products: IThinkOrderDetailsProduct[];
  shipment_length: string;
  shipment_width: string;
  shipment_height: string;
  weight: string;
  vol_weight: string;
  box_size: string;
  shipping_charges: string;
  /** Unbilled = iThink's pre-bill estimate based on declared weight. */
  unbilled_fwd_charges: number;
  unbilled_rto_charges: number;
  unbilled_cod_charges: string;
  unbilled_gst_charges: number;
  unbilled_zone: string;
  unbilled_weight: string;
  unbilled_total_charges: string;
  /** Billing = post-delivery, after iThink reweighs. May differ. */
  billing_fwd_charges: number;
  billing_rto_charges: number;
  billing_cod_charges: string;
  billing_gst_charges: number;
  billing_zone: string;
  billing_weight: string;
  billed_total_charges: string;
  remittance_amount: string;
  giftwrap_charges: string;
  transaction_charges: string;
  total_discount: string;
  first_attempt_discount: string;
  cod_charges: string;
  advance_amount: string;
  payment_mode: string;
  reseller_name: string;
  eway_bill_number: string;
  gst_number: string;
  return_address_id: string;
  pickup_address_id: string;
  ofd_count: string;
  expected_delivery_date: string;
  promise_delivery_date: string;
  logistic: string;
  last_scan_datetime: string;
  latest_courier_status: string;
}

export interface IThinkOrderDetailsResponseData {
  [iThinkOrderId: string]: IThinkOrderDetailsRow;
}
