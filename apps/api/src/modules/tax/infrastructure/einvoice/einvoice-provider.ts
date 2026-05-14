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

export const EINVOICE_PROVIDER = Symbol.for('EInvoiceProvider');

export interface EInvoiceProvider {
  readonly name: string;
  generate(input: IrnGenerateInput): Promise<IrnGenerateResult>;
  cancel(input: IrnCancelInput): Promise<IrnCancelResult>;
}
