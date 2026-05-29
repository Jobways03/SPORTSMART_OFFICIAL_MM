import { Injectable } from '@nestjs/common';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Phase 86 (2026-05-23) — tracking webhook audit Gap #2/#3/#18.
 *
 * Pre-Phase-86 this file was a 1-line stub (`UshipmentUstateService`)
 * referenced by the shipping module wiring but never implemented.
 * The audit's expected internal `ShipmentStatus` enum (11 states) had
 * no representation in code — carrier scans collapsed to 5
 * `OrderFulfillmentStatus` values, losing the granularity needed for
 * the customer track-your-order page and the FSM-enforced
 * progression.
 *
 * This service is the internal state machine for shipment lifecycle.
 * It runs alongside (not instead of) `OrderFulfillmentStatus`:
 *   • OrderFulfillmentStatus stays the business-level rollup the rest
 *     of the platform reads (UNFULFILLED / PACKED / SHIPPED /
 *     DELIVERED / CANCELLED).
 *   • ShipmentInternalStatus is the carrier-side detail captured per
 *     scan in `shipment_tracking_events.internal_status`. Reading
 *     the latest row gives the customer page its progress indicator.
 *
 * Phase 86 follow-up — union promoted to mirror the Prisma
 * `ShipmentInternalStatusEnum` 1:1 so the row layer constraint and
 * the application-layer FSM agree on the same vocabulary.
 */

export type ShipmentInternalStatus =
  | 'CREATED'
  | 'PICKUP_PENDING'
  | 'PICKED_UP'
  | 'MANIFESTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'UNDELIVERED'
  | 'FAILED_DELIVERY'
  | 'RTO_INITIATED'
  | 'RTO_IN_TRANSIT'
  | 'RTO_DELIVERED'
  | 'LOST'
  | 'DAMAGED'
  | 'CANCELLED'
  // Phase 87 (2026-05-23) — NDR/RTO Gap #10. EXCEPTION = ops-attention
  // states the iThink mapper buckets (OUT_OF_DELIVERY_AREA / DELAYED /
  // MISROUTED / SHORTAGE). Non-terminal — the carrier can still
  // forward the parcel after exception clears.
  | 'EXCEPTION';

// Phase 86 — terminal states are exits from the matrix. A scan that
// would move INTO a terminal state is allowed; moving OUT of one is
// blocked (terminal = no outgoing edges).
const TERMINAL_STATES = new Set<ShipmentInternalStatus>([
  'DELIVERED',
  'RTO_DELIVERED',
  'LOST',
  'DAMAGED',
  'CANCELLED',
]);

// Phase 86 — Gap #18 FSM matrix. Mirrors the recommended state
// machine in the audit doc. The mapper passes a carrier scan
// through `assertTransition` before the row commits to the
// `shipment_tracking_events` table — illegal transitions are
// rejected by the application layer and surfaced as
// `outcome = FSM_REJECTED` on the WebhookEvent row.
const TRANSITIONS: Record<
  ShipmentInternalStatus,
  ReadonlySet<ShipmentInternalStatus>
