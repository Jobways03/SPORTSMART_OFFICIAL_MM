import { ITHINK_STATUSES, type IThinkStatus } from '../ithink.constants';

/**
 * Maps iThink's verbose status strings onto the platform-internal
 * ShipmentStatus enum. We map on the verbose string (NOT status_code)
 * because the code column collapses ~25 distinct meanings onto 'UD',
 * which loses information operations needs (Damaged vs Misrouted vs
 * In Transit).
 *
 * The shipping module owns the canonical ShipmentStatus enum; this
 * mapper returns a string in that vocabulary. The string-literal
 * return type intentionally over-specifies the iThink side so a
 * compile-time exhaustiveness check below catches a new status if
 * iThink expands the taxonomy.
 */

/**
 * Domain shipment status — must mirror the values used by the
 * `modules/shipping/application/services/shipment-state.service.ts`
 * and any Prisma enum. Defined locally to avoid coupling the
 * integration package to the shipping module's internals.
 */
export type ShipmentStatusInternal =
  | 'PENDING'
  | 'MANIFESTED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'UNDELIVERED'
  | 'EXCEPTION'
  | 'CANCELLED'
  | 'RTO_INITIATED'
  | 'RTO_IN_TRANSIT'
  | 'RTO_DELIVERED'
  | 'LOST'
  | 'DAMAGED'
  // Reverse-pickup lifecycle (return shipments).
  | 'REV_MANIFESTED'
  | 'REV_PICKED_UP'
  | 'REV_IN_TRANSIT'
  | 'REV_OUT_FOR_DELIVERY'
  | 'REV_DELIVERED'
  | 'REV_CANCELLED';

/**
 * Single source of truth for status translation. New iThink statuses
 * must be added here AND in ITHINK_STATUSES; the exhaustiveness check
 * at the bottom fails the build if either side drifts.
 */
const MAP: Record<IThinkStatus, ShipmentStatusInternal> = {
  // Forward lifecycle
  [ITHINK_STATUSES.MANIFESTED]: 'MANIFESTED',
  [ITHINK_STATUSES.NOT_PICKED]: 'MANIFESTED', // booked but courier hasn't shown up
  [ITHINK_STATUSES.PICKED_UP]: 'PICKED_UP',
  [ITHINK_STATUSES.IN_TRANSIT]: 'IN_TRANSIT',
  [ITHINK_STATUSES.REACHED_AT_DESTINATION]: 'IN_TRANSIT', // at DC, not yet OFD
  [ITHINK_STATUSES.OUT_FOR_DELIVERY]: 'OUT_FOR_DELIVERY',
  [ITHINK_STATUSES.UNDELIVERED]: 'UNDELIVERED',
  [ITHINK_STATUSES.OUT_OF_DELIVERY_AREA]: 'EXCEPTION',
  [ITHINK_STATUSES.DELAYED]: 'EXCEPTION',
  [ITHINK_STATUSES.DAMAGED]: 'DAMAGED',
  [ITHINK_STATUSES.MISROUTED]: 'EXCEPTION',
  [ITHINK_STATUSES.DELIVERED]: 'DELIVERED',
  [ITHINK_STATUSES.CANCELLED]: 'CANCELLED',
  // RTO lifecycle
  [ITHINK_STATUSES.RTO_PENDING]: 'RTO_INITIATED',
  [ITHINK_STATUSES.RTO_PROCESSING]: 'RTO_INITIATED',
  [ITHINK_STATUSES.RTO_IN_TRANSIT]: 'RTO_IN_TRANSIT',
  [ITHINK_STATUSES.REACHED_AT_ORIGIN]: 'RTO_IN_TRANSIT',
  [ITHINK_STATUSES.RTO_OUT_FOR_DELIVERY]: 'RTO_IN_TRANSIT',
  [ITHINK_STATUSES.RTO_UNDELIVERED]: 'EXCEPTION', // pickup-side undelivered, rare
  [ITHINK_STATUSES.RTO_DELIVERED]: 'RTO_DELIVERED',
  // Generic loss
  [ITHINK_STATUSES.LOST]: 'LOST',
  [ITHINK_STATUSES.SHORTAGE]: 'EXCEPTION',
  [ITHINK_STATUSES.RTO_SHORTAGE]: 'EXCEPTION',
  // Reverse pickup
  [ITHINK_STATUSES.REV_MANIFEST]: 'REV_MANIFESTED',
  [ITHINK_STATUSES.REV_OUT_FOR_PICKUP]: 'REV_MANIFESTED',
  [ITHINK_STATUSES.REV_PICKED_UP]: 'REV_PICKED_UP',
  [ITHINK_STATUSES.REV_IN_TRANSIT]: 'REV_IN_TRANSIT',
  [ITHINK_STATUSES.REV_CANCELLED]: 'REV_CANCELLED',
  [ITHINK_STATUSES.REV_OUT_FOR_DELIVERY]: 'REV_OUT_FOR_DELIVERY',
  [ITHINK_STATUSES.REV_DELIVERED]: 'REV_DELIVERED',
  [ITHINK_STATUSES.REV_CLOSED]: 'REV_CANCELLED', // closed before pickup
};

/**
 * Translate an iThink verbose status to our internal status enum.
 * Unknown values fall back to 'EXCEPTION' so unexpected courier
 * scans surface in the admin's exception queue instead of being
 * silently dropped.
 */
export function mapIThinkStatus(input: string | null | undefined): ShipmentStatusInternal {
  if (!input) return 'PENDING';
  const normalised = input.trim();
  return (MAP as Record<string, ShipmentStatusInternal>)[normalised] ?? 'EXCEPTION';
}

/**
 * Terminal statuses — once a shipment reaches one of these, the
 * tracking poller can stop polling that AWB. Used by the cron
 * to skip closed shipments and reduce wasted Track Order calls.
 */
export const TERMINAL_STATUSES: ReadonlySet<ShipmentStatusInternal> = new Set([
  'DELIVERED',
  'CANCELLED',
  'RTO_DELIVERED',
  'REV_DELIVERED',
  'REV_CANCELLED',
  'LOST',
]);

export function isTerminalStatus(status: ShipmentStatusInternal): boolean {
  return TERMINAL_STATUSES.has(status);
}
