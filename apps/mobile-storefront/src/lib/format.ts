// Server returns price as a Number in rupees (already converted from
// paise on the API side). For BigInt paise values, fall back to the
// shared-utils paiseToRupeesString helper.

const RUPEE_FORMATTER = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

export function formatINR(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return '₹' + RUPEE_FORMATTER.format(Math.round(value));
}
