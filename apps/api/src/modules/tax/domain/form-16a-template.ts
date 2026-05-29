// Phase 27 IT — Form 16A HTML template.
//
// Pure rendering function — no DB, no PDF library. The caller passes
// already-resolved fields; this composes the certificate HTML that
// the marketplace issues to the deductee (seller) per Section 203 +
// Rule 31.
//
// Output is self-contained inline CSS so the file can be saved to
// disk and printed-to-PDF without a network dependency. The PDF
// storage pipeline (parallel to the existing TaxDocumentPdfService)
// is reserved for a later phase; today admins print this HTML in
// the browser and either save-as-PDF or email directly.
//
// CBDT Form 16A is prescribed; the fields below match the canonical
// columns. Real production rollouts would also embed:
//   - The deductor's TAN (Tax Deduction Account Number)
//   - A unique TDS certificate number from TIN-Protean
//   - The acknowledgement number from Form 26Q filing
// These are wired in via inputs to keep the template pure.

export interface Form16AInput {
  /** Marketplace (deductor) identity. */
  deductorName: string;
  deductorTan: string;
  deductorPan: string | null;
  deductorAddress: string;
  /** Seller (deductee) identity. */
  deducteeName: string;
  deducteePan: string | null;
  deducteePanLast4: string | null;
  /** Statutory section + period. */
  section: string;          // e.g. "194-O"
  filingPeriod: string;     // "YYYY-Qn"
  financialYear: string;    // "2026-27"
  /** Money (paise). */
  grossAmountPaidInPaise: bigint;
  tdsRateBps: number;
  tdsDeductedInPaise: bigint;
  /** Lifecycle. */
  certificateNumber: string;
  challanReference: string | null;
  dateOfDeposit: Date | null;
  dateOfIssue: Date;
}

export function renderForm16AHtml(input: Form16AInput): string {
  const ratePct = (input.tdsRateBps / 100).toFixed(2);
  const grossRupees = paiseToRupees(input.grossAmountPaidInPaise);
  const tdsRupees = paiseToRupees(input.tdsDeductedInPaise);
  const escape = (s: string | null | undefined) =>
    (s ?? '').replace(/[&<>"']/g, (c) =>
      c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : c === '>'
            ? '&gt;'
            : c === '"'
              ? '&quot;'
              : '&#39;',
    );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Form 16A — ${escape(input.certificateNumber)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; padding: 32px; max-width: 800px; margin: 0 auto; font-size: 13px; line-height: 1.6; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .subtitle { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 24px; }
  .meta { display: grid; grid-template-columns: 200px 1fr; gap: 4px 12px; margin: 12px 0; }
  .meta dt { color: #6b7280; }
  .meta dd { margin: 0; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 8px 10px; text-align: left; border: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-weight: 600; }
  .numeric { text-align: right; font-variant-numeric: tabular-nums; }
  .note { font-size: 11px; color: #6b7280; margin-top: 24px; line-height: 1.5; }
  .signature { margin-top: 48px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>

<h1>FORM NO. 16A</h1>
<p class="subtitle">
  [See rule 31(1)(b)]<br>
  Certificate of Tax Deducted at Source under Section 203 of the Income-tax Act, 1961
</p>

<h2>Certificate</h2>
<dl class="meta">
  <dt>Certificate Number</dt><dd>${escape(input.certificateNumber)}</dd>
  <dt>Section</dt><dd>${escape(input.section)}</dd>
  <dt>Financial Year</dt><dd>${escape(input.financialYear)}</dd>
  <dt>Filing Period (Quarter)</dt><dd>${escape(input.filingPeriod)}</dd>
  <dt>Date of Issue</dt><dd>${formatIstDate(input.dateOfIssue)}</dd>
</dl>

<h2>Deductor (Marketplace)</h2>
<dl class="meta">
  <dt>Name</dt><dd>${escape(input.deductorName)}</dd>
  <dt>TAN</dt><dd>${escape(input.deductorTan)}</dd>
  ${input.deductorPan ? `<dt>PAN</dt><dd>${escape(input.deductorPan)}</dd>` : ''}
  <dt>Address</dt><dd>${escape(input.deductorAddress)}</dd>
</dl>

<h2>Deductee (Seller)</h2>
<dl class="meta">
  <dt>Name</dt><dd>${escape(input.deducteeName)}</dd>
  <dt>PAN</dt><dd>${
    input.deducteePan
      ? escape(input.deducteePan)
      : input.deducteePanLast4
        ? `••••••${escape(input.deducteePanLast4)}`
        : '(not on file — TDS deducted at penalty rate)'
  }</dd>
</dl>

<h2>Tax Deducted</h2>
<table>
  <thead>
    <tr>
      <th>Gross Amount Paid / Credited</th>
      <th class="numeric">Rate (%)</th>
      <th class="numeric">Tax Deducted</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Sale value facilitated under Section 194-O</td>
      <td class="numeric">${ratePct}%</td>
      <td class="numeric">₹${grossRupees}</td>
    </tr>
    <tr style="background: #f9fafb; font-weight: 600;">
      <td>TDS Amount</td>
      <td class="numeric">—</td>
      <td class="numeric">₹${tdsRupees}</td>
    </tr>
  </tbody>
</table>

<h2>Challan / Deposit Details</h2>
<dl class="meta">
  <dt>Challan Reference (CIN)</dt><dd>${
    input.challanReference ? escape(input.challanReference) : '(pending)'
  }</dd>
  <dt>Date of Deposit</dt><dd>${
    input.dateOfDeposit ? formatIstDate(input.dateOfDeposit) : '(pending)'
  }</dd>
</dl>

<p class="note">
  This certificate is issued under Section 203 of the Income-tax Act, 1961.
  The TDS amount deducted above has been deposited with the Central
  Government. The deductee may reconcile this against Form 26AS on the
  Income-tax department's e-filing portal. The deductor's quarterly TDS
  return (Form 26Q) for the period ${escape(input.filingPeriod)} reflects
  this entry.
</p>

<div class="signature">
  <p>For ${escape(input.deductorName)}</p>
  <br><br><br>
  <p style="border-top: 1px solid #1f2937; display: inline-block; padding-top: 4px; min-width: 240px;">
    Authorised Signatory
  </p>
</div>

</body>
</html>`;
}

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const wholeStr = whole
    .toString()
    .replace(/\B(?=(\d{2})+(\d{3})(?!\d))/g, ',');
  const result = `${wholeStr}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${result}` : result;
}

function formatIstDate(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = ist.getUTCDate().toString().padStart(2, '0');
  const mm = (ist.getUTCMonth() + 1).toString().padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
