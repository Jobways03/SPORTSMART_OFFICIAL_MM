/**
 * Delhivery waybill (AWB) allocation wire shapes.
 *
 * Two endpoints:
 *   • Bulk:   `GET /waybill/api/bulk/json/?count=<N>` — capped at
 *             10,000 per call and 50,000 per 5-minute window.
 *             Backend allocates in batches of 25.
 *   • Single: `GET /waybill/api/fetch/json/?token=<token>`.
 *
 * Delhivery historically returns the bulk response as a quoted
 * comma-separated string body (`"123,456,789"`); newer accounts
 * see a JSON envelope `{ waybills: string[] }`. The mapper handles
 * both shapes.
 */

export interface DelhiveryFetchWaybillBulkRequest {
  /** 1..10000. */
  count: number;
  /** Optional client code; some accounts require this. */
  cl?: string;
}

export interface DelhiveryFetchWaybillSingleRequest {
  /** Allocation token issued by Delhivery to the account. */
  token: string;
}

export interface DelhiveryFetchWaybillResponse {
  /** Modern envelope shape. */
  waybills?: string[];
  /** Single-fetch shape. */
  waybill?: string;
  /** Delhivery sometimes echoes the count. */
  count?: number;
}
