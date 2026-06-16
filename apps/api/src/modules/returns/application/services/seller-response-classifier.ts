/**
 * Phase 13 (P1.8) — pure helpers for the seller-response lifecycle.
 *
 * The classifier inspects the per-item reasonCategory list on a return
 * and decides whether the seller needs a response window. Reasons split
 * into three buckets:
 *
 *   REQUIRED — the claim alleges seller fault, so the seller must get
 *     a chance to accept or contest before QC attributes liability.
 *     If no response by the deadline, the cron flips PENDING → EXPIRED
 *     and QC defaults to seller liability.
 *
 *   NOT_REQUIRED — (historical) no reason is exempt anymore. Since
 *     auto-approval was removed, EVERY reason now REQUIRES a seller
 *     response, so the exempt set below is intentionally empty.
 *
 * "Mixed" carts (some items REQUIRED, some not) escalate to REQUIRED
 * — fairness gate fires whenever any item could land on the seller.
 *
 * OTHER is intentionally REQUIRED: it's the catch-all and we'd rather
 * over-notify the seller than miss a real fault claim.
 */

export type SellerResponseRequirement = 'REQUIRED' | 'NOT_REQUIRED';

// Policy (auto-approval removed): EVERY return reason now requires a seller
// response — the seller must accept ("my fault") or contest ("not my fault")
// before QC attributes liability. Previously CHANGED_MIND / SIZE_FIT_ISSUE /
// DAMAGED_IN_TRANSIT skipped the seller window; they no longer do.
const REASONS_REQUIRING_SELLER_RESPONSE = new Set([
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'QUALITY_ISSUE',
  'OTHER',
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'DAMAGED_IN_TRANSIT',
]);

// No reason is exempt anymore (kept for the classifier's fall-through check).
const REASONS_NOT_REQUIRING_SELLER_RESPONSE = new Set<string>();

export function classifyReasonForSellerResponse(
  reasonCategories: string[],
): SellerResponseRequirement {
  if (reasonCategories.length === 0) return 'NOT_REQUIRED';
  // Any reason that could land on the seller flips the whole return
  // into REQUIRED. The "all-non-fault" path keeps the simple flow
  // (no notification, no waiting period) for changed-mind / size cases.
  for (const r of reasonCategories) {
    if (REASONS_REQUIRING_SELLER_RESPONSE.has(r)) return 'REQUIRED';
  }
  // If no reason matched REQUIRED, every reason should be in
  // NOT_REQUIRED. Unknown reasons fall through to REQUIRED below
  // (defensive default).
  for (const r of reasonCategories) {
    if (!REASONS_NOT_REQUIRING_SELLER_RESPONSE.has(r)) return 'REQUIRED';
  }
  return 'NOT_REQUIRED';
}

/**
 * Compute the seller-response deadline. Defaults to 48 hours from
 * notification (industry-standard fast lane). Caller can override
 * via env once we wire `RETURN_SELLER_RESPONSE_HOURS`.
 */
export function computeSellerResponseDueAt(
  notifiedAt: Date,
  hours = 48,
): Date {
  return new Date(notifiedAt.getTime() + hours * 60 * 60 * 1000);
}
