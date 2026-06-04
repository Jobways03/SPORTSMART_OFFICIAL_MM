// Phase 160 — GST §52 TCS certificate HTML template.
//
// Pure rendering function — no DB, no PDF library — mirroring the
// Form 16A template used by the §194-O TDS flow. The caller passes
// already-resolved fields; this composes the certificate HTML the
// marketplace (e-commerce operator) furnishes to the supplier per
// GST §52(5).
//
// Unlike income-tax TDS (which has the prescribed Form 16A), GST §52
// has no separate prescribed certificate form — the operator furnishes
// the GSTR-8 detail to the supplier so the supplier can claim the TCS
// credit in their electronic cash ledger and reconcile against GSTR-2A.
// This template renders that detail in a clean, printable layout.
//
// Output is self-contained inline CSS so the file can be saved to disk
// and printed-to-PDF without a network dependency (same convention as
// form-16a-template.ts).

export interface GstTcsCertificateInput {
  /** Operator (collector) identity. */
  operatorName: string;
  operatorGstin: string | null;
  operatorAddress: string;
  /** Supplier (deductee) identity. */
  supplierName: string;
  supplierGstin: string | null;
  /** Statutory period. */
  filingPeriod: string; // "YYYY-MM"
  financialYear: string; // "2026-27"
  /** Money (paise). */
  grossTaxableInPaise: bigint;
  netTaxableInPaise: bigint;
  tcsRateBps: number;
  cgstTcsInPaise: bigint;
  sgstTcsInPaise: bigint;
  igstTcsInPaise: bigint;
  totalTcsInPaise: bigint;
  /** Lifecycle. */
  certificateNumber: string;
  /** GSTN GSTR-8 acknowledgement (ARN) — proves the return was filed. */
  nicArn: string | null;
  /** Government remittance reference (challan / CIN / UTR). */
  paymentReference: string | null;
  dateOfIssue: Date;
  /** True once the row is fully certificate-issued (vs. a draft preview). */
  isIssued: boolean;
}

export function renderGstTcsCertificateHtml(
  input: GstTcsCertificateInput,
): string {
  const ratePct = (input.tcsRateBps / 100).toFixed(2);
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

  const draftBanner = input.isIssued
    ? ''
    : `<div style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 12px;border-radius:8px;margin-bottom:16px;font-size:12px;font-weight:600;">
    PREVIEW — this certificate has not yet been formally issued. The
    certificate number shown is provisional until the row is marked
    CERTIFICATE_ISSUED.
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GST TCS Certificate — ${escape(input.certificateNumber)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; padding: 32px; max-width: 800px; margin: 0 auto; font-size: 13px; line-height: 1.6; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .subtitle { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 24px; }
  .meta { display: grid; grid-template-columns: 220px 1fr; gap: 4px 12px; margin: 12px 0; }
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

${draftBanner}
<h1>CERTIFICATE OF TAX COLLECTED AT SOURCE</h1>
<p class="subtitle">
  Under Section 52 of the Central Goods and Services Tax Act, 2017<br>
  (Tax Collected at Source by an Electronic Commerce Operator)
</p>

<h2>Certificate</h2>
<dl class="meta">
  <dt>Certificate Number</dt><dd>${escape(input.certificateNumber)}</dd>
  <dt>Financial Year</dt><dd>${escape(input.financialYear)}</dd>
  <dt>Tax Period (Month)</dt><dd>${escape(input.filingPeriod)}</dd>
  <dt>GSTR-8 Acknowledgement (ARN)</dt><dd>${
    input.nicArn ? escape(input.nicArn) : '(pending)'
  }</dd>
  <dt>Date of Issue</dt><dd>${formatIstDate(input.dateOfIssue)}</dd>
</dl>

<h2>Electronic Commerce Operator (Collector)</h2>
<dl class="meta">
  <dt>Name</dt><dd>${escape(input.operatorName)}</dd>
  <dt>GSTIN</dt><dd>${
    input.operatorGstin ? escape(input.operatorGstin) : '(not on file)'
  }</dd>
  <dt>Address</dt><dd>${escape(input.operatorAddress)}</dd>
</dl>

<h2>Supplier (Deductee)</h2>
<dl class="meta">
  <dt>Name</dt><dd>${escape(input.supplierName)}</dd>
  <dt>GSTIN</dt><dd>${
    input.supplierGstin ? escape(input.supplierGstin) : '(not on file)'
  }</dd>
</dl>

<h2>Tax Collected at Source</h2>
<table>
  <thead>
    <tr>
      <th>Particulars</th>
      <th class="numeric">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gross value of taxable supplies</td>
      <td class="numeric">₹${paiseToRupees(input.grossTaxableInPaise)}</td>
    </tr>
    <tr>
      <td>Net value of taxable supplies (after credit/debit notes)</td>
      <td class="numeric">₹${paiseToRupees(input.netTaxableInPaise)}</td>
    </tr>
    <tr>
      <td>Rate of TCS</td>
      <td class="numeric">${ratePct}%</td>
    </tr>
    <tr>
      <td>CGST collected</td>
      <td class="numeric">₹${paiseToRupees(input.cgstTcsInPaise)}</td>
    </tr>
    <tr>
      <td>SGST/UTGST collected</td>
      <td class="numeric">₹${paiseToRupees(input.sgstTcsInPaise)}</td>
    </tr>
    <tr>
      <td>IGST collected</td>
      <td class="numeric">₹${paiseToRupees(input.igstTcsInPaise)}</td>
    </tr>
    <tr style="background: #f9fafb; font-weight: 700;">
      <td>Total TCS collected</td>
      <td class="numeric">₹${paiseToRupees(input.totalTcsInPaise)}</td>
    </tr>
  </tbody>
</table>

<h2>Government Remittance</h2>
<dl class="meta">
  <dt>Payment Reference (CIN / UTR)</dt><dd>${
    input.paymentReference ? escape(input.paymentReference) : '(pending)'
  }</dd>
</dl>

<p class="note">
  This certificate is furnished by the electronic commerce operator under
  Section 52(5) of the CGST Act, 2017. The TCS amount shown above has been
  collected at source on the net value of taxable supplies made by the
  supplier through the operator's platform during the tax period
  ${escape(input.filingPeriod)} and reported in the operator's GSTR-8 for
  that period. The supplier may claim credit of the TCS in their electronic
  cash ledger and reconcile this against the auto-populated Form GSTR-2A on
  the GST portal.
</p>

<div class="signature">
  <p>For ${escape(input.operatorName)}</p>
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
