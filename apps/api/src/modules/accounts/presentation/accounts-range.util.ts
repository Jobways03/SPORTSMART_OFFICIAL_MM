import { BadRequestAppException } from '../../../core/exceptions';

// Phase 175/176 — shared date-range parsing for the accounts dashboards.
// `toDate` given as a bare YYYY-MM-DD is treated as INCLUSIVE end-of-day (#17);
// an invalid date is a 400 (#6); the window is capped (#15).
const MAX_RANGE_DAYS = 366;

export function parseAccountsDate(
  raw: string | undefined,
  kind: 'from' | 'to',
): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestAppException(`${kind}Date is not a valid date`);
  }
  if (kind === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return d;
}

export function parseAccountsRange(q: {
  fromDate?: string;
  toDate?: string;
}): { from?: Date; to?: Date } {
  const from = parseAccountsDate(q.fromDate, 'from');
  const to = parseAccountsDate(q.toDate, 'to');
  if (from && to) {
    if (to < from) {
      throw new BadRequestAppException('toDate must be on or after fromDate');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestAppException(
        `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
      );
    }
  }
  return { from, to };
}
