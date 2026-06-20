import { BadRequestAppException } from '../exceptions';

/**
 * Explicit allowed-transitions maps for the application's status enums.
 *
 * Why this exists: status transitions used to be enforced ad-hoc with `if`
 * checks scattered across services. Background jobs working off stale state
 * could push an order from CANCELLED back to PLACED, or skip steps in the
 * fulfillment chain. This module centralises the rules so every status
 * update goes through the same validator.
 *
 * Adding a new transition?
 *   1. Add it to the matching map below.
 *   2. Add a unit test in `test/unit/status-transitions.spec.ts`.
 *
 * Removing a transition? Search the codebase for the source state — there's
 * almost certainly a service method that needs to handle the removal too.
 */

// ── OrderStatus (master order top-level lifecycle) ─────────────────────────

export type OrderStatus =
  // Phase 0 (PR 0.8) — `PENDING_PAYMENT` exists in the Prisma enum
  // (`_base.prisma`) but was missing from the FSM type. Adding it so
  // `verifyPayment` can assert PENDING_PAYMENT → PLACED at the FSM
  // layer rather than relying on the `findFirst` filter alone.
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'ROUTED_TO_SELLER'
  | 'SELLER_ACCEPTED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED'
  // Phase 74 (2026-05-22) — verifier-initiated rejection. Distinct
  // from CANCELLED so refund saga + analytics can branch.
  | 'REJECTED'
  | 'EXCEPTION_QUEUE'
  // Phase 81 (2026-05-22) — cancel audit Gap #6/#20. Set when some
  // but not all sub-orders have been cancelled. From here the master
  // can still progress (PARTIALLY_CANCELLED → DELIVERED for the
  // remaining sub-orders) or go fully CANCELLED if the last active
  // sub-order is later cancelled too.
  | 'PARTIALLY_CANCELLED'
  // Phase 82 (2026-05-23) — pack/ship audit Gap #12/#13. Master is
  // mid-shipment: at least one sub-order is SHIPPED but at least one
  // is still UNFULFILLED/PACKED. Resolves to DISPATCHED once every
  // active sub-order has shipped.
  | 'PARTIALLY_SHIPPED'
  // Phase 83 (2026-05-23) — delivery audit. Master is mid-delivery:
  // some sub-orders delivered, others still in transit. Resolves to
  // DELIVERED when the last sub-order arrives.
  | 'PARTIALLY_DELIVERED';

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Initial state for ONLINE orders awaiting gateway capture.
  // Canonical happy path is PENDING_PAYMENT → PLACED (via verifyPayment).
  // Auto-cancel on payment-window expiry routes to CANCELLED.
  PENDING_PAYMENT: ['PLACED', 'CANCELLED'],
  // PARTIALLY_CANCELLED is reachable from the pre-routing states too: an admin
  // can cancel SOME sub-orders of a PLACED / PENDING_VERIFICATION order before
  // it's routed. Pre-fix the roll-up computed PARTIALLY_CANCELLED but the FSM
  // rejected it from here, so the master silently stayed PLACED while a
  // sub-order showed CANCELLED — the "cancelled order still looks active" bug.
  PLACED: ['PENDING_VERIFICATION', 'VERIFIED', 'CANCELLED', 'REJECTED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED'],
  PENDING_VERIFICATION: ['VERIFIED', 'CANCELLED', 'REJECTED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED'],
  VERIFIED: ['ROUTED_TO_SELLER', 'CANCELLED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED'],
  ROUTED_TO_SELLER: ['SELLER_ACCEPTED', 'CANCELLED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED'],
  // Phase 82 — SELLER_ACCEPTED → PARTIALLY_SHIPPED when first sub-order
  // ships and others still pending.
  SELLER_ACCEPTED: ['DISPATCHED', 'CANCELLED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED', 'PARTIALLY_SHIPPED'],
  // Phase 81 — DISPATCHED can also become PARTIALLY_CANCELLED if a
  // SHIPPED sub-order gets force-cancelled (rare but legal). The
  // remaining sub-orders continue to DELIVERED.
  // Phase 83 — DISPATCHED → PARTIALLY_DELIVERED when first sub-order
  // arrives but others still in transit.
  // Phase 90 (2026-06-03) — added 'CANCELLED' so an admin force-cancel of a
  // dispatched order's LAST/ONLY sub-order rolls the master FULLY to CANCELLED
  // (mirrors the sub-order FSM's SHIPPED → CANCELLED force-cancel edge).
  // Without it the master stuck at DISPATCHED while the sub-order showed
  // CANCELLED, so the admin list/detail + customer page disagreed.
  DISPATCHED: ['DELIVERED', 'CANCELLED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED', 'PARTIALLY_DELIVERED'],
  // Phase 81 — PARTIALLY_CANCELLED can resolve either way:
  //   • last remaining sub-order delivers → DELIVERED
  //   • last remaining sub-order cancels → CANCELLED
  //   • anything goes wrong → EXCEPTION_QUEUE
  PARTIALLY_CANCELLED: ['DELIVERED', 'CANCELLED', 'DISPATCHED', 'EXCEPTION_QUEUE'],
  // Phase 82 — PARTIALLY_SHIPPED resolves to DISPATCHED once the last
  // remaining sub-order ships, or to PARTIALLY_CANCELLED / CANCELLED
  // if a pending sub-order gets cancelled instead.
  // Phase 83 — also → PARTIALLY_DELIVERED when one of the shipped
  // sub-orders arrives while others are still in transit.
  PARTIALLY_SHIPPED: ['DISPATCHED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  // Phase 83 — PARTIALLY_DELIVERED resolves to DELIVERED when the
  // last sub-order arrives, or to CANCELLED / PARTIALLY_CANCELLED
  // if a pending sub-order gets cancelled instead.
  PARTIALLY_DELIVERED: ['DELIVERED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  // Terminal states — no transitions out.
  DELIVERED: [],
  CANCELLED: [],
  REJECTED: [],
  // EXCEPTION_QUEUE is a manual-recovery state. Admins can push it back into
  // the flow, so we allow it to leave to most non-terminal states.
  EXCEPTION_QUEUE: [
    'VERIFIED',
    'ROUTED_TO_SELLER',
    'SELLER_ACCEPTED',
    'DISPATCHED',
    'CANCELLED',
    'REJECTED',
    'PARTIALLY_CANCELLED',
    'PARTIALLY_SHIPPED',
    'PARTIALLY_DELIVERED',
  ],
};

// ── OrderFulfillmentStatus (per-sub-order fulfillment lifecycle) ───────────

export type OrderFulfillmentStatus =
  | 'UNFULFILLED'
  | 'PACKED'
  | 'SHIPPED'
  | 'FULFILLED'
  | 'DELIVERED'
  | 'CANCELLED';

const FULFILLMENT_STATUS_TRANSITIONS: Record<
  OrderFulfillmentStatus,
  readonly OrderFulfillmentStatus[]
> = {
  UNFULFILLED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  // Phase 81 (2026-05-22) — cancel audit Gap #8. SHIPPED + FULFILLED
  // can transition to CANCELLED via the admin force-cancel path.
  // The application layer guards this with the
  // `orders.subOrder.cancel.force` permission so a default
  // sub-order-cancel admin can't trigger it; the FSM allows the
  // transition as a legal state-machine move so the courier-
  // coordination flow can fire downstream.
  SHIPPED: ['DELIVERED', 'FULFILLED', 'CANCELLED'],
  FULFILLED: ['DELIVERED', 'CANCELLED'],
  // Terminal
  DELIVERED: [],
  CANCELLED: [],
};

// ── OrderPaymentStatus ────────────────────────────────────────────────────

export type OrderPaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'VOIDED'
  | 'CANCELLED';

const PAYMENT_STATUS_TRANSITIONS: Record<
  OrderPaymentStatus,
  readonly OrderPaymentStatus[]
> = {
  // ONLINE orders mint a Razorpay intent and start at CREATED ("intent minted,
  // modal unopened" — Phase 66). Happy path is CREATED → PAID on a successful
  // capture; PENDING is the explicit "modal opened / attempt in flight" state;
  // the payment-expiry sweep cron routes never-paid intents to EXPIRED.
  // CREATED + EXPIRED have been in the Prisma enum since Phase 66 but were never
  // added to this map, so verifyPayment's CREATED → PAID (and the cron's
  // → EXPIRED) threw "Illegal OrderPaymentStatus transition".
  CREATED: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'],
  PENDING: ['PAID', 'EXPIRED', 'VOIDED', 'CANCELLED'],
  PAID: ['VOIDED'], // Refunds go through Returns; voids are admin-only
  // Terminal
  EXPIRED: [],
  VOIDED: [],
  CANCELLED: [],
};

// ── ReturnStatus ──────────────────────────────────────────────────────────

export type ReturnStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PICKUP_SCHEDULED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'QC_APPROVED'
  | 'QC_REJECTED'
  | 'PARTIALLY_APPROVED'
  | 'REFUND_PROCESSING'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'COMPLETED'
  | 'CANCELLED'
  // Phase 12 — dispute-driven overrides on the linked return.
  | 'DISPUTE_OVERTURNED'
  | 'DISPUTE_PARTIAL_OVERRIDE'
  | 'DISPUTE_CONFIRMED'
  | 'GOODWILL_CREDITED';

const RETURN_STATUS_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  // Admin can overrule auto-approval (or bail out of a manual approval)
  // any time before the item starts moving. Jumping straight to REJECTED
  // is allowed for APPROVED / PICKUP_SCHEDULED because scheduling is a
  // soft intent — the courier hasn't been dispatched yet.
  APPROVED: ['PICKUP_SCHEDULED', 'REJECTED', 'CANCELLED'],
  // PICKUP_SCHEDULED → RECEIVED is the "courier never scanned" shortcut:
  // the warehouse received the box but no IN_TRANSIT scan ever fired.
  // Preferred path is via IN_TRANSIT; this is the fallback an admin
  // takes when chasing the courier scan would block QC.
  PICKUP_SCHEDULED: ['IN_TRANSIT', 'RECEIVED', 'REJECTED', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED'],
  // QC outcomes that proceed to refund
  QC_APPROVED: ['REFUND_PROCESSING', 'REFUNDED'],
  PARTIALLY_APPROVED: [
    'REFUND_PROCESSING',
    'REFUNDED',
    // Phase 12 — admin's QC partial decision can later be overruled
    // upward to a full refund via dispute (DISPUTE_OVERTURNED) or
    // sideways to a different partial amount (DISPUTE_PARTIAL_OVERRIDE).
    'DISPUTE_OVERTURNED',
    'DISPUTE_PARTIAL_OVERRIDE',
  ],
  // Phase 12 — QC_REJECTED can be overturned upward by a customer
  // dispute (DISPUTE_OVERTURNED / DISPUTE_PARTIAL_OVERRIDE) or
  // upheld by the dispute (DISPUTE_CONFIRMED). GOODWILL_CREDITED
  // is when admin pays out without assigning fault.
  QC_REJECTED: [
    'COMPLETED',
    'DISPUTE_OVERTURNED',
    'DISPUTE_PARTIAL_OVERRIDE',
    'DISPUTE_CONFIRMED',
    'GOODWILL_CREDITED',
  ],
  // Refund processing terminal-ish.
  // Phase 100 (2026-05-23) — Phase 98 audit Gap #17 + #18 closure.
  // Added → REFUND_FAILED (retry cap exhausted; gateway rejection)
  // and → CANCELLED (admin-cancelled after manual review). Both keep
  // the customer-facing case explicit instead of leaving the row
  // pinned in REFUND_PROCESSING forever.
  REFUND_PROCESSING: ['REFUNDED', 'REFUND_FAILED', 'CANCELLED'],
  REFUNDED: ['COMPLETED'],
  // REFUND_FAILED is a terminal escalation state; an AdminTask drives
  // the human resolution which may flip to REFUNDED (manual bank
  // transfer reference), CANCELLED (customer abandoned), or COMPLETED
  // (Phase 105 — Phase 103 audit close terminal). The closeReturn
  // path needs the COMPLETED edge so support can clear the failed-
  // refund queue once the customer accepts the outcome.
  REFUND_FAILED: ['REFUNDED', 'CANCELLED', 'COMPLETED'],
  // Phase 12 — even completed returns can later be touched by a
  // dispute that surfaces evidence after the fact (e.g. customer
  // contacts support post-refund about a partial-only resolution
  // that should have been full). Rare but legal.
  COMPLETED: ['DISPUTE_OVERTURNED', 'DISPUTE_PARTIAL_OVERRIDE'],
  // Terminal
  REJECTED: [],
  CANCELLED: [],
  // Phase 12 — dispute-override terminal states. No further moves.
  DISPUTE_OVERTURNED: [],
  DISPUTE_PARTIAL_OVERRIDE: [],
  DISPUTE_CONFIRMED: [],
  GOODWILL_CREDITED: [],
};

// ── DisputeStatus ─────────────────────────────────────────────────────────

export type DisputeStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'AWAITING_INFO'
  | 'RESOLVED_BUYER'
  | 'RESOLVED_SELLER'
  | 'RESOLVED_SPLIT'
  | 'CLOSED';

const DISPUTE_STATUS_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  // Initial filing — admin can accept it for review, send back for more
  // info, or close as procedural (e.g. duplicate of another dispute).
  OPEN: ['UNDER_REVIEW', 'AWAITING_INFO', 'CLOSED'],
  // Active investigation. Decision can land in any of the three RESOLVED_*
  // outcomes, or pause for buyer/seller info.
  UNDER_REVIEW: [
    'AWAITING_INFO',
    'RESOLVED_BUYER',
    'RESOLVED_SELLER',
    'RESOLVED_SPLIT',
    'CLOSED',
  ],
  // Buyer/seller asked to provide proof. Resumes UNDER_REVIEW once the
  // info arrives (or admin gives up and decides without it).
  AWAITING_INFO: [
    'UNDER_REVIEW',
    'RESOLVED_BUYER',
    'RESOLVED_SELLER',
    'RESOLVED_SPLIT',
    'CLOSED',
  ],
  // RESOLVED_* statuses can be reopened (PR 5.2 keeps reopen via the
  // disputes.reopen permission). A reopened dispute goes back to
  // UNDER_REVIEW and the new decision overwrites the old one.
  RESOLVED_BUYER: ['UNDER_REVIEW', 'CLOSED'],
  RESOLVED_SELLER: ['UNDER_REVIEW', 'CLOSED'],
  RESOLVED_SPLIT: ['UNDER_REVIEW', 'CLOSED'],
  // Terminal. No re-open from CLOSED — file a new dispute instead.
  CLOSED: [],
};

