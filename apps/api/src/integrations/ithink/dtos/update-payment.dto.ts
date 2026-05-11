/**
 * Update Payment — POST /api_v3/order/update-payment.json
 *
 * Flip a COD shipment to Prepaid at the courier level. Only supported
 * by select carriers (Abhilaya, Pikndel, Xpressbees_SND); other
 * carriers will reject. Conversion is COD → Prepaid only; the reverse
 * direction is not allowed.
 *
 * Use when a customer pre-pays an order that was originally booked
 * as COD (e.g., they paid via UPI before the delivery agent arrived).
 */

export interface IThinkUpdatePaymentRequest {
  awb_numbers: string;
}

export interface IThinkUpdatePaymentResponse {
  status: 'success' | string;
  status_code: number;
  html_message: string;
}
