// Phase 19 GST — HTML templates for tax documents.
//
// These templates are CA-DRAFT. Engineering ships a complete renderer
// shape (every CBIC-required field in the right zones) but final
// styling, supplier-side logos, and per-template legal disclaimers
// are pending CA sign-off. The template is intentionally inline-styled
// + minimal CSS so HTML→PDF renderers don't have layout surprises.
//
// One pure function per document-type bucket:
//   renderInvoiceHtml      — TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY
//   renderBillOfSupplyHtml — BILL_OF_SUPPLY (composition / exempt)
//   renderCreditNoteHtml   — CREDIT_NOTE
//   renderDebitNoteHtml    — DEBIT_NOTE
//   renderLegacyReceiptHtml— LEGACY_RECEIPT (non-tax, pre-GST history)
//
// All HTML is escaped via `e()`. No DB / Prisma I/O.

import type {
  TaxDocument,
  TaxDocumentLine,
  Prisma,
} from '@prisma/client';

export type TaxTemplateMode = 'OFF' | 'AUDIT' | 'STRICT';

export interface TemplateInput {
  /** Phase 23 — mode-aware DRAFT banner. Default 'OFF' (banner ON) so
   *  pre-Phase-23 callers don't change behaviour. The PDF service
   *  threads the resolved `TaxModeService.getMode()` value through. */
  mode?: TaxTemplateMode;
  document: Pick<
    TaxDocument,
    | 'documentNumber'
    | 'documentType'
    | 'financialYear'
    | 'invoiceType'
    | 'generatedAt'
    | 'supplierGstin'
    | 'sellerLegalName'
    | 'sellerAddressJson'
    | 'sellerStateCode'
    | 'buyerGstin'
    | 'buyerLegalName'
    | 'billingAddressJson'
    | 'shippingAddressJson'
    | 'placeOfSupplyStateCode'
    | 'reverseChargeApplicable'
    | 'reverseChargeReason'
    | 'taxableAmountInPaise'
    | 'cgstAmountInPaise'
    | 'sgstAmountInPaise'
    | 'igstAmountInPaise'
    | 'totalTaxAmountInPaise'
    | 'cessAmountInPaise'
    | 'roundOffAmountInPaise'
    | 'documentTotalInPaise'
    | 'amountInWords'
    | 'currencyCode'
    | 'paymentMode'
    | 'originalDocumentNumber'
    | 'reason'
    // Phase 22 e-invoice metadata — required on the printed invoice
    // per CBIC GST e-invoicing spec when the document was IRP-signed.
    // Nullable on documents that aren't e-invoice-applicable (B2C,
    // sub-threshold, BILL_OF_SUPPLY).
    | 'irn'
    | 'ackNo'
    | 'ackDate'
    | 'qrCodeUrl'
    | 'einvoiceStatus'
  >;
  lines: Array<
    Pick<
      TaxDocumentLine,
      | 'lineNumber'
      | 'productName'
      | 'sku'
      | 'hsnOrSacCode'
      | 'uqcCode'
      | 'quantity'
      | 'unitPriceInPaise'
      | 'discountAmountInPaise'
      | 'taxableAmountInPaise'
      | 'gstRateBps'
      | 'cgstAmountInPaise'
      | 'sgstAmountInPaise'
      | 'igstAmountInPaise'
      | 'cessAmountInPaise'
      | 'lineTotalInPaise'
    >
  >;
}

export function renderInvoiceHtml(input: TemplateInput): string {
  return baseEnvelope({
    documentTitleHeading:
      input.document.documentType === 'INVOICE_CUM_BILL_OF_SUPPLY'
        ? 'Invoice-cum-Bill of Supply'
        : 'Tax Invoice',
    input,
    showGstColumns: true,
    showTaxTotals: true,
    footerNote:
      'This is a computer-generated document. Verify GSTIN authenticity at https://www.gst.gov.in',
  });
}

