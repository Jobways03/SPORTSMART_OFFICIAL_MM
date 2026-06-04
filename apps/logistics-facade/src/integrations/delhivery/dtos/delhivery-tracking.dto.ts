/**
 * Delhivery tracking wire shapes. Sourced from
 * `GET /api/v1/packages/json/?waybill=<csv>&ref_ids=<order_ids>`.
 *
 * Either `waybill` (comma-separated, up to 50) OR `ref_ids` is
 * accepted. Delhivery responds with a `ShipmentData` envelope
 * wrapping one `Shipment` record per AWB. The shape below collapses
 * everything the mapper consumes; fields Delhivery sometimes emits
 * that we don't use (e.g. `Charges`) are intentionally omitted.
 */

export interface DelhiveryTrackingRequest {
  /** Comma-separated AWBs (up to 50). */
  waybill?: string;
  /** Comma-separated caller order IDs — alternative lookup. */
  ref_ids?: string;
}

export interface DelhiveryScanRecord {
  /** Free-form description e.g. "Manifested for Forward Journey". */
  ScanType?: string;
  /** Tightly-typed status keyword e.g. "Pending" | "Dispatched". */
  Scan?: string;
  /** Granular sub-status; populated for NDR / RTO transitions. */
  StatusCode?: string;
  ScanDateTime?: string;
  ScannedLocation?: string;
  Instructions?: string;
}

export interface DelhiveryShipmentRecord {
  AWB: string;
  Status?: {
    Status?: string;
    StatusCode?: string;
    StatusDateTime?: string;
    StatusLocation?: string;
    Instructions?: string;
  };
  /** Expected delivery date if Delhivery resolved one. */
  ExpectedDeliveryDate?: string;
  /** Full scan history, ascending by ScanDateTime. */
  Scans?: Array<{ ScanDetail?: DelhiveryScanRecord }>;
  /** "Forward" | "Reverse". */
  Origin?: string;
  Destination?: string;
  /** Echoes the caller order id when provided. */
  ReferenceNo?: string;
}

export interface DelhiveryTrackingResponse {
  ShipmentData?: Array<{
    Shipment?: DelhiveryShipmentRecord;
  }>;
}
