/**
 * Store Order List — POST /api_v3/store/get-order-list.json
 *
 * Lists order numbers for a connected store within a date range.
 * As with Store Order Details, this endpoint isn't used by the
 * marketplace integration — kept for completeness.
 */

export interface IThinkStoreOrderListRequest {
  platform_id: string;
  /** 'YYYY-MM-DD'. */
  start_date: string;
  /** 'YYYY-MM-DD'. */
  end_date: string;
}

/** Plain array of order-id strings. */
export type IThinkStoreOrderListResponseData = string[];
