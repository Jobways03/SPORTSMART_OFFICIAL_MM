import type { NormalizedStatus } from '@sportsmart/logistics-contracts';

/**
 * Translate a Shadowfax `status_id` (the lower-case machine code in
 * tracking + create-order responses) to a canonical `NormalizedStatus`.
 *
 * The mapping table mirrors the Shadowfax marketplace API status
 * dictionary 1:1. Codes that don't appear in the table return `null`
 * — the caller decides whether to log/log-and-fallback to
 * `EXCEPTION` or surface the raw value.
 *
 * Pattern mirrors apps/api/src/integrations/ithink/mappers/ithink-status.mapper.ts.
 */

const STATUS_TABLE: Readonly<Record<string, NormalizedStatus>> = {
  // BOOKED — order received, no pickup yet.
  new: 'BOOKED',
  assigned_for_pickup: 'BOOKED',
  assigned_for_seller_pickup: 'BOOKED',
  ofp: 'BOOKED', // "out for pickup" but not yet picked
  received_from_client_warehouse: 'BOOKED',

  // PICKED_UP — parcel in carrier custody.
  picked: 'PICKED_UP',

  // IN_TRANSIT — multiple hub/bag states all roll up to one bucket.
  recd_at_rev_hub: 'IN_TRANSIT',
  recd_at_fwd_hub: 'IN_TRANSIT',
  recd_at_fwd_dc: 'IN_TRANSIT',
  bag_received: 'IN_TRANSIT',
  bag_received_at_via: 'IN_TRANSIT',
  item_manifested: 'IN_TRANSIT',
  bag_in_transit: 'IN_TRANSIT',
  in_transit_return: 'IN_TRANSIT',
  // Audit-only state — Shadowfax updated the drop pincode mid-route.
  // Surfaced as IN_TRANSIT; raw_payload preserves the audit trail.
  pincode_updated: 'IN_TRANSIT',

  // OUT_FOR_DELIVERY
  assigned_for_delivery: 'OUT_FOR_DELIVERY',
  ofd: 'OUT_FOR_DELIVERY',

  // DELIVERED
  delivered: 'DELIVERED',

  // DELAYED — promise still alive but moving slow.
  cid: 'DELAYED', // "customer initiated delay"
  seller_initiated_delay: 'DELAYED',

  // NDR subtypes.
  nc: 'NDR_NOT_CONTACTABLE',
  seller_not_contactable: 'NDR_NOT_CONTACTABLE',
  na: 'NDR_NOT_ATTEMPTED',
  pickup_not_attempted: 'NDR_NOT_ATTEMPTED',

  // ON_HOLD
  on_hold: 'ON_HOLD',
  pickup_on_hold: 'ON_HOLD',

  // REATTEMPT — NDR resolved, redelivery booked.
  reopen_ndr: 'REATTEMPT_SCHEDULED',

  // RTO_INITIATED — return-to-seller flow started.
  rts: 'RTO_INITIATED',
  rts_in_process: 'RTO_INITIATED',
  rts_ofd: 'RTO_INITIATED',
  rto: 'RTO_INITIATED',
  rto_in_process: 'RTO_INITIATED',

  // RTO_DELIVERED — seller has the parcel back.
  rts_d: 'RTO_DELIVERED',
  rto_d: 'RTO_DELIVERED',

  // RTO_FAILED — return failed (seller warehouse couldn't accept).
  rts_nd: 'RTO_FAILED',
  rto_nd: 'RTO_FAILED',

  // CANCELLED
  cancelled_by_customer: 'CANCELLED',
  cancelled_by_seller: 'CANCELLED',

  // LOST
  lost: 'LOST',

  // MISROUTED
  item_misrouted: 'MISROUTED',
};

/**
 * Returns the canonical `NormalizedStatus` for a Shadowfax status id,
 * or `null` if the code is not in the dictionary. The caller decides
 * whether to bucket unknown codes as `EXCEPTION` and log them for a
 * future dictionary update.
 *
 * Inputs are lower-cased so callers can pass through Shadowfax's
 * value verbatim regardless of casing.
 */
export function mapShadowfaxStatus(statusId: string): NormalizedStatus | null {
  if (typeof statusId !== 'string' || statusId.length === 0) return null;
  const key = statusId.toLowerCase().trim();
  return STATUS_TABLE[key] ?? null;
}
