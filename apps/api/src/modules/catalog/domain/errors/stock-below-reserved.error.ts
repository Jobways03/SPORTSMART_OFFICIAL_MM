/**
 * Phase 1 (PR 1.10) — CSV stock-import floor.
 *
 * Domain error thrown by `bulkUpdateStock` when one or more rows in
 * the batch would push `stockQty` below the row's existing
 * `reservedQty`. A seller's reserved units represent stock already
 * committed to in-flight customer orders — driving stockQty below
 * that count silently oversells.
 *
 * Pre-PR behaviour: the bulk endpoint validated `stockQty >= 0` but
 * not against `reservedQty`. A CSV upload with `stockQty=5` on a row
 * holding `reservedQty=10` would land, and the next checkout for
 * that variant would draw on negative-available inventory — the
 * customer sees "in stock", places the order, and the seller has
 * nothing to ship.
 *
 * Why throw (rather than return a violation list): the repo wraps the
 * floor check + writes in `prisma.$transaction`. Throwing from inside
 * the callback aborts the whole transaction, so a CSV import with one
 * bad row leaves the catalog untouched. A partial-success return
 * would commit some rows and leave the seller with a half-imported
 * catalog — harder to recover from than a clean rejection.
 *
 * The controller catches this error and translates it to a 400
 * response listing every offending mapping (not just the first), so
 * the seller can fix the whole CSV in one revision instead of one
 * round-trip per row.
 */
export interface StockBelowReservedViolation {
  mappingId: string;
  requestedStock: number;
  reservedQty: number;
}

export class StockBelowReservedError extends Error {
  readonly name = 'StockBelowReservedError';

  constructor(public readonly violations: StockBelowReservedViolation[]) {
    super(
      `Stock import rejected — ${violations.length} mapping(s) would fall below reserved stock`,
    );
  }
}
