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

export function buildOrderReference(
  orderNumber: string | null | undefined,
  subOrderId: string,
): string {
  const num = orderNumber?.trim();
  const tag = subOrderId.replace(/-/g, '').slice(-6).toUpperCase();
  return num ? `${num}-${tag}` : subOrderId;
}
