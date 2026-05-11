import type { IThinkStatus } from '../ithink.constants';

/**
 * Track Order — POST /api_v3/order/track.json
 *
 * Returns full per-AWB scan history. Max 10 AWBs per request. This is
 * the only endpoint that uses a different production host
 * (`api.ithinklogistics.com`); sandbox collapses to `pre-alpha`.
 *
 * IMPORTANT: map on the verbose `status` field, NOT `status_code` —
 * the code column folds ~25 distinct meanings (Manifested, In Transit,
 * Picked Up, Damaged, Misrouted, etc.) into the single value 'UD'.
 */

export interface IThinkTrackOrderRequest {
  /** Comma-separated AWB list, max 10. */
  awb_number_list: string;
}

export interface IThinkTrackScanDetail {
  status: IThinkStatus | string;
  status_code: string;
  scan_location: string;
  remark: string;
  scan_date_time: string;
  status_reason: string;
}

export interface IThinkTrackLastScan {
  status: IThinkStatus | string;
  status_code: string;
  status_date_time: string;
  scan_location: string;
  remark: string;
  reason: string;
}

export interface IThinkTrackOrderDetails {
  /** This nested 'order_type' is actually payment-mode (COD / Prepaid). */
  order_type: string;
  order_number: string;
  sub_order_number: string;
  order_sub_order_number: string;
  phy_weight: string;
  net_payment: string;
  ship_length: string;
  ship_width: string;
  ship_height: string;
}

export interface IThinkTrackOrderDateTimes {
  manifest_date_time: string;
  pickup_date: string;
  delivery_date: string;
  rto_delivered_date: string;
}

export interface IThinkTrackCustomerDetails {
  customer_name: string;
  customer_address1: string;
  customer_address2: string;
  customer_address3: string;
  customer_city: string;
  customer_state: string;
  customer_country: string;
  customer_pincode: string;
  customer_mobile: string;
  customer_phone: string;
}

export interface IThinkTrackOrderRow {
  message: string;
  awb_no: string;
  logistic: string;
  /** Forward / reverse — direction of the shipment. */
  order_type: 'forward' | 'reverse' | string;
  cancel_status: 'Pending' | 'Approved' | 'Request Rejected' | 'Refunded' | '' | string;
  current_status: IThinkStatus | string;
  current_status_code: string;
  ofd_count: string;
  return_tracking_no: string;
  expected_delivery_date: string;
  promise_delivery_date: string;
  last_scan_details: IThinkTrackLastScan;
  order_details: IThinkTrackOrderDetails;
  order_date_time: IThinkTrackOrderDateTimes;
  customer_details: IThinkTrackCustomerDetails;
  scan_details: IThinkTrackScanDetail[];
}

/** Keyed by AWB number. */
export interface IThinkTrackOrderResponseData {
  [awb: string]: IThinkTrackOrderRow;
}