export function renderBillOfSupplyHtml(input: TemplateInput): string {
  return baseEnvelope({
    documentTitleHeading: 'Bill of Supply',
    input,
    showGstColumns: false,
    showTaxTotals: false,
    footerNote:
      'Bill of Supply issued by a composition / exempt supplier. ' +
      'No GST claim applies. Verify GSTIN authenticity at https://www.gst.gov.in',
  });
}

export function renderCreditNoteHtml(input: TemplateInput): string {
  return baseEnvelope({
    documentTitleHeading: 'Credit Note',
    input,
    showGstColumns: true,
    showTaxTotals: true,
    showOriginalDocumentReference: true,
    footerNote:
      'Credit Note issued under CGST Section 34. Reduces output tax ' +
      'liability for the supplier; recipient must reverse the corresponding ' +
      'ITC if already claimed.',
  });
}

export function renderDebitNoteHtml(input: TemplateInput): string {
  return baseEnvelope({
    documentTitleHeading: 'Debit Note',
    input,
    showGstColumns: true,
    showTaxTotals: true,
    showOriginalDocumentReference: true,
    footerNote:
      'Debit Note issued under CGST Section 34. Adds to output tax ' +
      'liability for the supplier; recipient may claim the corresponding ITC.',
  });
}

export function renderLegacyReceiptHtml(input: TemplateInput): string {
  return baseEnvelope({
    documentTitleHeading: 'Legacy Order Receipt',
    input,
    showGstColumns: false,
    showTaxTotals: false,
    footerNote:
      'NON-TAX RECEIPT — predates the GST module. No GST treatment ' +
      'is claimed; the customer should treat this as a historical ' +
      'transaction record only.',
  });
}

interface EnvelopeOptions {
  documentTitleHeading: string;
  input: TemplateInput;
  showGstColumns: boolean;
  showTaxTotals: boolean;
  showOriginalDocumentReference?: boolean;
  footerNote: string;
}

