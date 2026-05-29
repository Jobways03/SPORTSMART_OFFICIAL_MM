// Phase 89 (2026-05-23) — Gap #5. HSN classes that require an EWB at
// ANY value when shipped inter-state, per CBIC Rule 138 + notification.
//
// CBIC notified ~50 HSN classes (handicrafts, job-work transfers,
// certain textiles, raw cotton, etc.) for which the ₹50,000 threshold
// is waived on inter-state movement. The platform stores the canonical
// list here so the EWB classifier can flip REQUIRED at any value for
// affected sub-orders.
//
// The list is intentionally code-side (not a DB config) because:
//   • CBIC notifications change rarely — once every few years.
//   • A miss is a CGST §122 penalty, so we want the rule book in
//     git history with a code review attached.
//   • The TaxConfig table is for operator-tunable knobs; this is a
//     statutory rule.
//
// The HSN check is conservative: a partial-prefix match (the row
// HSN starts with the rule prefix) so 4-digit and 6-digit HSN entries
// catch a wider set. Misses fall through to the value-threshold gate.

const INTER_STATE_AT_ANY_VALUE_HSN_PREFIXES = new Set<string>([
  // Handicrafts (CBIC Notification 14/2018-CT, March 2018).
  '4202', // Travel goods, handbags
  '4421', // Wooden articles
  '5208', // Cotton fabrics — bleached
  '5209', // Cotton fabrics — dyed
  '5210', // Cotton woven fabrics
  '5211', // Cotton woven fabrics — printed
  '5212', // Other woven fabrics of cotton
  '5301', // Raw flax
  '5302', // True hemp
  '5303', // Jute and other textile bast fibres
  '5304', // Sisal and other textile fibres
  '5305', // Coconut, abaca, ramie
  '5806', // Narrow woven fabrics
  '5907', // Textile fabrics, impregnated
  '6911', // Tableware, kitchenware of porcelain
  '6912', // Ceramic tableware
  '6913', // Statuettes and other ornamental ceramic articles
  '7113', // Articles of jewellery
  '7117', // Imitation jewellery
  '7326', // Other articles of iron or steel
  '7419', // Other articles of copper
  '9404', // Mattress supports
  '9504', // Articles for funfair, table games
  '9601', // Worked ivory, bone, tortoise-shell
  '9602', // Worked vegetable or mineral carving material
  '9603', // Brooms, brushes
  '9701', // Paintings, drawings, pastels
  '9702', // Original engravings, prints
  '9703', // Original sculptures
  '9705', // Collections of zoological, botanical, mineralogical
]);

/**
 * Returns true when this HSN code requires an EWB at any value for
 * inter-state movement, regardless of the headline ₹50,000 threshold.
 */
export function hsnRequiresInterStateEwb(
  hsn: string | null | undefined,
): boolean {
  if (!hsn) return false;
  const trimmed = hsn.trim();
  if (!trimmed) return false;
  // Walk down from 8 digits to 4 — CBIC notifies at the 4-digit prefix
  // level so any narrower row matches.
  for (let len = Math.min(8, trimmed.length); len >= 4; len -= 1) {
    if (INTER_STATE_AT_ANY_VALUE_HSN_PREFIXES.has(trimmed.slice(0, len))) {
      return true;
    }
  }
  return false;
}

/**
 * Same check across a list of line items. Returns true if any line's
 * HSN triggers the inter-state-at-any-value rule.
 */
export function anyLineRequiresInterStateEwb(
  hsns: ReadonlyArray<string | null | undefined>,
): boolean {
  return hsns.some(hsnRequiresInterStateEwb);
}
