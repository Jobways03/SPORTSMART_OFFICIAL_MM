// Phase 9 GST — document-type picker.
//
// Decides which document a sub-order should issue based on the
// seller's GSTIN registration type and the supply mix.
//
// Indian GST rules (per docs/tax/CA.md §3 + INVOICE_CANCELLATION_POLICY.md):
//
//   Regular GST seller + all taxable supplies        → TAX_INVOICE
//   Composition seller / Unregistered seller         → BILL_OF_SUPPLY
//   Regular seller + all exempt/NIL supplies         → BILL_OF_SUPPLY
//   Regular seller + mixed taxable + exempt          → INVOICE_CUM_BILL_OF_SUPPLY
//
// LEGACY_RECEIPT is handled by a separate code path in Phase 14
// (not picked by this function).
//
// Pure function — no I/O.

import type { DocumentType, GstRegistrationType } from '@prisma/client';

export interface DocumentTypePickerInput {
  /** Seller's GSTIN registration type. Null defaults to REGULAR for
   *  OWN_BRAND / SPORTSMART suppliers (platform is registered). */
  sellerRegistrationType: GstRegistrationType | null;
  /** Whether any line on the sub-order is TAXABLE / ZERO_RATED. */
  hasTaxableLines: boolean;
  /** Whether any line is NIL_RATED / EXEMPT / NON_GST / OUT_OF_SCOPE. */
  hasExemptLines: boolean;
}

export interface DocumentTypePickerResult {
  documentType: DocumentType;
  reason: string;
}

export function pickDocumentType(input: DocumentTypePickerInput): DocumentTypePickerResult {
  const regType = input.sellerRegistrationType ?? 'REGULAR';

  // Composition / unregistered — no GST charged, always BoS.
  if (regType === 'COMPOSITION') {
    return {
      documentType: 'BILL_OF_SUPPLY',
      reason: 'Composition seller — Section 31(3)(c). No GST charged on supplies.',
    };
  }
  if (regType === 'UNREGISTERED') {
    return {
      documentType: 'BILL_OF_SUPPLY',
      reason: 'Unregistered seller — Bill of Supply issued.',
    };
  }

  // Regular seller — depends on supply mix.
  if (input.hasTaxableLines && input.hasExemptLines) {
    return {
      documentType: 'INVOICE_CUM_BILL_OF_SUPPLY',
      reason: 'Mixed taxable + exempt supply on the same sub-order — combined document per CBIC Rule 46A.',
    };
  }
  if (input.hasExemptLines && !input.hasTaxableLines) {
    return {
      documentType: 'BILL_OF_SUPPLY',
      reason: 'All supplies are exempt / NIL / non-GST — Bill of Supply per Section 31(3)(c).',
    };
  }

  // Default: regular seller, all taxable.
  return {
    documentType: 'TAX_INVOICE',
    reason: 'Regular GST registration with taxable supplies — Tax Invoice per Section 31.',
  };
}
