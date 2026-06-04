/**
 * Delhivery webhook payload shapes. Delhivery posts a single
 * envelope per status change; the `Shipment` block matches the same
 * record returned by the tracking endpoint so the mapper can reuse
 * the tracking translator.
 *
 * Source: https://docs.delhivery.com/webhooks/ (Tracking Updates).
 */

export interface DelhiveryWebhookScan {
  ScanDateTime?: string;
  ScanType?: string;
  ScannedLocation?: string;
  Instructions?: string;
  StatusCode?: string;
  Scan?: string;
}

export interface DelhiveryWebhookShipment {
  AWB: string;
  Status?: string;
  StatusCode?: string;
  StatusDateTime?: string;
  StatusLocation?: string;
  Instructions?: string;
  /** Optional full scan dump on backfill webhooks. */
  Scans?: Array<{ ScanDetail?: DelhiveryWebhookScan }>;
}

export interface DelhiveryWebhookPayload {
  Shipment: DelhiveryWebhookShipment;
}
