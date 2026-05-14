// Phase 18 GST — GSTR-1 aggregation primitives.
//
// Pure functions that bucket TaxDocument rows + TaxDocumentLine rows
// into the CBIC GSTR-1 sections relevant to a marketplace seller:
//
//   §4   — B2B  (buyer has GSTIN; invoice-by-invoice).
//   §5   — B2C Large (inter-state, unregistered, invoice value > ₹2.5L;
//          invoice-by-invoice).
//   §7   — B2C Small (everything else B2C; state+rate aggregate).
//   §9B  — Credit notes (one row per credit note; B2B sections also
//          include credit notes against B2B invoices — captured here).
//   §12  — HSN summary (per HSN code × rate aggregate).
//   §13  — Documents issued (count by document type).
//
// These shapes are downstream-friendly: the report service emits
// either a CSV per section or a JSON payload mirroring the NIC
// portal schema. NIC integration itself lives in a later phase.
//
// All money fields are paise. No DB / Prisma I/O here.

import type { Prisma, TaxDocument, TaxDocumentLine } from '@prisma/client';

// B2C Large threshold per CBIC: invoice value > ₹2.5L AND inter-state
// AND unregistered recipient.
const B2C_LARGE_THRESHOLD_PAISE = 2_50_000_00n;

export interface DocumentForGstr1
  extends Pick<
    TaxDocument,
    | 'id'
    | 'documentNumber'
    | 'documentType'
    | 'generatedAt'
    | 'buyerGstin'
    | 'sellerStateCode'
    | 'placeOfSupplyStateCode'
    | 'taxableAmountInPaise'
    | 'cgstAmountInPaise'
    | 'sgstAmountInPaise'
    | 'igstAmountInPaise'
    | 'cessAmountInPaise'
    | 'documentTotalInPaise'
    | 'reverseChargeApplicable'
    | 'originalDocumentNumber'
  > {
  lines?: Pick<
    TaxDocumentLine,
    | 'hsnOrSacCode'
    | 'uqcCode'
    | 'quantity'
    | 'gstRateBps'
    | 'taxableAmountInPaise'
    | 'cgstAmountInPaise'
    | 'sgstAmountInPaise'
    | 'igstAmountInPaise'
    | 'cessAmountInPaise'
    | 'totalTaxAmountInPaise'
  >[];
}

export interface B2bRow {
  documentNumber: string;
  documentDate: Date;
  buyerGstin: string;
  placeOfSupplyStateCode: string | null;
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
  invoiceValueInPaise: bigint;
  reverseChargeApplicable: boolean;
}

export interface B2cLargeRow {
  documentNumber: string;
  documentDate: Date;
  placeOfSupplyStateCode: string;
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
  invoiceValueInPaise: bigint;
}

export interface B2cSmallRow {
  placeOfSupplyStateCode: string;
  gstRateBps: number;
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
}

export interface CreditNoteRow {
  documentNumber: string;
  documentDate: Date;
  originalInvoiceNumber: string;
  buyerGstin: string | null;
  buyerType: 'B2B' | 'B2C';
  placeOfSupplyStateCode: string | null;
  taxableReversalInPaise: bigint;
  cgstReversalInPaise: bigint;
  sgstReversalInPaise: bigint;
  igstReversalInPaise: bigint;
  cessReversalInPaise: bigint;
  noteValueInPaise: bigint;
}

export interface HsnSummaryRow {
  hsnOrSacCode: string;
  uqcCode: string | null;
  gstRateBps: number;
  totalQuantity: number;
  totalValueInPaise: bigint;
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
}

export interface DocumentsIssuedRow {
  documentType: string;
  count: number;
}

export interface Gstr1Aggregate {
  b2b: B2bRow[];
  b2cLarge: B2cLargeRow[];
  b2cSmall: B2cSmallRow[];
  creditNotes: CreditNoteRow[];
  hsn: HsnSummaryRow[];
  documentsIssued: DocumentsIssuedRow[];
  totals: {
    taxableInPaise: bigint;
    cgstInPaise: bigint;
    sgstInPaise: bigint;
    igstInPaise: bigint;
    cessInPaise: bigint;
    invoiceValueInPaise: bigint;
    creditNoteValueInPaise: bigint;
  };
}

/**
 * Bucket the provided documents into GSTR-1 sections. Pure function.
 * Caller passes already-filtered rows (seller + period + supplier-type
 * pre-applied) plus their lines.
 *
 * - TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY → B2B or B2C Large/Small.
 * - CREDIT_NOTE                              → §9B rows.
 * - BILL_OF_SUPPLY / LEGACY_RECEIPT          → counted in §13 only;
 *   no tax-on-supplies bucket (zero tax content).
 */
