import type { IThinkAddOrderProduct } from './add-order.dto';

/**
 * Store Order Details — POST /api_v3/store/get-order-details.json
 *
 * Fetches orders by order number from a connected e-commerce store.
 * Only useful when iThink is pulling orders from Shopify/Magento for
 * you. Marketplace integration uses our own DB — this endpoint is
 * not wired by any service in this module.
 *
 * platform_id values:
 *   2=shopify, 3=magento, 4=woocommerce, 5=opencart, 6=prestashop
 */

export interface IThinkStoreOrderDetailsRequest {
  /** Comma-separated order numbers. */
  order_no_list: string;
  platform_id: string;
}

export interface IThinkStoreOrderDetailsRow {
  awb_no: string;
  order_id: string;
  order_number: string;
  order_date: string;
  total_amount: string;
  company_name: string;
  customer_address1: string;
  customer_address2: string;
  customer_pincode: string;
  customer_city: string;
  customer_state: string;
  customer_country: string;
  customer_phone: string;
  customer_email: string;
  is_billing_same_as_shipping: string;
  billing_name: string;
  billing_company_name: string;
  billing_address1: string;
  billing_address2: string;
  billing_pincode: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;
  billing_phone: string;
  billing_email: string;
  products: IThinkAddOrderProduct[];
  shipment_length: string;
  shipment_width: string;
  shipment_height: string;
  weight: string;
  shipping_charges: string;
  transaction_charges: string;
  total_discount: string;
  payment_mode: string;
  reseller_name: string;
  eway_bill_number: string;
  gst_number: string;
  return_address_id: string;
  pickup_address_id: string;
  store_id: string;
}

export interface IThinkStoreOrderDetailsResponseData {
  [orderId: string]: IThinkStoreOrderDetailsRow;
}
