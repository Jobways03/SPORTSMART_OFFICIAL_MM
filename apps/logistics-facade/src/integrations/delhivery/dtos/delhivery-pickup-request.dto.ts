/**
 * Delhivery Pickup Request Creation wire shapes.
 *
 * `POST /fm/request/new/`
 *
 * Body:
 *   {
 *     "pickup_time": "11:00:00",
 *     "pickup_date": "2023-12-29",
 *     "pickup_location": "warehouse_name",
 *     "expected_package_count": 1
 *   }
 *
 * Raised against a warehouse (not against individual waybills).
 * Delhivery enforces ONE pickup request per warehouse per day until
 * the previous request closes — duplicate raises hit "BUSY"
 * (mapped to LogisticsErrorCode.BUSY).
 */

export interface DelhiveryPickupRequestRequest {
  /** "HH:MM:SS" (24h). */
  pickup_time: string;
  /** "YYYY-MM-DD". */
  pickup_date: string;
  /** Warehouse name registered in the Delhivery One panel. */
  pickup_location: string;
  /** Expected number of packages — positive integer. */
  expected_package_count: number;
}

export interface DelhiveryPickupRequestResponse {
  /** Delhivery's pickup ID — needed for status follow-up. */
  pickup_id?: string | number;
  /** "Success" | "Failure". */
  status?: string;
  /** Failure remark / detail. */
  remark?: string;
  remarks?: string | string[];
  error?: unknown;
}
