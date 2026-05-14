// Phase 9 GST — amount-in-words helper.
//
// Renders an integer-paise amount as an Indian-numbering-system English
// string suitable for the "Amount in words" line on every tax invoice.
//
// Format follows the CBIC convention:
//   1,23,45,678 paise  →  "Indian Rupees One Lakh Twenty Three Thousand
//                          Four Hundred Fifty Six and Seventy Eight
//                          Paise Only"
//
// Pure function — no I/O.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five',
  'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
  'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function threeDigit(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return twoDigit(r);
  if (r === 0) return `${ONES[h]} Hundred`;
  return `${ONES[h]} Hundred ${twoDigit(r)}`;
}

/**
 * Convert a non-negative integer (rupees portion only) to its
 * Indian-numbering English form. Examples:
 *   0          → "Zero"
 *   1          → "One"
 *   100        → "One Hundred"
 *   1234       → "One Thousand Two Hundred Thirty Four"
 *   100000     → "One Lakh"
 *   12345678   → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"
 *   1234567890 → "One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety"
 */
export function rupeesToWords(rupees: number): string {
  if (!Number.isInteger(rupees) || rupees < 0) {
    throw new Error('rupeesToWords expects a non-negative integer');
  }
  if (rupees === 0) return 'Zero';

  const parts: string[] = [];

  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  if (crore > 0) parts.push(`${threeDigit(crore)} Crore`);

  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  if (lakh > 0) parts.push(`${twoDigit(lakh)} Lakh`);

  const thousand = Math.floor(rupees / 1_000);
  rupees %= 1_000;
  if (thousand > 0) parts.push(`${twoDigit(thousand)} Thousand`);

  if (rupees > 0) parts.push(threeDigit(rupees));

  return parts.join(' ');
}

/**
 * Render a paise amount (BigInt) in the canonical CBIC invoice form.
 *   amountInPaise: BigInt (always ≥ 0)
 *   currency:      'INR' for the standard label "Indian Rupees ... and ... Paise Only"
 *
 * Returns a string like:
 *   "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"
 *
 * Special cases:
 *   - 0 paise total          → "Indian Rupees Zero Only"
 *   - 0 paise component      → "Indian Rupees X Only" (no Paise tail)
 *   - 0 rupees, n paise > 0  → "Indian Rupees Zero and N Paise Only"
 */
export function paiseToInvoiceWords(amountInPaise: bigint, currency: 'INR' = 'INR'): string {
  if (amountInPaise < 0n) {
    throw new Error('paiseToInvoiceWords expects a non-negative BigInt');
  }
  const total = Number(amountInPaise);
  if (!Number.isSafeInteger(total)) {
    // Paise totals above 2^53 are unrepresentable; this is intentional —
    // any single invoice exceeding ~₹90 trillion shouldn't be rendered
    // by this helper. Use a more careful split for ledger sums.
    throw new Error(
      `paiseToInvoiceWords: amount ${amountInPaise} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  const prefix = currency === 'INR' ? 'Indian Rupees' : currency;
  const rupeesWord = rupeesToWords(rupees);
  if (paise === 0) return `${prefix} ${rupeesWord} Only`;
  const paiseWord = twoDigit(paise);
  return `${prefix} ${rupeesWord} and ${paiseWord} Paise Only`;
}