> = {
  CREATED: new Set([
    'PICKUP_PENDING',
    'PICKED_UP',
    'CANCELLED',
  ]),
  PICKUP_PENDING: new Set([
    'PICKED_UP',
    'MANIFESTED',
    'CANCELLED',
  ]),
  PICKED_UP: new Set([
    'MANIFESTED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'CANCELLED',
    'LOST',
    'DAMAGED',
  ]),
  // Phase 86 follow-up — MANIFESTED is the carrier-side hand-off
  // ack (booking confirmed, label printed). Forward transitions only.
  MANIFESTED: new Set([
    'IN_TRANSIT',
    'PICKED_UP',
    'CANCELLED',
    'LOST',
    'DAMAGED',
  ]),
  IN_TRANSIT: new Set([
    // Carrier-side reshuffles often loop a parcel between hubs
    // before the final out-for-delivery. Allow same-status no-op via
    // CAS at the caller (this matrix only governs distinct-status
    // transitions).
    'OUT_FOR_DELIVERY',
    'IN_TRANSIT',
    'DELIVERED',
    'FAILED_DELIVERY',
    'RTO_INITIATED',
    'EXCEPTION',
    'LOST',
    'DAMAGED',
  ]),
  OUT_FOR_DELIVERY: new Set([
    'DELIVERED',
    'FAILED_DELIVERY',
    'UNDELIVERED',
    'IN_TRANSIT',
    'RTO_INITIATED',
    'EXCEPTION',
    'LOST',
    'DAMAGED',
  ]),
  FAILED_DELIVERY: new Set([
    'OUT_FOR_DELIVERY',
    'UNDELIVERED',
    'IN_TRANSIT',
    'DELIVERED',
    'RTO_INITIATED',
    'LOST',
    'DAMAGED',
  ]),
  // Phase 86 follow-up — UNDELIVERED (NDR). Carrier flagged a
  // failed-delivery attempt; legal next moves are retry (back to
  // OUT_FOR_DELIVERY / IN_TRANSIT), DELIVERED (succeeded on retry),
  // or RTO if the customer doesn't respond.
  UNDELIVERED: new Set([
    'OUT_FOR_DELIVERY',
    'IN_TRANSIT',
    'DELIVERED',
    'RTO_INITIATED',
    'FAILED_DELIVERY',
    // Phase 87 — carriers deliver successive NDRs as repeated
    // UNDELIVERED scans (one per failed attempt) before auto-RTO.
    // Allow the same-state loop so attempts 2..N persist instead of
    // FSM-rejecting.
    'UNDELIVERED',
    'EXCEPTION',
    'LOST',
    'DAMAGED',
  ]),
  RTO_INITIATED: new Set([
    'RTO_IN_TRANSIT',
    'RTO_DELIVERED',
    'LOST',
    'DAMAGED',
  ]),
  RTO_IN_TRANSIT: new Set([
    'RTO_DELIVERED',
    'RTO_IN_TRANSIT',
    'LOST',
    'DAMAGED',
  ]),
  // Phase 87 (2026-05-23) — EXCEPTION. Non-terminal. Carrier holds
  // the parcel pending resolution (out-of-area, delayed, misrouted,
  // shortage). Most exceptions recover into IN_TRANSIT once ops
  // intervenes. A persistent EXCEPTION often ends in RTO.
  EXCEPTION: new Set([
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'FAILED_DELIVERY',
    'UNDELIVERED',
    'DELIVERED',
    'RTO_INITIATED',
    'LOST',
    'DAMAGED',
    'CANCELLED',
  ]),

  // Terminal — no outgoing edges.
  DELIVERED: new Set([]),
  RTO_DELIVERED: new Set([]),
  LOST: new Set([]),
  DAMAGED: new Set([]),
  CANCELLED: new Set([]),
};

@Injectable()
export class ShipmentStateService {
  /**
   * Validates a transition from the latest known internal status to
   * a new one. Throws `BadRequestAppException` on illegal moves —
   * the webhook controller catches this and tags the WebhookEvent
   * row as `FSM_REJECTED` (Gap #21) rather than silently 200-ing.
   *
   * The `from` parameter accepts `null` for the first scan of a
   * shipment (no prior history) — any state from the CREATED layer
   * is a legal initial transition.
   */
  assertTransition(
    from: ShipmentInternalStatus | null,
    to: ShipmentInternalStatus,
  ): void {
    if (!this.isTransitionAllowed(from, to)) {
      throw new BadRequestAppException(
        `Illegal ShipmentStatus transition: ${from ?? '(none)'} → ${to}`,
      );
    }
  }

  isTransitionAllowed(
    from: ShipmentInternalStatus | null,
    to: ShipmentInternalStatus,
  ): boolean {
    if (from === null) {
      // First scan — every status is a legal initial entry except
      // RTO_* which must be preceded by IN_TRANSIT/OUT_FOR_DELIVERY/
      // FAILED_DELIVERY (a carrier can't initiate RTO on a shipment
      // we never saw pick up). Same-row-as-creation CANCELLED is
      // also blocked here — the order-side cancel path is the only
      // legitimate creator of CANCELLED rows.
      const initialBlocked: ShipmentInternalStatus[] = [
        'RTO_INITIATED',
        'RTO_IN_TRANSIT',
        'RTO_DELIVERED',
      ];
      return !initialBlocked.includes(to);
    }
    return TRANSITIONS[from]?.has(to) ?? false;
  }

  isTerminal(status: ShipmentInternalStatus): boolean {
    return TERMINAL_STATES.has(status);
  }
}
