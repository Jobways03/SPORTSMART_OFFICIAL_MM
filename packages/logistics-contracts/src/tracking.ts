import { z } from 'zod';
import { PartnerCodeLoose } from './partner';
import { ShipmentStatus } from './shipment';

/**
 * Vendor-agnostic, deduplicated tracking lifecycle. Each adapter is
 * responsible for translating its raw status code (e.g. iThink's
 * "RD-IT-001") into one of these values via its mapper. Callers and
 * downstream consumers (notifications, BI) never see partner codes.
 *
 * Kept separate from ShipmentStatus so we can record granular scan
 * events (e.g. ARRIVED_AT_HUB) that don't shift the headline shipment
 * status.
 */
export const NormalizedStatus = z.enum([
  'BOOKED',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'ARRIVED_AT_HUB',
  'DEPARTED_HUB',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'EXCEPTION',
  'NDR',
  // Granular NDR sub-states surfaced by Shadowfax (and likely other
  // last-mile partners). NDR remains the catch-all bucket; these are
  // for ops dashboards that need to know WHY the attempt failed.
  'NDR_NOT_CONTACTABLE',
  'NDR_NOT_ATTEMPTED',
  'ON_HOLD',
  'REATTEMPT_SCHEDULED',
  'DELAYED',
  'MISROUTED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_DELIVERED',
  // Final-state RTO failure — partner returned the parcel but
  // delivery to the seller itself failed (rare; warehouse closed,
  // address invalid, etc.).
  'RTO_FAILED',
  'CANCELLED',
  'LOST',
  'DAMAGED',
]);
export type NormalizedStatus = z.infer<typeof NormalizedStatus>;

export const TrackingEvent = z.object({
  partner: PartnerCodeLoose,
  partnerStatusCode: z.string().min(1).max(64),
  normalizedStatus: NormalizedStatus,
  eventAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  location: z.string().max(200).optional(),
  remark: z.string().max(500).optional(),
});
export type TrackingEvent = z.infer<typeof TrackingEvent>;

/**
 * Result of `GET /shipments/:awb/timeline` — the headline status plus
 * the ordered event list. `events` is ascending by `eventAt` so the
 * caller can render a chronological timeline without re-sorting.
 */
export const TrackingSnapshot = z.object({
  awb: z.string().min(1).max(64),
  partner: PartnerCodeLoose,
  currentStatus: ShipmentStatus,
  currentNormalizedStatus: NormalizedStatus,
  expectedDeliveryAt: z.string().datetime().nullable(),
  lastEventAt: z.string().datetime().nullable(),
  events: z.array(TrackingEvent),
});
export type TrackingSnapshot = z.infer<typeof TrackingSnapshot>;

/**
 * Adapter-emitted canonical event used by partner integrations that
 * build their own timeline (Shadowfax single + bulk tracking pull).
 * Plain TS interfaces — no Zod schema — because they're produced and
 * consumed inside the facade, never crossing the HTTP boundary.
 */
export interface CanonicalTrackingEvent {
  /** ISO-8601. */
  occurredAt: string;
  normalizedStatus: NormalizedStatus;
  partnerStatusCode: string;
  partnerStatusLabel: string;
  location: string | null;
  remarks: string;
  /** Original partner payload preserved for audit / debugging. */
  rawPayload?: unknown;
}

export interface CanonicalTrackingTimeline {
  partner: string;
  awb: string;
  currentStatus: NormalizedStatus;
  customerTrackingUrl?: string;
  events: CanonicalTrackingEvent[];
}
