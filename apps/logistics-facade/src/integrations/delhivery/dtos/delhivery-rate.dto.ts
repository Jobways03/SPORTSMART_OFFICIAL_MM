/**
 * Delhivery rate-card wire shapes. Used by the (read-only) rate
 * helper — Delhivery doesn't surface a real-time pricing call on
 * every plan; many tenants are on flat rate cards published via a
 * monthly CSV. The `rate` query parameter on the kinr.json endpoint
 * is the closest thing to a live quote.
 *
 * Sourced from `GET /api/kinr.json` (rate-calculator).
 */

export interface DelhiveryRateRequest {
  md: 'E' | 'S';
  ss: 'Delivered' | 'RTO';
  d_pin: string;
  o_pin: string;
  cgm: number;
  pt: 'Pre-paid' | 'COD';
  /** Required when pt = COD. */
  cod?: number;
}

export interface DelhiveryRateResponse {
  /** Delhivery's quoted gross charge — INR, can be fractional. */
  total_amount?: number;
  /** Per-charge breakdown. */
  charge_DPH?: number;
  charge_COD?: number;
  charge_FOD?: number;
  charge_FS?: number;
  /** Estimated TAT (days). */
  TAT?: number;
  /** Failure reason if Delhivery refused to quote. */
  status?: string;
}
