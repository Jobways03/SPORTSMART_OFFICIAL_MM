/**
 * Delhivery Ewaybill update wire shapes.
 *
 * `PUT /api/rest/ewaybill/{waybill}/`
 *
 * Used for shipments where declared value exceeds ₹50,000 — GST
 * compliance requires the e-way bill number be attached so the
 * lorry receipt can be inspected.
 *
 * Body:
 *   {"data": [{"dcn": "invoice_number", "ewbn": "ewb_number"}]}
 *
 * The path-bound `{waybill}` identifies the shipment; the body
 * carries the invoice + e-way bill mapping.
 */

export interface DelhiveryEwaybillEntry {
  /** Document Control Number — typically the invoice number. */
  dcn: string;
  /** E-way bill number issued by the GSTN. */
  ewbn: string;
}

export interface DelhiveryEwaybillUpdateRequest {
  data: DelhiveryEwaybillEntry[];
}

export interface DelhiveryEwaybillUpdateResponse {
  status?: string;
  /** Delhivery sometimes echoes the waybill back. */
  waybill?: string;
  /** Failure remarks if any. */
  remarks?: string | string[];
  error?: unknown;
}
