/**
 * Print Manifest — POST /api_v3/shipping/manifest.json
 *
 * Generates the daily pickup manifest PDF that the seller/franchise
 * hands to the courier driver. Same response shape as Print Label
 * (single `file_name` PDF URL).
 */

export interface IThinkPrintManifestRequest {
  awb_numbers: string;
}

export interface IThinkPrintManifestResponse {
  status: 'success' | string;
  status_code: number;
  file_name: string;
}
