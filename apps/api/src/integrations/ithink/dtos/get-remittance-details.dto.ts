/**
 * Get Remittance Details — POST /api_v3/remittance/get_details.json
 *
 * AWB-level breakdown of a daily remittance — which orders' COD
 * cash was settled in this batch. Critical for gating seller payouts:
 * we shouldn't credit the seller's wallet for a COD order until
 * iThink has actually remitted that AWB.
 *
 * NOTE: their docs list the same URL for staging and production
 * (likely a copy-paste bug). Treat as a single production host or
 * confirm with iThink.
 */

export interface IThinkGetRemittanceDetailsRequest {
  remittance_date: string;
}

export interface IThinkRemittanceLineRow {
  airway_bill_no: string;
  order_no: string;
  price: string;
  delivered_date: string;
}

export type IThinkGetRemittanceDetailsResponseData = IThinkRemittanceLineRow[];
