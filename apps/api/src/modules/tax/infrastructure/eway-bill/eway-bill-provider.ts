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
}

export const EWAY_BILL_PROVIDER = Symbol.for('EWayBillProvider');

export interface EWayBillProvider {
  /** Stable identifier — 'stub' / 'nic'. Persisted on each row so
   *  audit trail records which provider produced the number. */
  readonly name: string;
  generate(input: EWayBillGenerateInput): Promise<EWayBillGenerateResult>;
  cancel(input: EWayBillCancelInput): Promise<EWayBillCancelResult>;
}