export function aggregateGstr1(
  docs: DocumentForGstr1[],
): Gstr1Aggregate {
  const out: Gstr1Aggregate = {
    b2b: [],
    b2cLarge: [],
    b2cSmall: [],
    creditNotes: [],
    hsn: [],
    documentsIssued: [],
    totals: {
      taxableInPaise: 0n,
      cgstInPaise: 0n,
      sgstInPaise: 0n,
      igstInPaise: 0n,
      cessInPaise: 0n,
      invoiceValueInPaise: 0n,
      creditNoteValueInPaise: 0n,
    },
  };

  // §7 + §12 require aggregation; use Maps keyed by the bucket key.
  const b2cSmallMap = new Map<string, B2cSmallRow>();
  const hsnMap = new Map<string, HsnSummaryRow>();
  const docTypeMap = new Map<string, number>();

  for (const d of docs) {
    // §13 — count every document.
    docTypeMap.set(d.documentType, (docTypeMap.get(d.documentType) ?? 0) + 1);

    if (
      d.documentType === 'TAX_INVOICE' ||
      d.documentType === 'INVOICE_CUM_BILL_OF_SUPPLY'
    ) {
      const isB2B = !!d.buyerGstin;
      if (isB2B) {
        out.b2b.push({
          documentNumber: d.documentNumber,
          documentDate: d.generatedAt ?? new Date(0),
          buyerGstin: d.buyerGstin!,
          placeOfSupplyStateCode: d.placeOfSupplyStateCode,
          taxableInPaise: d.taxableAmountInPaise,
          cgstInPaise: d.cgstAmountInPaise,
          sgstInPaise: d.sgstAmountInPaise,
          igstInPaise: d.igstAmountInPaise,
          cessInPaise: d.cessAmountInPaise,
          invoiceValueInPaise: d.documentTotalInPaise,
          reverseChargeApplicable: d.reverseChargeApplicable,
        });
      } else {
        const interState =
          !!d.sellerStateCode &&
          !!d.placeOfSupplyStateCode &&
          d.sellerStateCode !== d.placeOfSupplyStateCode;
        if (
          interState &&
          d.documentTotalInPaise > B2C_LARGE_THRESHOLD_PAISE &&
          d.placeOfSupplyStateCode
        ) {
          out.b2cLarge.push({
            documentNumber: d.documentNumber,
            documentDate: d.generatedAt ?? new Date(0),
            placeOfSupplyStateCode: d.placeOfSupplyStateCode,
            taxableInPaise: d.taxableAmountInPaise,
            cgstInPaise: d.cgstAmountInPaise,
            sgstInPaise: d.sgstAmountInPaise,
            igstInPaise: d.igstAmountInPaise,
            cessInPaise: d.cessAmountInPaise,
            invoiceValueInPaise: d.documentTotalInPaise,
          });
        } else {
          // §7 B2C Small — aggregate by (state, rate). Use the
          // dominant line rate for the document; lines with
          // mixed rates split contribute to their own bucket via
          // the per-line accumulator below.
          accumulateB2cSmallFromDocument(d, b2cSmallMap);
        }
      }

      out.totals.taxableInPaise += d.taxableAmountInPaise;
      out.totals.cgstInPaise += d.cgstAmountInPaise;
      out.totals.sgstInPaise += d.sgstAmountInPaise;
      out.totals.igstInPaise += d.igstAmountInPaise;
      out.totals.cessInPaise += d.cessAmountInPaise;
      out.totals.invoiceValueInPaise += d.documentTotalInPaise;
    } else if (d.documentType === 'CREDIT_NOTE') {
      const isB2B = !!d.buyerGstin;
      out.creditNotes.push({
        documentNumber: d.documentNumber,
        documentDate: d.generatedAt ?? new Date(0),
        originalInvoiceNumber: d.originalDocumentNumber ?? '',
        buyerGstin: d.buyerGstin,
        buyerType: isB2B ? 'B2B' : 'B2C',
        placeOfSupplyStateCode: d.placeOfSupplyStateCode,
        taxableReversalInPaise: d.taxableAmountInPaise,
        cgstReversalInPaise: d.cgstAmountInPaise,
        sgstReversalInPaise: d.sgstAmountInPaise,
        igstReversalInPaise: d.igstAmountInPaise,
        cessReversalInPaise: d.cessAmountInPaise,
        noteValueInPaise: d.documentTotalInPaise,
      });
      out.totals.creditNoteValueInPaise += d.documentTotalInPaise;
    }
    // BILL_OF_SUPPLY / LEGACY_RECEIPT only contribute to §13 (already counted).

    // §12 — HSN summary across ALL document types (per-line walk).
    for (const line of d.lines ?? []) {
      if (!line.hsnOrSacCode) continue;
      const key = `${line.hsnOrSacCode}|${line.gstRateBps}`;
      const existing = hsnMap.get(key);
      const qty = decimalToNumber(line.quantity);
      if (existing) {
        existing.totalQuantity += qty;
        existing.totalValueInPaise += line.taxableAmountInPaise;
        existing.taxableInPaise += line.taxableAmountInPaise;
        existing.cgstInPaise += line.cgstAmountInPaise;
        existing.sgstInPaise += line.sgstAmountInPaise;
        existing.igstInPaise += line.igstAmountInPaise;
        existing.cessInPaise += line.cessAmountInPaise;
      } else {
        hsnMap.set(key, {
          hsnOrSacCode: line.hsnOrSacCode,
          uqcCode: line.uqcCode,
          gstRateBps: line.gstRateBps,
          totalQuantity: qty,
          totalValueInPaise: line.taxableAmountInPaise,
          taxableInPaise: line.taxableAmountInPaise,
          cgstInPaise: line.cgstAmountInPaise,
          sgstInPaise: line.sgstAmountInPaise,
          igstInPaise: line.igstAmountInPaise,
          cessInPaise: line.cessAmountInPaise,
        });
      }
    }
  }

  out.b2cSmall = Array.from(b2cSmallMap.values()).sort(
    (a, b) =>
      a.placeOfSupplyStateCode.localeCompare(b.placeOfSupplyStateCode) ||
      a.gstRateBps - b.gstRateBps,
  );
  out.hsn = Array.from(hsnMap.values()).sort(
    (a, b) =>
      a.hsnOrSacCode.localeCompare(b.hsnOrSacCode) ||
      a.gstRateBps - b.gstRateBps,
  );
  out.documentsIssued = Array.from(docTypeMap.entries())
    .map(([documentType, count]) => ({ documentType, count }))
    .sort((a, b) => a.documentType.localeCompare(b.documentType));

  return out;
}

