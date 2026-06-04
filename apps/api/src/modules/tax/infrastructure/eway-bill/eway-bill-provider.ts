// Phase 15 GST — E-way bill provider interface.
//
// Abstracts the external EWB generator so the service can be swapped
// between the dev/test stub and the production NIC e-Waybill API
// without service-layer changes. Choice is controlled at boot time
// via EWAY_BILL_PROVIDER env (currently only `stub` is implemented;
// `nic` lands in a later phase tied to e-invoicing).

import type { EWayBillTransportMode } from '@prisma/client';

export interface EWayBillGenerateInput {
  supplierGstin: string | null;
  invoiceDocumentNumber: string | null;
  invoiceDate: Date | null;
  fromPincode: string | null;
  fromStateCode: string | null;
  toPincode: string | null;
  toStateCode: string | null;
  distanceKm: number | null;
  consignmentValueInPaise: bigint;
  transportMode: EWayBillTransportMode;
  vehicleNumber: string | null;
  transporterId: string | null;
  transporterName: string | null;
  /** Raw item rows captured for the NIC payload (HSN, qty, taxable
   *  value, etc.). The stub only stamps these into rawRequestJson;
   *  the NIC adapter will marshal them into the NIC schema. */
  items?: Array<{
    productName: string;
    hsnOrSacCode: string | null;
    quantity: number;
    uqcCode: string | null;
    taxableAmountInPaise: bigint;
    gstRateBps: number;
  }>;
}

export interface EWayBillGenerateResult {
  ewbNumber: string;
  ewbDate: Date;
  validUntil: Date;
  rawRequestJson: unknown;
  rawResponseJson: unknown;
}

export interface EWayBillCancelInput {
  ewbNumber: string;
  reason: string;
}

export interface EWayBillCancelResult {
  cancelledAt: Date;
  rawResponseJson: unknown;
  // Phase 160 (cancel/override audit #7) — NIC's cancellation reference,
  // surfaced so the service can persist it in a queryable column.
  providerCancelReference?: string | null;
}

/**
 * Phase 160 (e-way-bill audit #18) — NIC Part-B (transport details) update.
 * Part-B can be revised after issuance WITHOUT cancelling the EWB (e.g. a
 * vehicle breakdown / trans-shipment). NIC re-issues the validity on a
 * Part-B update; the provider returns the (possibly refreshed) validUntil.
 */
export interface EWayBillUpdatePartBInput {
  ewbNumber: string;
  transportMode: EWayBillTransportMode;
  vehicleNumber: string | null;
  transporterId: string | null;
  transporterName: string | null;
  distanceKm: number | null;
  /** Free-text reason captured in the audit trail. */
  reason: string;
}

export interface EWayBillUpdatePartBResult {
  validUntil: Date;
  rawResponseJson: unknown;
}

/**
 * Phase 160 (e-way-bill audit #11) — typed provider error so the service +
 * controller map NIC's failure modes to the right HTTP status / retry
 * behaviour instead of collapsing every error to 500. Mirrors the
 * e-invoice EInvoiceProviderError taxonomy:
 *   - AUTH      (NIC token expired / HTTP 401): refresh + retry
 *   - RATE_LIMIT(HTTP 429): back off + retry
 *   - PERMANENT (HTTP 400 / NIC data error e.g. invalid GSTIN, bad
 *               vehicle format): do NOT retry
 *   - TRANSIENT (HTTP 5xx / network): retryable
 */
export type EWayBillProviderErrorCategory =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'PERMANENT'
  | 'TRANSIENT';

export class EWayBillProviderError extends Error {
  constructor(
    message: string,
    public readonly category: EWayBillProviderErrorCategory,
    public readonly opts: {
      nicErrorCode?: string | null;
      httpStatus?: number | null;
    } = {},
  ) {
    super(message);
    this.name = 'EWayBillProviderError';
  }

  get retryable(): boolean {
    return this.category === 'AUTH' || this.category === 'RATE_LIMIT' || this.category === 'TRANSIENT';
  }
}

export const EWAY_BILL_PROVIDER = Symbol.for('EWayBillProvider');

export interface EWayBillProvider {
  /** Stable identifier — 'stub' / 'nic'. Persisted on each row so
   *  audit trail records which provider produced the number. */
  readonly name: string;
  generate(input: EWayBillGenerateInput): Promise<EWayBillGenerateResult>;
  cancel(input: EWayBillCancelInput): Promise<EWayBillCancelResult>;
  // Phase 160 (audit #18) — update Part-B (transport) without cancelling.
  updatePartB(
    input: EWayBillUpdatePartBInput,
  ): Promise<EWayBillUpdatePartBResult>;
}
