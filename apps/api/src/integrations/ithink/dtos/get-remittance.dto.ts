/**
 * Get Remittance — POST /api_v3/remittance/get.json
 *
 * Daily COD remittance summary. Tells us how much iThink owes us
 * (cod_generated minus charges minus adjustments). Plug into the
 * reconciliation module — until iThink has actually remitted, the
 * seller's share of that order is unsettled.
 */

export interface IThinkGetRemittanceRequest {
  /** Format: 'YYYY-MM-DD'. */
  remittance_date: string;
}

export interface IThinkRemittanceSummaryRow {
  remittance_id: string;
  /** Human-formatted: '20 Apr 2021'. */
  remittance_date: string;
  cod_generated: string;
  bill_adjusted: string;
  refund_adjusted: string;
  transaction_charges: string;
  transaction_gst_charges: string;
  wallet_amount: string;
  advance_hold: string;
  cod_remitted: string;
}

export type IThinkGetRemittanceResponseData = IThinkRemittanceSummaryRow[];
