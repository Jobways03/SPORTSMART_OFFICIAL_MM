import { BadRequestException } from '@nestjs/common';
import type { ShipmentStatus } from '@sportsmart/logistics-contracts';

/**
 * Allowed transitions between ShipmentStatus values. The map is
 * read-only and exhaustive — any unmapped (from, to) pair is rejected.
 *
 * Forward path:
 *   DRAFT -> BOOKED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY
 *           -> DELIVERED
 *
 * Exception path:
 *   pre-pickup -> CANCELLED
 *   any        -> NDR (re-enters from OUT_FOR_DELIVERY, IN_TRANSIT)
 *   NDR        -> OUT_FOR_DELIVERY (reattempt) | RTO_INITIATED
 *   RTO_INITIATED -> RTO_IN_TRANSIT -> RTO_DELIVERED
 *   any in-transit -> LOST | DAMAGED
 *
 * Use:
 *   assertTransition(current, next);
 *
 * The function throws BadRequestException with a stable message that
 * the RFC 7807 filter maps to PROBLEM_TYPES.invalidFsmTransition. Apps/
 * api's status-transitions.ts uses the same throwing pattern.
 */
const TRANSITIONS: Readonly<Record<ShipmentStatus, ReadonlySet<ShipmentStatus>>> = {
  DRAFT: new Set(['BOOKED', 'CANCELLED']),
  BOOKED: new Set(['PICKED_UP', 'CANCELLED', 'LOST']),
  PICKED_UP: new Set(['IN_TRANSIT', 'LOST', 'DAMAGED']),
  IN_TRANSIT: new Set(['OUT_FOR_DELIVERY', 'NDR', 'LOST', 'DAMAGED']),
  OUT_FOR_DELIVERY: new Set(['DELIVERED', 'NDR', 'LOST', 'DAMAGED']),
  DELIVERED: new Set([]),
  NDR: new Set(['OUT_FOR_DELIVERY', 'RTO_INITIATED', 'DELIVERED']),
  RTO_INITIATED: new Set(['RTO_IN_TRANSIT', 'CANCELLED']),
  RTO_IN_TRANSIT: new Set(['RTO_DELIVERED', 'LOST', 'DAMAGED']),
  RTO_DELIVERED: new Set([]),
  CANCELLED: new Set([]),
  LOST: new Set([]),
  DAMAGED: new Set([]),
};

export function canTransition(
  current: ShipmentStatus,
  next: ShipmentStatus,
): boolean {
  if (current === next) return true; // idempotent re-apply
  return TRANSITIONS[current]?.has(next) ?? false;
}

export function assertTransition(
  current: ShipmentStatus,
  next: ShipmentStatus,
): void {
  if (!canTransition(current, next)) {
    throw new BadRequestException(
      `Invalid FSM transition: ${current} -> ${next}`,
    );
  }
}

/**
 * Returns the set of states reachable from `current` in one hop.
 * Used by the admin debug endpoint when investigating a stuck shipment.
 */
export function allowedNextStates(
  current: ShipmentStatus,
): ReadonlySet<ShipmentStatus> {
  return TRANSITIONS[current] ?? new Set();
}