// ── ProductStatus (catalog product approval lifecycle) ────────────────────
//
// Phase 4.3 (2026-05-16). Previously the catalog code allowed
// DRAFT → ACTIVE in one step, which let an unverified seller publish
// a product that the catalog team had never approved. Tax data,
// HSN code, GST rate — none of those would be validated. This FSM
// makes the gateway explicit: every product must pass through
// SUBMITTED + APPROVED before reaching ACTIVE.

export type ProductStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'ARCHIVED';

const PRODUCT_STATUS_TRANSITIONS: Record<
  ProductStatus,
  readonly ProductStatus[]
> = {
  // Initial state — the seller is still building the product. Can be
  // submitted for catalog review or archived (abandoned draft cleanup).
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  // Awaiting catalog review.
  SUBMITTED: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'DRAFT'],
  // Catalog asked for edits; seller revises and re-submits.
  CHANGES_REQUESTED: ['SUBMITTED', 'ARCHIVED', 'REJECTED'],
  // Approved by catalog — seller can now publish.
  APPROVED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  // Catalog rejected. Seller can revise into DRAFT and resubmit.
  REJECTED: ['DRAFT', 'ARCHIVED'],
  // Customer-visible.
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  // Admin-suspended (compliance / fraud). Can be reinstated to ACTIVE.
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  // Terminal.
  ARCHIVED: [],
};

