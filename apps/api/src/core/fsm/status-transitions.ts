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
  | 'CANCELLED';

const RETURN_STATUS_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKUP_SCHEDULED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED'],
  // QC outcomes that proceed to refund
  QC_APPROVED: ['REFUND_PROCESSING', 'REFUNDED'],
  PARTIALLY_APPROVED: ['REFUND_PROCESSING', 'REFUNDED'],
  // QC outcomes that close the return
  QC_REJECTED: ['COMPLETED'],
  // Refund processing terminal-ish
  REFUND_PROCESSING: ['REFUNDED'],
  REFUNDED: ['COMPLETED'],
  // Terminal
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
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
  OrderAcceptStatus: {
    name: 'OrderAcceptStatus',
    transitions: ACCEPT_STATUS_TRANSITIONS,
  } as TransitionTable<OrderAcceptStatus>,
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
