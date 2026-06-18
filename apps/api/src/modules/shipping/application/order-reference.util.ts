// Shared "order reference" builder — the human-readable value printed as the
// scannable order barcode on the label AND sent to Delhivery as `order`.
//
// CRITICAL: the courier adapter (delhivery-courier.adapter.ts) and the custom
// label generator MUST produce the SAME value, or the label's order-ref barcode
// won't match what Delhivery booked. Both import this single helper so they can
// never drift.
//
// Format: "<orderNumber>-<tag>" where tag = last 6 hex of the sub-order id
// (dashes stripped, uppercased). Falls back to the raw sub-order id when no
// order number is available.
//
// REVERSE pickups (RVP) MUST get a DISTINCT order id: Delhivery dedupes on
// (client, order), so a reverse that reused the forward reference would collide
// with the original outbound shipment — Delhivery treats it as a duplicate and
// returns NO reverse AWB, silently breaking every auto-pickup. The `RVP-` prefix
// makes the reverse order unique yet still deterministic (idempotent re-booking).
// `direction` defaults to 'forward' so the label generator's existing calls are
// unchanged.

export function buildOrderReference(
  orderNumber: string | null | undefined,
  subOrderId: string,
  direction: 'forward' | 'reverse' = 'forward',
): string {
  const num = orderNumber?.trim();
  const tag = subOrderId.replace(/-/g, '').slice(-6).toUpperCase();
  const base = num ? `${num}-${tag}` : subOrderId;
  return direction === 'reverse' ? `RVP-${base}` : base;
}
