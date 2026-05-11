/**
 * Cancel Order — POST /api_v3/order/cancel.json
 *
 * Cancels one or more shipments by AWB. Max 100 AWBs per request.
 * Only effective before physical pickup — once iThink has picked up
 * the package, cancellation must be done via RTO (NDR endpoint).
 */

export interface IThinkCancelOrderRequest {
  /** Comma-separated AWB numbers, max 100. */
  awb_numbers: string;
}

export interface IThinkCancelOrderResultRow {
  status: 'Success' | 'Failed' | string;
  remark: string;
  refnum: string;
}

export interface IThinkCancelOrderResponseData {
  [shipmentIndex: string]: IThinkCancelOrderResultRow;
}