function accumulateB2cSmallFromDocument(
  d: DocumentForGstr1,
  map: Map<string, B2cSmallRow>,
): void {
  const state = d.placeOfSupplyStateCode ?? '';
  // Aggregate by (state, rate). If lines have mixed rates we split per
  // line so the rate-wise totals are clean; if no lines are attached
  // we fall back to a single bucket using the document's CGST+SGST or
  // IGST rate (best-effort).
  if (d.lines && d.lines.length > 0) {
    for (const line of d.lines) {
      const key = `${state}|${line.gstRateBps}`;
      const existing = map.get(key);
      if (existing) {
        existing.taxableInPaise += line.taxableAmountInPaise;
        existing.cgstInPaise += line.cgstAmountInPaise;
        existing.sgstInPaise += line.sgstAmountInPaise;
        existing.igstInPaise += line.igstAmountInPaise;
        existing.cessInPaise += line.cessAmountInPaise;
      } else {
        map.set(key, {
          placeOfSupplyStateCode: state,
          gstRateBps: line.gstRateBps,
          taxableInPaise: line.taxableAmountInPaise,
          cgstInPaise: line.cgstAmountInPaise,
          sgstInPaise: line.sgstAmountInPaise,
          igstInPaise: line.igstAmountInPaise,
          cessInPaise: line.cessAmountInPaise,
        });
      }
    }
    return;
  }
  // No lines — single bucket at rate 0 (we don't know the rate; CA
  // sees this as data drift in the report).
  const key = `${state}|0`;
  const existing = map.get(key);
  if (existing) {
    existing.taxableInPaise += d.taxableAmountInPaise;
    existing.cgstInPaise += d.cgstAmountInPaise;
    existing.sgstInPaise += d.sgstAmountInPaise;
    existing.igstInPaise += d.igstAmountInPaise;
    existing.cessInPaise += d.cessAmountInPaise;
  } else {
    map.set(key, {
      placeOfSupplyStateCode: state,
      gstRateBps: 0,
      taxableInPaise: d.taxableAmountInPaise,
      cgstInPaise: d.cgstAmountInPaise,
      sgstInPaise: d.sgstAmountInPaise,
      igstInPaise: d.igstAmountInPaise,
      cessInPaise: d.cessAmountInPaise,
    });
  }
}

function decimalToNumber(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  const s = (d as Prisma.Decimal).toString();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