// ── VariantStatus (per-variant lifecycle) ─────────────────────────────────

export type VariantStatus = 'DRAFT' | 'ACTIVE' | 'OUT_OF_STOCK' | 'DISABLED' | 'ARCHIVED';

const VARIANT_STATUS_TRANSITIONS: Record<
  VariantStatus,
  readonly VariantStatus[]
> = {
  // A variant can go live only after its parent product is ACTIVE.
  // The FSM here doesn't encode the parent dependency — that's a
  // service-layer guard — but it does prevent DRAFT → OUT_OF_STOCK
  // jumps that skipped the ACTIVE state entirely.
  DRAFT: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
  ACTIVE: ['OUT_OF_STOCK', 'DISABLED', 'ARCHIVED'],
  OUT_OF_STOCK: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
  DISABLED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

// ── OrderAcceptStatus (sub-order acceptance lifecycle) ─────────────────────

export type OrderAcceptStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

const ACCEPT_STATUS_TRANSITIONS: Record<
  OrderAcceptStatus,
  readonly OrderAcceptStatus[]
> = {
  OPEN: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['CANCELLED'],
  // Terminal
  REJECTED: [],
  CANCELLED: [],
};

// ── Generic transition checker ────────────────────────────────────────────

interface TransitionTable<T extends string> {
  name: string;
  transitions: Record<T, readonly T[]>;
}

const TABLES = {
  OrderStatus: {
    name: 'OrderStatus',
    transitions: ORDER_STATUS_TRANSITIONS,
  } as TransitionTable<OrderStatus>,
  OrderFulfillmentStatus: {
    name: 'OrderFulfillmentStatus',
    transitions: FULFILLMENT_STATUS_TRANSITIONS,
  } as TransitionTable<OrderFulfillmentStatus>,
  OrderPaymentStatus: {
    name: 'OrderPaymentStatus',
    transitions: PAYMENT_STATUS_TRANSITIONS,
  } as TransitionTable<OrderPaymentStatus>,
  ReturnStatus: {
    name: 'ReturnStatus',
    transitions: RETURN_STATUS_TRANSITIONS,
  } as TransitionTable<ReturnStatus>,
  DisputeStatus: {
    name: 'DisputeStatus',
    transitions: DISPUTE_STATUS_TRANSITIONS,
  } as TransitionTable<DisputeStatus>,
  OrderAcceptStatus: {
    name: 'OrderAcceptStatus',
    transitions: ACCEPT_STATUS_TRANSITIONS,
  } as TransitionTable<OrderAcceptStatus>,
  ProductStatus: {
    name: 'ProductStatus',
    transitions: PRODUCT_STATUS_TRANSITIONS,
  } as TransitionTable<ProductStatus>,
  VariantStatus: {
    name: 'VariantStatus',
    transitions: VARIANT_STATUS_TRANSITIONS,
  } as TransitionTable<VariantStatus>,
};

export type StatusKind = keyof typeof TABLES;

/**
 * Returns true if the given transition is allowed by the FSM table.
 * Same-state transitions are also allowed (idempotent updates).
 */
export function isTransitionAllowed<K extends StatusKind>(
  kind: K,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const table = TABLES[kind];
  const allowed = (table.transitions as Record<string, readonly string[]>)[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Throws BadRequestAppException if the given transition is illegal.
 * Use this from any service method that updates a status field.
 */
export function assertTransition<K extends StatusKind>(
  kind: K,
  from: string,
  to: string,
): void {
  if (!isTransitionAllowed(kind, from, to)) {
    const table = TABLES[kind];
    throw new BadRequestAppException(
      `Illegal ${table.name} transition: ${from} → ${to}`,
    );
  }
}

/**
 * Returns the list of allowed next states for a given current state.
 * Useful for surfacing valid actions in the UI / for documentation.
 */
export function allowedTransitions<K extends StatusKind>(
  kind: K,
  from: string,
): readonly string[] {
  const table = TABLES[kind];
  return (table.transitions as Record<string, readonly string[]>)[from] ?? [];
}
