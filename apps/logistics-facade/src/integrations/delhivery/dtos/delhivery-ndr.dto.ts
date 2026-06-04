/**
 * Delhivery NDR (Non-Delivery Reattempt) action wire shapes.
 *
 * Two calls:
 *   • Apply action:  `POST /api/p/update`
 *       Body: `{ data: [{ waybill: "...", act: "RE-ATTEMPT" | "PICKUP_RESCHEDULE" }] }`
 *       Returns a UPL ID; the action is processed async.
 *   • Get status:    `GET /api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`
 *
 * Action eligibility (per the developer portal):
 *   • RE-ATTEMPT          allowed when current NSL ∈
 *     ["EOD-74","EOD-15","EOD-104","EOD-43","EOD-86","EOD-11","EOD-69","EOD-6"].
 *   • PICKUP_RESCHEDULE   allowed when current NSL ∈ ["EOD-777","EOD-21"].
 *
 * Apply after 9 PM IST. `attempt_count` must be 1 or 2.
 *
 * The mapper translates NSL-ineligible rejections to
 * `LogisticsErrorCode.INVALID_STATE`.
 */

export type DelhiveryNdrAction = 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE';

/**
 * NSL codes Delhivery accepts as eligible per action. Mirrors the
 * portal spec — kept here so the service can guard pre-flight before
 * paying the network cost.
 */
export const DELHIVERY_NDR_REATTEMPT_NSLS = [
  'EOD-74',
  'EOD-15',
  'EOD-104',
  'EOD-43',
  'EOD-86',
  'EOD-11',
  'EOD-69',
  'EOD-6',
] as const;

export const DELHIVERY_NDR_PICKUP_RESCHEDULE_NSLS = [
  'EOD-777',
  'EOD-21',
] as const;

export interface DelhiveryNdrActionEntry {
  waybill: string;
  act: DelhiveryNdrAction;
}

export interface DelhiveryNdrActionRequest {
  data: DelhiveryNdrActionEntry[];
}

export interface DelhiveryNdrActionResponse {
  /** Async — Delhivery returns the UPL ID; use Get NDR Status to poll. */
  upl?: string | number;
  upl_id?: string | number;
  /** Some envelope variants surface a top-level status. */
  status?: string;
  /** Failure detail. */
  remarks?: string | string[];
  error?: unknown;
}

/* ─── Get NDR Status ───────────────────────────────────────────── */

export interface DelhiveryNdrStatusResponse {
  upl_id?: string;
  /** Per-waybill processing status. */
  data?: Array<{
    waybill?: string;
    act?: string;
    status?: string;
    remarks?: string | string[];
    nsl_code?: string;
  }>;
  /** Top-level status (queued / processing / completed). */
  status?: string;
  verbose?: unknown;
}
