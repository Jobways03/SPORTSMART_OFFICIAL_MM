// Phase 92 (2026-05-23) — Return policy resolver.
//
// Picks the effective return policy for an order item by walking the
// chain Product override → Category default → Global default. Pure
// function so the eligibility service + the submit-time validator
// land on identical decisions, and so tests can exercise edge cases
// without DB plumbing.

import type { ReturnReasonCategory } from '@prisma/client';

const ALL_REASONS: ReturnReasonCategory[] = [
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'DAMAGED_IN_TRANSIT',
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'QUALITY_ISSUE',
  'OTHER',
];

// Phase 92 — Gap #19 evidence requirement matrix. The eligibility
// response surfaces this so the frontend can show "photo required"
// chips inline. Submit-time validator (return.service) cross-checks.
const REASONS_REQUIRING_EVIDENCE: ReturnReasonCategory[] = [
  'DEFECTIVE',
  'DAMAGED_IN_TRANSIT',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
];

export type ReturnPolicySource = 'PRODUCT' | 'CATEGORY' | 'GLOBAL' | 'ITEM_KIND';

export interface ResolvedReturnPolicy {
  isReturnable: boolean;
  nonReturnableReason: string | null;
  windowDays: number;
  allowedReasons: ReturnReasonCategory[];
  requiresEvidenceFor: ReturnReasonCategory[];
  allowPartialReturn: boolean;
  source: ReturnPolicySource;
}

export interface PolicyInput {
  // From OrderItem
  itemKind?:
    | 'PHYSICAL'
    | 'DIGITAL'
    | 'SERVICE'
    | 'SUBSCRIPTION'
    | 'GIFT_CARD'
    | null;
  isReturnableSnapshot?: boolean | null;
  returnWindowDaysSnapshot?: number | null;
  allowedReturnReasonsJsonSnapshot?: unknown;
  allowPartialReturnSnapshot?: boolean | null;
  nonReturnableReasonSnapshot?: string | null;
  // From Product (live)
  productIsReturnable?: boolean | null;
  productNonReturnableReason?: string | null;
  productReturnWindowDaysOverride?: number | null;
  productAllowedReturnReasonsJson?: unknown;
  productAllowPartialReturn?: boolean | null;
  // From Category (live)
  categoryIsReturnable?: boolean | null;
  categoryDefaultReturnWindowDays?: number | null;
  categoryDefaultAllowedReasonsJson?: unknown;
  // Globals
  globalWindowDays: number;
}

function normaliseReasons(raw: unknown): ReturnReasonCategory[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ReturnReasonCategory[] = [];
  for (const r of raw) {
    if (typeof r === 'string' && ALL_REASONS.includes(r as ReturnReasonCategory)) {
      out.push(r as ReturnReasonCategory);
    }
  }
  return out.length > 0 ? out : null;
}

export function resolveReturnPolicy(input: PolicyInput): ResolvedReturnPolicy {
  const itemKind = input.itemKind ?? 'PHYSICAL';

  // Phase 92 — Gap #11. Non-physical items never return through this
  // flow (digital/service refunds use their own paths).
  if (itemKind !== 'PHYSICAL') {
    return {
      isReturnable: false,
      nonReturnableReason: `${itemKind} items are not eligible for return`,
      windowDays: 0,
      allowedReasons: [],
      requiresEvidenceFor: [],
      allowPartialReturn: false,
      source: 'ITEM_KIND',
    };
  }

  // Phase 92 — Gap #20 snapshot precedence. If the order-item rows
  // captured snapshots at order time, prefer those over current
  // product/category values — retroactive policy edits don't strand
  // the customer.
  if (input.isReturnableSnapshot === false) {
    return {
      isReturnable: false,
      nonReturnableReason:
        input.nonReturnableReasonSnapshot ?? 'Item was marked non-returnable',
      windowDays: input.returnWindowDaysSnapshot ?? input.globalWindowDays,
      allowedReasons: [],
      requiresEvidenceFor: [],
      allowPartialReturn: input.allowPartialReturnSnapshot ?? true,
      source: 'PRODUCT',
    };
  }

  // Product-level override (live read; snapshot already preferred).
  if (input.productIsReturnable === false) {
    return {
      isReturnable: false,
      nonReturnableReason:
        input.productNonReturnableReason ?? 'Item is marked non-returnable',
      windowDays:
        input.productReturnWindowDaysOverride ?? input.globalWindowDays,
      allowedReasons: [],
      requiresEvidenceFor: [],
      allowPartialReturn: input.productAllowPartialReturn ?? true,
      source: 'PRODUCT',
    };
  }

  // Category-level block.
  if (input.categoryIsReturnable === false) {
    return {
      isReturnable: false,
      nonReturnableReason: 'Category does not allow returns',
      windowDays:
        input.categoryDefaultReturnWindowDays ?? input.globalWindowDays,
      allowedReasons: [],
      requiresEvidenceFor: [],
      allowPartialReturn: true,
      source: 'CATEGORY',
    };
  }

  // Returnable — resolve the window + reasons chain.
  const windowDays =
    input.returnWindowDaysSnapshot ??
    input.productReturnWindowDaysOverride ??
    input.categoryDefaultReturnWindowDays ??
    input.globalWindowDays;

  const reasonsFromSnapshot = normaliseReasons(
    input.allowedReturnReasonsJsonSnapshot,
  );
  const reasonsFromProduct = normaliseReasons(
    input.productAllowedReturnReasonsJson,
  );
  const reasonsFromCategory = normaliseReasons(
    input.categoryDefaultAllowedReasonsJson,
  );
  const allowedReasons =
    reasonsFromSnapshot ?? reasonsFromProduct ?? reasonsFromCategory ?? ALL_REASONS;

  const source: ReturnPolicySource = reasonsFromSnapshot
    ? 'PRODUCT'
    : reasonsFromProduct
      ? 'PRODUCT'
      : reasonsFromCategory
        ? 'CATEGORY'
        : 'GLOBAL';

  const requiresEvidenceFor = REASONS_REQUIRING_EVIDENCE.filter((r) =>
    allowedReasons.includes(r),
  );

  return {
    isReturnable: true,
    nonReturnableReason: null,
    windowDays,
    allowedReasons,
    requiresEvidenceFor,
    allowPartialReturn:
      input.allowPartialReturnSnapshot ??
      input.productAllowPartialReturn ??
      true,
    source,
  };
}
