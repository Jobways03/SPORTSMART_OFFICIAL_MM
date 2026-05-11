/**
 * Get Airwaybill — POST /api_v3/order/get_awb.json
 *
 * The "status-change firehose" endpoint. Returns AWBs whose status
 * changed within a time window of up to 30 minutes. Replaces webhooks
 * (iThink doesn't push) for catching delivery/RTO/NDR events.
 *
 * Usage pattern: scheduled cron polls every ~25 min, then for each
 * returned AWB calls Track Order to fetch the full timeline.
 */

export interface IThinkGetAirwaybillRequest {
  /** Format: 'YYYY-MM-DD HH:mm:ss'. */
  start_date_time: string;
  /** Format: 'YYYY-MM-DD HH:mm:ss'. Window ≤ 30 minutes. */
  end_date_time: string;
}

/**
 * Response uses a *non-standard top-level field name*: 'Awb list'
 * (capital A, space between 'Awb' and 'list'). The envelope shape
 * differs from other endpoints because there is no `data`/`status_code`
 * wrapping — service code reads from `Awb list` directly.
 */
export interface IThinkGetAirwaybillEntry {
  airway_bill_no: string;
}

export interface IThinkGetAirwaybillResponse {
  status: 'success' | string;
  'Awb list': IThinkGetAirwaybillEntry[];
}
