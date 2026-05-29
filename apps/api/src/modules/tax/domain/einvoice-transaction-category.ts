// Phase 90 (2026-05-23) — Gap #12.
//
// Resolve the NIC e-invoice `subSupplyType` discriminator from the
// document's GSTIN profile. CBIC's IRP schema requires one of:
//   B2B      — domestic supply to a GSTIN-registered buyer
//   SEZWP    — Special Economic Zone with IGST payment
//   SEZWOP   — Special Economic Zone without payment (LUT)
//   EXPWP    — Export with IGST payment
//   EXPWOP   — Export without payment (LUT)
//   DEXP     — Deemed export
//
// SEZ buyer GSTINs carry the third character '9' in their format
// (the type-code position per CBIC GSTIN structure). Export-class
// invoices typically have buyer GSTIN = 'URP' (Unregistered Person)
// flag — but since our intake validator (gstin-validator.ts) rejects
// 'URP' strings, exports today only enter the system via explicit
// `documentType=TAX_INVOICE` + missing buyer GSTIN, which the
// applicability gate already filters as B2C. So the resolver returns
// 'B2B' for everything that reaches NIC; SEZ detection is the
// auto-classified split.

import type { EInvoiceTransactionCategory } from '../infrastructure/einvoice/einvoice-provider';

export function resolveTransactionCategory(input: {
  buyerGstin: string | null | undefined;
  reverseChargeApplicable: boolean;
}): EInvoiceTransactionCategory {
  if (!input.buyerGstin) return 'B2B'; // upstream gate already rejected
  const trimmed = input.buyerGstin.trim().toUpperCase();
  // SEZ GSTIN format — position 11 (1-indexed) is '9' for SEZ units.
  // CBIC structure: 2-digit state + 10-char PAN + entity# + 'Z' + checksum.
  // SEZ buyers have entity# = '9' regardless of registration sequence.
  // GSTIN format: 2 state + 10 PAN + 1 entity-seq + 'Z' + 1 checksum.
  // 0-indexed position 12 = entity-seq char; '9' marks SEZ units.
  if (trimmed.length === 15 && trimmed.charAt(12) === '9') {
    return input.reverseChargeApplicable ? 'SEZWOP' : 'SEZWP';
  }
  return 'B2B';
}
