import type { IThinkAddOrderProduct } from './add-order.dto';

/**
 * Sync Order — POST /api_v3/order/sync.json
 *
 * Pushes order data into iThink WITHOUT booking a courier (no AWB
 * is generated). Used when you want iThink to know about an order
 * before deciding to ship — e.g., orders held pending verification.
 *
 * Max 25 shipments per request. Same field quirks as Add Order:
 *   - `add`, `add2`, `add3` for address lines
 *   - `pin` for pincode
 *   - `first_attemp_discount` typo retained verbatim
 */

export interface IThinkSyncOrderShipment {
  order: string;
  sub_order?: string;
  order_date: string;
  total_amount: string;
  name: string;
  company_name?: string;
  add: string;
  add2?: string;
  add3?: string;
  pin: string;
  city?: string;
  state?: string;
  country?: string;
  phone: string;
  alt_phone?: string;
  email?: string;
  is_billing_same_as_shipping?: string;
  billing_name?: string;
  billing_company_name?: string;
  billing_add?: string;
  billing_add2?: string;
  billing_add3?: string;
  billing_pin?: string;
  billing_city?: string;
  billing_state?: string;
  billing_country?: string;
  billing_phone?: string;
  billing_alt_phone?: string;
  billing_email?: string;
  products: IThinkAddOrderProduct[];
  shipment_length: string;
  shipment_width: string;
  shipment_height: string;
  weight: string;
  shipping_charges?: string;
  giftwrap_charges?: string;
  transaction_charges?: string;
  total_discount?: string;
  first_attemp_discount?: string;
  cod_charges?: string;
  advance_amount?: string;
  cod_amount?: string;
  /** Reverse sync orders must use Prepaid only. */
  payment_mode?: 'cod' | 'Prepaid';
  reseller_name?: string;
  eway_bill_number?: string;
  gst_number?: string;
}

export interface IThinkSyncOrderRequest {
  shipments: IThinkSyncOrderShipment[];
}

export interface IThinkSyncOrderResultRow {
  status: 'Success' | 'Failed' | string;
  remark: string;
  refnum: string;
}

export interface IThinkSyncOrderResponseData {
  [shipmentIndex: string]: IThinkSyncOrderResultRow;
}
