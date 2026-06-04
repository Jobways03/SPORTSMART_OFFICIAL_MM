/**
 * Delhivery shipping-cost calculator wire shapes.
 *
 * `GET /api/kinko/v1/invoice/charges/.json`
 *
 * Query params:
 *   • md         (required) — "E" (Express) | "S" (Surface)
 *   • cgm        (required, int) — chargeable weight in grams
 *   • o_pin      (required, int) — origin pincode
 *   • d_pin      (required, int) — destination pincode
 *   • ss         (required) — "Delivered" | "RTO" | "DTO"
 *   • pt         (required) — "Pre-paid" | "COD"
 *   • l          (optional, int) — length in cm
 *   • b          (optional, int) — breadth in cm
 *   • h          (optional, int) — height in cm
 *   • ipkg_type  (optional) — "box" | "flyer"
 */

export type DelhiveryCostMode = 'E' | 'S';
export type DelhiveryCostShipmentStatus = 'Delivered' | 'RTO' | 'DTO';
export type DelhiveryCostPaymentType = 'Pre-paid' | 'COD';
export type DelhiveryCostPackageType = 'box' | 'flyer';

export interface DelhiveryCalculateCostRequest {
  md: DelhiveryCostMode;
  cgm: number;
  o_pin: number;
  d_pin: number;
  ss: DelhiveryCostShipmentStatus;
  pt: DelhiveryCostPaymentType;
  l?: number;
  b?: number;
  h?: number;
  ipkg_type?: DelhiveryCostPackageType;
}

/**
 * Delhivery's response is a single-element array with the quoted
 * gross + per-charge breakdown. Fields outside this set get echoed
 * but we don't consume them.
 */
export interface DelhiveryCalculateCostResponseEntry {
  /** Quoted gross charge — INR (can be fractional). */
  total_amount?: number;
  /** Per-charge breakdown — partner-specific keys. */
  charge_DPH?: number;
  charge_COD?: number;
  charge_FOD?: number;
  charge_FS?: number;
  charge_FSC?: number;
  charge_RTO?: number;
  /** Zone classification. */
  zone?: string;
  /** Service tier echo. */
  status?: string;
  /** Failure reason. */
  error?: string;
}

export type DelhiveryCalculateCostResponse =
  | DelhiveryCalculateCostResponseEntry
  | DelhiveryCalculateCostResponseEntry[];
