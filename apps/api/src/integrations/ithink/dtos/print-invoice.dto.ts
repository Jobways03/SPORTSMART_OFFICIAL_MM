/**
 * Print Invoice — POST /api_v3/shipping/invoice.json
 *
 * Customer-facing invoice PDF (max 100 AWBs per request). Only relevant
 * if you ship iThink-generated invoices alongside the package. If your
 * platform produces its own GST-compliant invoice you can skip this.
 */

export interface IThinkPrintInvoiceRequest {
  awb_numbers: string;
}

export interface IThinkPrintInvoiceResponse {
  status: 'success' | string;
  status_code: number;
  file_name: string;
}
