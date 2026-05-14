// Phase 22 GST — E-invoice applicability decision.
//
// Pure function. Inputs are pre-loaded by the service layer; this
// module decides whether a given tax document should be routed
// through the NIC IRP (Invoice Registration Portal) per CBIC Rule
// 48(4) + subsequent notifications.
//
// Three gates (any one of them stops applicability):
//
//   1. Document type — only invoice-like documents go through IRP.
//      TAX_INVOICE, INVOICE_CUM_BILL_OF_SUPPLY, CREDIT_NOTE, DEBIT_NOTE
//      are eligible; BILL_OF_SUPPLY (composition / exempt supplier),
//      LEGACY_RECEIPT, anything VOIDED_DRAFT / SUPERSEDED → skip.
//
//   2. Recipient type — IRP requires B2B (recipient has GSTIN).
//      B2C invoices stay outside IRP per CBIC notification.
//
//   3. Supplier turnover gate — supplier must either be **above the
//      env-tunable threshold** (default ₹5 crore aggregate annual
//      turnover) OR have **explicitly opted in** (`einvoiceOptedIn`
//      true). Sub-threshold + non-opted-in suppliers skip IRP.
//
// `DECISION` shape carries a `reason` field on every NOT_APPLICABLE
// outcome so the audit log can record exactly why a document was
// skipped — useful when CA reviews compliance.

import type { DocumentType, TaxDocumentStatus } from '@prisma/client';

/** Default turnover gate per CBIC Aug-2023 notification. Engineering
 *  picks ₹5 crore = 5_00_00_000 rupees = 5_00_00_000_00 paise. */
export const DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE = 5_00_00_000_00n;

export interface EInvoiceApplicabilityInput {
  documentType: DocumentType;
  documentStatus: TaxDocumentStatus;
  buyerGstin: string | null;
  /** Supplier's aggregate annual turnover (paise). */
  supplierAggregateTurnoverInPaise: bigint;
  /** Voluntary opt-in flag from `seller_gstins.einvoice_opted_in`. */
  supplierEinvoiceOptedIn: boolean;
  /** Optional threshold override (env / tax_config). Defaults to the
   *  CBIC ₹5 crore line if not supplied. */
  turnoverThresholdInPaise?: bigint;
}

export interface EInvoiceApplicabilityDecision {
  applicable: boolean;
  reason: string;
}

export function decideEInvoiceApplicability(
  input: EInvoiceApplicabilityInput,
): EInvoiceApplicabilityDecision {
  // Gate 1 — document type + status.
  if (
    input.documentStatus === 'VOIDED_DRAFT' ||
    input.documentStatus === 'SUPERSEDED'
  ) {
    return {
      applicable: false,
      reason: `Document status ${input.documentStatus} is not legally issued; IRP skipped.`,
    };
  }
  switch (input.documentType) {
    case 'TAX_INVOICE':
    case 'INVOICE_CUM_BILL_OF_SUPPLY':
    case 'CREDIT_NOTE':
    case 'DEBIT_NOTE':
      // Allowed; fall through to subsequent gates.
      break;
    case 'BILL_OF_SUPPLY':
      return {
        applicable: false,
        reason:
          'Bill of Supply (composition / exempt supplier) is outside the IRP scope per CBIC.',
      };
    case 'LEGACY_RECEIPT':
      return {
        applicable: false,
        reason: 'Legacy receipts are non-tax records; IRP does not apply.',
      };
    default:
      return {
        applicable: false,
        reason: `Unknown document type ${input.documentType}; IRP skipped conservatively.`,
      };
  }

  // Gate 2 — recipient type. B2C → out of IRP scope.
  if (!input.buyerGstin) {
    return {
      applicable: false,
      reason: 'Recipient has no GSTIN (B2C); IRP applies only to B2B supplies.',
    };
  }

  // Gate 3 — turnover threshold OR explicit opt-in.
  const threshold =
    input.turnoverThresholdInPaise ?? DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE;
  if (input.supplierEinvoiceOptedIn) {
    return {
      applicable: true,
      reason: 'Supplier opted in voluntarily (sub-threshold or otherwise).',
    };
  }
  if (input.supplierAggregateTurnoverInPaise > threshold) {
    return {
      applicable: true,
      reason: `Supplier turnover ${input.supplierAggregateTurnoverInPaise} > threshold ${threshold} paise.`,
    };
  }
  return {
    applicable: false,
    reason:
      `Supplier turnover ${input.supplierAggregateTurnoverInPaise} paise is below the ` +
      `${threshold}-paise IRP threshold and supplier has not opted in.`,
  };
}
