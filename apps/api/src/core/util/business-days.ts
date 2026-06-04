/**
 * Phase 178 (Outstanding Payables audit #10) — business-day date math for
 * settlement SLA derivation. `addBusinessDays` skips weekends (Sat/Sun) and a
 * configured bank-holiday set; used to compute a settlement's `payoutDueBy` from
 * the cycle's `periodEnd`. Holidays are ISO `YYYY-MM-DD` strings (UTC date).
 */
export function addBusinessDays(
  start: Date,
  n: number,
  holidays: ReadonlySet<string> = new Set(),
): Date {
  const d = new Date(start.getTime());
  if (n <= 0) return d;
  let added = 0;
  // Guard against an absurd n / an all-holiday config running away.
  let guard = 0;
  while (added < n && guard < n * 7 + 366) {
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
    const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
    if (day === 0 || day === 6) continue;
    if (holidays.has(d.toISOString().slice(0, 10))) continue;
    added++;
  }
  return d;
}

/** Parse a comma/space/newline-separated list of ISO dates into a Set. */
export function parseHolidaySet(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
}
