/**
 * Shadowfax label wire shapes.
 * Source: `GET /api/v1/orders/{order_id}/label`.
 *
 * Shadowfax serves labels as PDF only. Unlike Delhivery, Shadowfax
 * is one-call-per-order (no batch CSV); the service batches at the
 * facade layer.
 */

export interface ShadowfaxLabelResponse {
  order_id: string;
  /** S3-style URL Shadowfax presigns on demand. */
  label_url: string;
  /** "pdf" — only format Shadowfax serves. */
  format: 'pdf';
  /** TTL of the presigned URL in seconds. */
  expires_in?: number;
}
