import type { ITHINK_NDR_ACTION, ITHINK_NDR_ADDRESS_TYPE } from '../ithink.constants';

/**
 * NDR Reattempt / RTO — POST /api_v3/ndr/add-reattempt-rto.json
 *
 * After a shipment goes 'Undelivered' (NDR), admin (or an auto-rule)
 * decides whether to retry delivery or give up and return-to-origin.
 *
 *   ndr_action = 1 → reattempt (date/time/address fields required)
 *   ndr_action = 2 → rto       (rto_remark required)
 *
 * Multiple AWBs can be actioned in one request via the `shipments`
 * array. Response is keyed by AWB.
 */

export interface IThinkNdrShipmentAction {
  awb_numbers: string;
  ndr_action: (typeof ITHINK_NDR_ACTION)[keyof typeof ITHINK_NDR_ACTION] | string;
  /** Required if ndr_action = 1. Format: 'YYYY-MM-DD'. */
  reattempt_date?: string;
  /** Format: 'HH:mm:ss'. */
  reattempt_time?: string;
  reattempt_mobile_number?: string;
  reattempt_address?: string;
  reattempt_address_type?:
    | (typeof ITHINK_NDR_ADDRESS_TYPE)[keyof typeof ITHINK_NDR_ADDRESS_TYPE]
    | string;
  /** Required if ndr_action = 2. */
  rto_remark?: string;
}

export interface IThinkNdrReattemptRtoRequest {
  shipments: IThinkNdrShipmentAction[];
}

export interface IThinkNdrResultRow {
  status: 'success' | string;
  remark: string;
}

export interface IThinkNdrReattemptRtoResponseData {
  [awb: string]: IThinkNdrResultRow;
}
