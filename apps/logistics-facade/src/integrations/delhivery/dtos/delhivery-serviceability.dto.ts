/**
 * Delhivery serviceability wire shapes. Sourced from
 * `GET /c/api/pin-codes/json/?filter_codes={pincode}`.
 *
 * Delhivery returns a nested `delivery_codes` array even when querying
 * a single pincode — the mapper unwraps it. Empty array means
 * unserviceable.
 */

export interface DelhiveryPincodeRecord {
  postal_code: string;
  district?: string;
  state_code?: string;
  /** "Y" / "N" — Delhivery exposes a forward-deliverable flag. */
  pre_paid?: string;
  /** "Y" / "N" — COD availability. */
  cash?: string;
  /** "Y" / "N" — reverse pickup availability. */
  pickup?: string;
  /** "Y" / "N" — repl(reverse-payment) — separate from `pickup`. */
  repl?: string;
  /** Promised delivery TAT (in days); Delhivery sometimes omits. */
  cod?: string;
  /** Maximum allowed parcel weight (grams). */
  max_amount?: string;
  /** Zone classification ("A" .. "E"); used for rate-card lookups. */
  remarks?: string;
}

export interface DelhiveryServiceabilityResponse {
  delivery_codes: Array<{
    postal_code?: DelhiveryPincodeRecord;
  }>;
}
