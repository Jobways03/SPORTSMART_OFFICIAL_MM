import 'reflect-metadata';
import {
  section34CutoffFor,
  isWithinSection34Window,
} from '../../src/modules/tax/domain/credit-note-time-bar';

// Phase 11 GST — Section 34 time-bar tests.
// Cutoff: 30 September of FY following the invoice's FY, end-of-day IST.

describe('section34CutoffFor', () => {
  it('invoice on 1 Apr 2026 IST (start of FY 2026-27) → cutoff 30 Sept 2027 IST', () => {
    // 1 Apr 2026 IST = 31 Mar 2026 18:30 UTC
    const invoiceDate = new Date(Date.UTC(2026, 2, 31, 18, 30, 0));
    const cutoff = section34CutoffFor(invoiceDate);
    // 30 Sept 2027 23:59:59.999 IST = 30 Sept 2027 18:29:59.999 UTC
    expect(cutoff.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });

  it('invoice on 31 Mar 2027 IST (last day of FY 2026-27) → cutoff 30 Sept 2027 IST', () => {
    // 31 Mar 2027 23:59 IST = 31 Mar 2027 18:29 UTC
    const invoiceDate = new Date(Date.UTC(2027, 2, 31, 18, 29, 0));
    const cutoff = section34CutoffFor(invoiceDate);
    expect(cutoff.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });

  it('invoice on 1 Apr 2027 IST (start of FY 2027-28) → cutoff 30 Sept 2028 IST', () => {
    const invoiceDate = new Date(Date.UTC(2027, 2, 31, 18, 30, 0));
    const cutoff = section34CutoffFor(invoiceDate);
    expect(cutoff.toISOString()).toBe('2028-09-30T18:29:59.999Z');
  });

  it('invoice mid-financial-year (Aug 2026 IST) → cutoff 30 Sept 2027 IST', () => {
    const invoiceDate = new Date(Date.UTC(2026, 7, 15, 6, 0, 0));
    const cutoff = section34CutoffFor(invoiceDate);
    expect(cutoff.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });

  it('invoice on 15 Feb 2027 IST (FY 2026-27) → cutoff 30 Sept 2027 IST', () => {
    // Jan/Feb/Mar of YYYY+1 are still part of FY YYYY-(YY+1).
    const invoiceDate = new Date(Date.UTC(2027, 1, 15, 6, 0, 0));
    const cutoff = section34CutoffFor(invoiceDate);
    expect(cutoff.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });
});

describe('isWithinSection34Window', () => {
  it('return on 1 Sept 2027 against invoice from FY 2026-27 → within window', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));   // Jun 2026
    const now = new Date(Date.UTC(2027, 8, 1));            // 1 Sept 2027
    expect(isWithinSection34Window(invoiceDate, now)).toBe(true);
  });

  it('return on 30 Sept 2027 23:59:59 IST → within window (exactly at cutoff)', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));
    // 30 Sept 2027 23:59:59 IST = 30 Sept 2027 18:29:59 UTC
    const now = new Date(Date.UTC(2027, 8, 30, 18, 29, 59));
    expect(isWithinSection34Window(invoiceDate, now)).toBe(true);
  });

  it('return on 1 Oct 2027 00:00 IST → past window (one second after cutoff)', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));
    // 1 Oct 2027 00:00 IST = 30 Sept 2027 18:30 UTC
    const now = new Date(Date.UTC(2027, 8, 30, 18, 30, 0));
    expect(isWithinSection34Window(invoiceDate, now)).toBe(false);
  });

  it('return on 2 Oct 2027 → past window', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));
    const now = new Date(Date.UTC(2027, 9, 2));
    expect(isWithinSection34Window(invoiceDate, now)).toBe(false);
  });

  it('return in the next FY (Apr 2028) against FY 2026-27 invoice → past window', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));
    const now = new Date(Date.UTC(2028, 3, 1));
    expect(isWithinSection34Window(invoiceDate, now)).toBe(false);
  });

  it('return same day as invoice → within window', () => {
    const invoiceDate = new Date(Date.UTC(2026, 5, 15));
    expect(isWithinSection34Window(invoiceDate, invoiceDate)).toBe(true);
  });
});
