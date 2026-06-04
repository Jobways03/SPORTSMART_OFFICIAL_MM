// Phase 22 GST — E-invoice provider interface.
//
// Abstracts the NIC IRP (Invoice Registration Portal) so the service
// layer can switch between:
//   - StubEInvoiceProvider — produces deterministic IRN fixtures so
//     the full lifecycle (generate / cancel / re-attempt after failure)
//     is exercisable without NIC credentials.
//   - NicEInvoiceProvider (later phase) — the real CBIC IRP API.
//
// Selection is via `EINVOICE_PROVIDER` env (`stub` | `nic`). `nic`
// crashes loudly at boot until wired so a misconfigured deployment
// can't silently fall back to the stub in production.

import type { DocumentType } from '@prisma/client';

// Phase 90 (2026-05-23) — Gap #12. NIC's `subSupplyType` discriminator
// covers domestic-B2B / SEZ-with-payment / SEZ-without-payment / export
// variants. The classifier picks the value from buyer GSTIN + supplier
// GSTIN state code + reverseChargeApplicable flag and threads it
// through the provider payload.
export type EInvoiceTransactionCategory =
  | 'B2B' // domestic registered buyer
  | 'SEZWP' // SEZ supply with payment of IGST
  | 'SEZWOP' // SEZ supply without payment (LUT)
  | 'EXPWP' // export with payment of IGST
  | 'EXPWOP' // export without payment (LUT)
  | 'DEXP'; // deemed export

export interface IrnGenerateInput {
  /** Invoice-side identifiers — the IRP request payload mirrors NIC's
   *  schema field-for-field once the real adapter lands. */
  supplierGstin: string;
  buyerGstin: string;
  documentNumber: string;
  documentDate: Date;
  documentType: DocumentType;
  totalInvoiceValueInPaise: bigint;
  taxableValueInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
  // Phase 90 — Gap #12 / #23-#25. Carry the tax-treatment markers NIC
  // requires on every payload. Without these the stub silently
  // accepts; NIC rejects with a cryptic schema error.
  transactionCategory: EInvoiceTransactionCategory;
  reverseChargeApplicable: boolean;
  /** Two-digit GST state code for the place of supply (CBIC's POS
   *  rules require this when supplier and buyer states differ from the
   *  derived place of supply). */
  placeOfSupplyStateCode?: string | null;
  // Phase 90 — Gap #10 credit/debit note linkage. When set, the
  // provider includes the original invoice's IRN + document number
  // in the IRP payload (mandatory per CBIC for CN/DN).
  originalIrn?: string | null;
  originalDocumentNumber?: string | null;
  originalDocumentDate?: Date | null;
  lineItems: Array<{
    productName: string;
    hsnOrSacCode: string | null;
    uqcCode: string | null;
    quantity: number;
    unitPriceInPaise: bigint;
    taxableInPaise: bigint;
    gstRateBps: number;
  }>;
}

export interface IrnGenerateResult {
  /** 64-character SHA-256 hex IRN. Globally unique per CBIC contract. */
  irn: string;
  /** NIC-side acknowledgement number — short numeric reference. */
  ackNo: string;
  ackDate: Date;
  /** Signed payload as returned by NIC (JWS / JSON-with-signature
   *  envelope). For the stub we record a minimal object. */
  signedDocumentJson: unknown;
  /** Signed QR-code image URL — embedded on the customer-facing PDF. */
  qrCodeUrl: string;
}

export interface IrnCancelInput {
  irn: string;
  /** NIC cancellation codes: 1=duplicate, 2=data entry mistake,
   *  3=order cancelled, 4=other. Stub accepts any positive integer. */
  cancellationCode: number;
  /** Free-text reason captured in the audit trail. */
  cancellationReason: string;
}

export interface IrnCancelResult {
  cancelledAt: Date;
  signedDocumentJson: unknown;
}

/**
 * Phase 160 (e-invoice audit #8) — typed provider error so the service +
 * controller can map NIC's failure modes to the right HTTP status / retry
 * behaviour instead of collapsing everything to 500. Categories:
 *   - AUTH       (NIC 2172 / HTTP 401): token expired → refresh + retry
 *   - RATE_LIMIT (HTTP 429): back off + retry
 *   - DUPLICATE  (NIC 2150): invoice already registered — idempotent;
 *                 the provider SHOULD recover the existing IRN, but if it
 *                 can't, the controller maps to 409 (not 500).
 *   - PERMANENT  (NIC 2253 etc. / HTTP 400): bad payload — do NOT retry.
 *   - TRANSIENT  (HTTP 5xx / network): retryable.
 * `retryable` is the single signal the retry cron / controller consult.
 */
export type EInvoiceProviderErrorCategory =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'DUPLICATE'
  | 'PERMANENT'
  | 'TRANSIENT';

export class EInvoiceProviderError extends Error {
  constructor(
    message: string,
    public readonly category: EInvoiceProviderErrorCategory,
    public readonly opts: {
      nicErrorCode?: string | null;
      httpStatus?: number | null;
    } = {},
  ) {
    super(message);
    this.name = 'EInvoiceProviderError';
  }

  /** Should the retry cron / caller re-attempt this? */
  get retryable(): boolean {
    return this.category === 'AUTH' || this.category === 'RATE_LIMIT' || this.category === 'TRANSIENT';
  }
}

export const EINVOICE_PROVIDER = Symbol.for('EInvoiceProvider');

export interface EInvoiceProvider {
  readonly name: string;
  generate(input: IrnGenerateInput): Promise<IrnGenerateResult>;
  cancel(input: IrnCancelInput): Promise<IrnCancelResult>;
}
