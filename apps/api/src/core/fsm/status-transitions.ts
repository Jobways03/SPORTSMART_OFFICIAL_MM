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
  | 'EXCEPTION_QUEUE';

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Initial state for ONLINE orders awaiting gateway capture.
  // Canonical happy path is PENDING_PAYMENT → PLACED (via verifyPayment).
  // Auto-cancel on payment-window expiry routes to CANCELLED.
  PENDING_PAYMENT: ['PLACED', 'CANCELLED'],
  PLACED: ['PENDING_VERIFICATION', 'VERIFIED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  PENDING_VERIFICATION: ['VERIFIED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  VERIFIED: ['ROUTED_TO_SELLER', 'CANCELLED', 'EXCEPTION_QUEUE'],
  ROUTED_TO_SELLER: ['SELLER_ACCEPTED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  SELLER_ACCEPTED: ['DISPATCHED', 'CANCELLED', 'EXCEPTION_QUEUE'],
  DISPATCHED: ['DELIVERED', 'EXCEPTION_QUEUE'],
  // Terminal states — no transitions out.
  DELIVERED: [],
  CANCELLED: [],
  // EXCEPTION_QUEUE is a manual-recovery state. Admins can push it back into
  // the flow, so we allow it to leave to most non-terminal states.
  EXCEPTION_QUEUE: [
    'VERIFIED',
    'ROUTED_TO_SELLER',
    'SELLER_ACCEPTED',
    'DISPATCHED',
    'CANCELLED',
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
  SHIPPED: ['DELIVERED', 'FULFILLED'],
  FULFILLED: ['DELIVERED'],
  // Terminal
  DELIVERED: [],
  CANCELLED: [],
};

// ── OrderPaymentStatus ────────────────────────────────────────────────────

export type OrderPaymentStatus = 'PENDING' | 'PAID' | 'VOIDED' | 'CANCELLED';

const PAYMENT_STATUS_TRANSITIONS: Record<
  OrderPaymentStatus,
  readonly OrderPaymentStatus[]
> = {
  PENDING: ['PAID', 'VOIDED', 'CANCELLED'],
  PAID: ['VOIDED'], // Refunds go through Returns; voids are admin-only
  // Terminal
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
  // Refund processing terminal-ish
  REFUND_PROCESSING: ['REFUNDED'],
  REFUNDED: ['COMPLETED'],
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