function baseEnvelope(opts: EnvelopeOptions): string {
  const { input } = opts;
  const d = input.document;
  const supplierAddr = formatAddress(d.sellerAddressJson as Prisma.JsonValue | null);
  const billingAddr = formatAddress(d.billingAddressJson as Prisma.JsonValue | null);
  const shippingAddr = formatAddress(d.shippingAddressJson as Prisma.JsonValue | null);

  // Phase 23 — DRAFT banner is mode-aware. STRICT mode (CA signed off)
  // suppresses the banner so customer-facing PDFs render clean. OFF /
  // AUDIT modes keep the banner visible so dev / staging PDFs cannot
  // be mistaken for the final document.
  const showDraft = (input.mode ?? 'OFF') !== 'STRICT';
  const draftBanner = showDraft
    ? `
    <div style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404;
                padding: 8px 12px; margin-bottom: 12px; font-size: 11px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <strong>DRAFT</strong> — Template pending CA sign-off. Layout, supplier branding,
      and legal disclaimers are not final. Not for issuance to customers.
    </div>`
    : '';

  const linesRows = input.lines
    .map((l) => renderLineRow(l, opts.showGstColumns))
    .join('\n');

  const lineCount = input.lines.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${e(opts.documentTitleHeading)} — ${e(d.documentNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      color: #222;
      margin: 20px;
      line-height: 1.4;
    }
    h1 { font-size: 18px; margin: 0 0 8px 0; }
    h2 { font-size: 13px; margin: 0 0 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f4f4f5; font-weight: 600; }
    .text-right { text-align: right; }
    .totals { width: 50%; margin-left: auto; margin-top: 8px; }
    .totals td { border: none; padding: 2px 6px; }
    .totals td.label { text-align: right; }
    .totals tr.grand td { border-top: 2px solid #222; font-weight: 700; padding-top: 4px; }
    .meta { display: flex; gap: 16px; margin-top: 8px; }
    .meta-block { flex: 1; border: 1px solid #ccc; padding: 6px 8px; min-height: 80px; }
    .footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid #ccc;
              font-size: 9px; color: #555; }
  </style>
</head>
<body>
  ${draftBanner}
  <h1>${e(opts.documentTitleHeading)}</h1>
  <table class="totals" style="width: 100%; margin-top: 0;">
    <tr>
      <td class="label" style="width: 30%;">Document Number:</td>
      <td><strong>${e(d.documentNumber)}</strong></td>
      <td class="label" style="width: 20%;">Date:</td>
      <td>${formatDate(d.generatedAt)}</td>
    </tr>
    <tr>
      <td class="label">Financial Year:</td>
      <td>${e(d.financialYear)}</td>
      <td class="label">Invoice Type:</td>
      <td>${e(d.invoiceType ?? '—')}</td>
    </tr>
    ${
      opts.showOriginalDocumentReference && d.originalDocumentNumber
        ? `<tr>
             <td class="label">Original Document:</td>
             <td>${e(d.originalDocumentNumber)}</td>
             <td class="label">Reason:</td>
             <td>${e(d.reason ?? '—')}</td>
           </tr>`
        : ''
    }
    ${
      d.reverseChargeApplicable
        ? `<tr>
             <td class="label">Reverse Charge:</td>
             <td colspan="3"><strong>YES</strong> — ${e(d.reverseChargeReason ?? '')}</td>
           </tr>`
        : ''
    }
  </table>

  <div class="meta">
    <div class="meta-block">
      <h2>Supplier</h2>
      <div>${e(d.sellerLegalName ?? '—')}</div>
      <div>${supplierAddr}</div>
      <div>GSTIN: <strong>${e(d.supplierGstin ?? '—')}</strong></div>
      <div>State Code: ${e(d.sellerStateCode ?? '—')}</div>
    </div>
    <div class="meta-block">
      <h2>Billed To</h2>
      <div>${e(d.buyerLegalName ?? '—')}</div>
      <div>${billingAddr}</div>
      <div>GSTIN: <strong>${e(d.buyerGstin ?? '—')}</strong></div>
      <div>Place of Supply: ${e(d.placeOfSupplyStateCode ?? '—')}</div>
    </div>
    <div class="meta-block">
      <h2>Shipped To</h2>
      <div>${shippingAddr}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 28px;">#</th>
        <th>Description</th>
        <th>HSN/SAC</th>
        <th>UQC</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Rate (₹)</th>
        <th class="text-right">Taxable (₹)</th>
        ${opts.showGstColumns ? `
          <th class="text-right">Rate %</th>
          <th class="text-right">CGST (₹)</th>
          <th class="text-right">SGST (₹)</th>
          <th class="text-right">IGST (₹)</th>` : ''}
        <th class="text-right">Total (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${linesRows}
    </tbody>
  </table>

  <table class="totals">
    <tr><td class="label">Taxable Value:</td><td class="text-right">${paiseToRupees(d.taxableAmountInPaise)}</td></tr>
    ${
      opts.showTaxTotals
        ? `
      <tr><td class="label">CGST:</td><td class="text-right">${paiseToRupees(d.cgstAmountInPaise)}</td></tr>
      <tr><td class="label">SGST:</td><td class="text-right">${paiseToRupees(d.sgstAmountInPaise)}</td></tr>
      <tr><td class="label">IGST:</td><td class="text-right">${paiseToRupees(d.igstAmountInPaise)}</td></tr>
      <tr><td class="label">Cess:</td><td class="text-right">${paiseToRupees(d.cessAmountInPaise)}</td></tr>
      <tr><td class="label">Total Tax:</td><td class="text-right">${paiseToRupees(d.totalTaxAmountInPaise)}</td></tr>`
        : ''
    }
    <tr><td class="label">Round Off:</td><td class="text-right">${paiseToRupees(d.roundOffAmountInPaise)}</td></tr>
    <tr class="grand"><td class="label">Grand Total:</td><td class="text-right">${paiseToRupees(d.documentTotalInPaise)}</td></tr>
    ${
      d.amountInWords
        ? `<tr><td colspan="2" style="padding-top: 8px;"><em>Amount in words:</em> ${e(d.amountInWords)}</td></tr>`
        : ''
    }
  </table>

  ${renderEinvoiceBlock(d)}

  <div class="footer">
    Line items: ${lineCount} · Currency: ${e(d.currencyCode)} · Payment mode: ${e(d.paymentMode ?? '—')}<br />
    ${e(opts.footerNote)}
  </div>
</body>
</html>`;
}

/**
 * Render the e-invoice metadata block (IRN + Ack No + Ack Date + QR code).
 *
 * CBIC e-invoicing spec requires the IRN, Ack number, Ack date, and a
 * scannable QR code to appear on every printed copy of an e-invoice
 * (TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY / CREDIT_NOTE / DEBIT_NOTE
 * that fell into the e-invoice net by turnover + B2B + opt-in gates).
 *
 * The QR encodes the IRP-signed JSON content; recipients scan it to
 * verify document authenticity against the IRP without trusting our
 * PDF rendering. We store the URL the IRP returns (`qrCodeUrl`) at
 * generation time and render an `<img>` here — the PDF rendering
 * engine (Puppeteer / Playwright when wired) fetches it at render
 * time. The image is intentionally a normal `<img>` so the PDF
 * binary embeds the bitmap.
 *
 * Returns an empty string for documents that didn't get an IRN
 * (B2C, sub-threshold sellers, BILL_OF_SUPPLY, LEGACY_RECEIPT).
 */
function renderEinvoiceBlock(d: TemplateInput['document']): string {
  // einvoiceStatus values: NOT_APPLICABLE | PENDING | GENERATED | FAILED |
  // CANCELLED. The full IRN/QR block renders only on GENERATED; for the
  // other in-scope states we render a small status badge (Phase 160 #21)
  // so the customer/seller isn't left guessing why there's no IRN. A
  // NOT_APPLICABLE document (B2C / below-threshold) shows nothing.
  if (d.einvoiceStatus !== 'GENERATED' || !d.irn) {
    const badge = (text: string, bg: string, fg: string): string => `
  <div class="einvoice-badge" style="margin-top:18px; padding:8px 12px; border:1px solid ${fg}33; border-radius:6px; background:${bg}; color:${fg}; font-size:11px; font-weight:600;">
    ${e(text)}
  </div>`;
    switch (d.einvoiceStatus) {
      case 'PENDING':
        return badge('e-Invoice: IRN registration pending with the IRP.', '#fffbeb', '#92400e');
      case 'FAILED':
        return badge('e-Invoice: IRN registration failed — automatic retry in progress.', '#fef2f2', '#b91c1c');
      case 'CANCELLED':
        return badge('e-Invoice: IRN was cancelled (revoked at the IRP).', '#f3f4f6', '#525a65');
      default:
        return ''; // NOT_APPLICABLE — no badge.
    }
  }

  const ackDateFmt = d.ackDate
    ? new Date(d.ackDate).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

  const qrImage = d.qrCodeUrl
    ? `<img src="${e(d.qrCodeUrl)}" alt="IRN QR Code — scan to verify on IRP" width="140" height="140" style="border:1px solid #d0d7de; padding:4px; background:#fff;" />`
    : `<div style="width:140px; height:140px; border:1px dashed #d0d7de; padding:8px; font-size:10px; color:#888; text-align:center; box-sizing:border-box;">QR pending — fetch from IRP if needed</div>`;

  return `
  <div class="einvoice-block" style="margin-top:18px; padding:12px 14px; border:1px solid #d0d7de; border-radius:6px; background:#fafbfc; display:flex; gap:16px; align-items:flex-start;">
    <div style="flex-shrink:0;">
      ${qrImage}
    </div>
    <div style="flex:1; font-size:11px; line-height:1.5;">
      <div style="font-weight:600; margin-bottom:4px; font-size:12px;">e-Invoice (CBIC IRP)</div>
      <div><span style="color:#666;">IRN:</span> <code style="word-break:break-all;">${e(d.irn)}</code></div>
      <div><span style="color:#666;">Ack No:</span> ${e(d.ackNo ?? '—')}</div>
      <div><span style="color:#666;">Ack Date:</span> ${e(ackDateFmt)} IST</div>
      <div style="margin-top:6px; color:#555; font-style:italic;">
        Scan the QR with the GSTN e-Invoice mobile app or any compliant
        scanner to verify this invoice against the Invoice Registration
        Portal (IRP).
      </div>
    </div>
  </div>`;
}

function renderLineRow(
  l: TemplateInput['lines'][number],
  showGst: boolean,
): string {
  const qty = decimalToString(l.quantity);
  const ratePct = (l.gstRateBps / 100).toFixed(2);
  const gstCols = showGst
    ? `
      <td class="text-right">${ratePct}</td>
      <td class="text-right">${paiseToRupees(l.cgstAmountInPaise)}</td>
      <td class="text-right">${paiseToRupees(l.sgstAmountInPaise)}</td>
      <td class="text-right">${paiseToRupees(l.igstAmountInPaise)}</td>`
    : '';
  return `<tr>
    <td>${l.lineNumber}</td>
    <td>${e(l.productName)}${l.sku ? `<br /><small style="color:#666;">SKU: ${e(l.sku)}</small>` : ''}</td>
    <td>${e(l.hsnOrSacCode ?? '—')}</td>
    <td>${e(l.uqcCode ?? '—')}</td>
    <td class="text-right">${e(qty)}</td>
    <td class="text-right">${paiseToRupees(l.unitPriceInPaise)}</td>
    <td class="text-right">${paiseToRupees(l.taxableAmountInPaise)}</td>${gstCols}
    <td class="text-right">${paiseToRupees(l.lineTotalInPaise)}</td>
  </tr>`;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** HTML-escape — minimal but safe. The renderer never injects raw
 *  user-supplied HTML; every interpolated value runs through this. */
function e(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paiseToRupees(p: bigint | number): string {
  const big = typeof p === 'bigint' ? p : BigInt(p);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${formatIndianGrouping(whole)}.${cents.toString().padStart(2, '0')}`;
  return negative ? `(${rupees})` : rupees;
}

/** Indian numbering grouping: 1,23,45,678 (lakh/crore). */
function formatIndianGrouping(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const groups = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  return `${groups.join(',')},${last3}`;
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  const d = new Date(date);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dd = ist.getUTCDate().toString().padStart(2, '0');
  const mm = (ist.getUTCMonth() + 1).toString().padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function decimalToString(d: Prisma.Decimal | number | null | undefined): string {
  if (d == null) return '0';
  if (typeof d === 'number') return d.toString();
  return (d as Prisma.Decimal).toString();
}

function formatAddress(json: Prisma.JsonValue | null | undefined): string {
  if (!json || typeof json !== 'object') return '';
  const obj = json as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['line1', 'line2', 'city', 'state', 'pincode', 'country']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return e(parts.join(', '));
}

/**
 * Pick the right template for the document type. Throws on unknown
 * type so callers don't silently render an empty page.
 */
export function renderHtmlForDocument(input: TemplateInput): string {
  switch (input.document.documentType) {
    case 'TAX_INVOICE':
    case 'INVOICE_CUM_BILL_OF_SUPPLY':
      return renderInvoiceHtml(input);
    case 'BILL_OF_SUPPLY':
      return renderBillOfSupplyHtml(input);
    case 'CREDIT_NOTE':
      return renderCreditNoteHtml(input);
    case 'DEBIT_NOTE':
      return renderDebitNoteHtml(input);
    case 'LEGACY_RECEIPT':
      return renderLegacyReceiptHtml(input);
    default:
      throw new Error(
        `No template registered for documentType ${input.document.documentType}`,
      );
  }
}
