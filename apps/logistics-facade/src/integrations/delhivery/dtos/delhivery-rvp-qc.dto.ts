/**
 * Delhivery RVP QC 3.0 (Reverse Pickup with parametric Quality Check)
 * wire shapes.
 *
 * Shares the create endpoint with forward shipments:
 *   `POST /api/cmu/create.json` (form-style — same body wrapping as
 *   forward; mapper layer fills the reverse-specific fields).
 *
 * Distinguished from forward by:
 *   • `payment_mode: "Pickup"`
 *   • `qc_type: "param"` (literal — indicates parametric QC)
 *   • `custom_qc: [...]` array with per-item QC checks
 *
 * Limits (per developer portal):
 *   • Max 2 QC items per shipment.
 *   • Max 6 questions per item.
 *
 * NOTE: SportsMart currently does not run reverse pickups (business
 * decision). This DTO + service are implemented for completeness so
 * the integration is feature-complete — the adapter logs a clear
 * "RVP QC 3.0 implemented but currently unused" notice on call.
 */

import type { DelhiveryShipment } from './delhivery-create-shipment.dto';

export type DelhiveryQcQuestionType = 'varchar' | 'multi';

export interface DelhiveryQcQuestion {
  questions_id: string | number;
  /** Display question. */
  options?: string[];
  /** Expected / accepted answers. */
  value?: string[];
  required: boolean;
  /** "varchar" => free-text answer; "multi" => multi-select. */
  type: DelhiveryQcQuestionType;
  ques_images?: string[];
}

export interface DelhiveryQcItem {
  item: string;
  description?: string;
  images?: string[];
  return_reason?: string;
  quantity: number;
  brand?: string;
  product_category?: string;
  /** Max 6 questions per item. */
  questions: DelhiveryQcQuestion[];
}

/**
 * RVP shipment row — extends the standard DelhiveryShipment with the
 * QC-specific fields. payment_mode must be "Pickup".
 */
export interface DelhiveryRvpShipment
  extends Omit<DelhiveryShipment, 'payment_mode'> {
  payment_mode: 'Pickup';
  /** Literal "param" — indicates parametric QC. */
  qc_type: 'param';
  /** Max 2 items. */
  custom_qc: DelhiveryQcItem[];
}

export interface DelhiveryRvpCreateRequest {
  shipments: DelhiveryRvpShipment[];
  pickup_location: { name: string };
}

/**
 * Response envelope matches forward create — Delhivery reuses the
 * same `packages[]` shape.
 */
export type DelhiveryRvpCreateResponse =
  import('./delhivery-create-shipment.dto').DelhiveryCreateShipmentResponse;
