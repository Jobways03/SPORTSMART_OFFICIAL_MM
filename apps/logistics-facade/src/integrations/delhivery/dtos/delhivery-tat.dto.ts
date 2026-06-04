/**
 * Delhivery Expected TAT (turnaround time) wire shapes.
 *
 * `GET /api/dc/expected_tat`
 *
 * Query params:
 *   • origin_pin            (required, string)
 *   • destination_pin       (required, string)
 *   • mot                   (required) — "S" (Surface) | "E" (Express) | "N" (Next-Day)
 *   • pdt                   (optional) — "B2B" | "B2C" | "" — defaults to B2C
 *   • expected_pickup_date  (optional) — "YYYY-MM-DD HH:mm"
 */

export type DelhiveryMot = 'S' | 'E' | 'N';
export type DelhiveryProductType = 'B2B' | 'B2C' | '';

export interface DelhiveryExpectedTatRequest {
  origin_pin: string;
  destination_pin: string;
  mot: DelhiveryMot;
  pdt?: DelhiveryProductType;
  /** "YYYY-MM-DD HH:mm" — Delhivery's expected format. */
  expected_pickup_date?: string;
}

export interface DelhiveryExpectedTatResponse {
  /** Expected delivery date (Delhivery returns ISO-ish). */
  expected_delivery_date?: string;
  /** TAT in days. */
  tat?: number | string;
  /** Status string — "Success" / "Failure". */
  status?: string;
  /** Free-form remark. */
  remarks?: string | string[];
  /** Origin / destination echo. */
  origin_pin?: string;
  destination_pin?: string;
}
