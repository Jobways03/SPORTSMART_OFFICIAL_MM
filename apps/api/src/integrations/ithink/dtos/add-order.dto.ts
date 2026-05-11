import type {
  IThinkForwardLogistics,
  IThinkOrderType,
  IThinkPaymentMode,
  IThinkReverseLogistics,
} from '../ithink.constants';

/**
 * Add Order — POST /api_v3/order/add.json
 *
 * Books a shipment with iThink and returns an AWB. Up to 10 shipments
 * and 40 products per shipment per call (cap enforced by the service
 * layer, not the DTO).
 *
 * Notes on quirks:
 *  - Addresses use `add`, `add2`, `add3` (NOT `address`).
 *  - Pincode is `pin` (NOT `pincode`).
 *  - `first_attemp_discount` is misspelt in the API; mirror it verbatim.
 *  - `weight` is in kilograms despite the doc example showing "400"
 *    with comment `#in Kg` (likely a doc bug — Sync Order example
 *    uses "0.5" for the same unit). Confirmed with iThink ops.
 *  - `payment_mode` casing: `cod` lowercase, `Prepaid` title-case.
 *  - For reverse shipments: payment_mode must be 'Prepaid' and logistics
 *    must be one of ITHINK_REVERSE_LOGISTICS.
 */

export interface IThinkAddOrderProduct {
  product_name: string;
  product_sku?: string;
  product_quantity: string;
  product_price: string;
  product_tax_rate?: string;
  product_hsn_code?: string;
  product_discount?: string;
  product_img_url?: string;
}

export interface IThinkAddOrderShipment {
  /** Echoed back; iThink generates the real AWB when this is blank. */
  waybill?: string;
  order: string;
  sub_order?: string;
  /** Format: 'dd-mm-yyyy' or 'dd-mm-yyyy HH:mm:ss'. */
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
  /** 'yes' | 'no' — case-sensitive string. */
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
  /** cm. */
  shipment_length: string;
  /** cm. */
  shipment_width: string;
  /** cm. */
  shipment_height: string;
  /** kg (per ops confirmation; doc comment is misleading). */
  weight: string;
  shipping_charges?: string;
  giftwrap_charges?: string;
  transaction_charges?: string;
  total_discount?: string;
  /** Yes — they really spell it 'attemp'. Don't 'fix' it. */
  first_attemp_discount?: string;
  cod_charges?: string;
  advance_amount?: string;
  cod_amount?: string;
  payment_mode?: IThinkPaymentMode;
  reseller_name?: string;
  eway_bill_number?: string;
  gst_number?: string;
  what3words?: string;
  return_address_id: string;
}

export interface IThinkAddOrderRequest {
  shipments: IThinkAddOrderShipment[];
  pickup_address_id: string;
  /**
   * Forward: any of ITHINK_FORWARD_LOGISTICS.
   * Reverse: only ITHINK_REVERSE_LOGISTICS.
   * Omit to let iThink auto-route (not recommended — booked-cost surprises).
   */
  logistics?: IThinkForwardLogistics | IThinkReverseLogistics | '';
  s_type?: 'air' | 'surface' | 'standard' | 'priority' | 'ground' | '';
  order_type?: IThinkOrderType | '';
  /** Service source for iThink analytics: 1=own site, 11=Uinware, 12=easyecom. */
  api_source?: string;
  /** Required only if your account is connected to a Shopify/Magento/etc. store. */
  store_id?: string;
}

/**
 * Response is keyed by shipment index ("1", "2", ...) as strings, NOT
 * an array. Failed shipments still produce a row with `status: 'Failed'`
 * and a non-empty `remark` — html_message at envelope level summarises.
 */
export interface IThinkAddOrderResultRow {
  status: 'Success' | 'Failed' | string;
  remark: string;
  waybill: string;
  refnum: string;
  logistic_name: string;
  tracking_url: string;
}

export interface IThinkAddOrderResponseData {
  [shipmentIndex: string]: IThinkAddOrderResultRow;
}
