import type {
  CanonicalTrackingEvent,
  CanonicalTrackingTimeline,
  NormalizedStatus,
} from '@sportsmart/logistics-contracts';
import type {
  ShadowfaxBulkTrackEntry,
  ShadowfaxBulkTrackSuccess,
  ShadowfaxOrderSnapshot,
  ShadowfaxTrackingEvent,
  ShadowfaxTrackOrderSuccess,
} from '../dtos/shadowfax-tracking.dto';
import { mapShadowfaxStatus } from './shadowfax-status.mapper';
import { SHADOWFAX_PARTNER_CODE } from '../shadowfax.constants';

/**
 * Translate Shadowfax tracking responses into the canonical timeline
 * shape consumed by the tracking service.
 *
 * Decisions worth noting (apply to both single + bulk):
 *   • Unknown `status_id` codes bucket to `EXCEPTION` — preferable to
 *     dropping the event silently because ops needs to know that a
 *     scan landed even when we don't yet have a label for it.
 *   • Events are sorted ascending by `created` so the caller can
 *     render a chronological timeline without re-sorting.
 *   • Consecutive events with the same (normalizedStatus + location)
 *     are deduplicated to the first occurrence — Shadowfax sometimes
 *     emits the same scan twice (rider re-uploads, hub re-scans).
 *   • `currentStatus` prefers `order_details.status` when present (it's
 *     authoritative — the partner's own headline). Falls back to the
 *     last event's normalized status otherwise.
 */

function eventToCanonical(
  event: ShadowfaxTrackingEvent,
): CanonicalTrackingEvent {
  const normalized = mapShadowfaxStatus(event.status_id) ?? 'EXCEPTION';
  return {
    occurredAt: event.created,
    normalizedStatus: normalized,
    partnerStatusCode: event.status_id,
    partnerStatusLabel: event.status,
    location: event.location && event.location.length > 0 ? event.location : null,
    remarks: event.remarks ?? '',
    rawPayload: event,
  };
}

function sortAscending(a: CanonicalTrackingEvent, b: CanonicalTrackingEvent): number {
  // Compare ISO strings lexicographically — valid for UTC timestamps.
  if (a.occurredAt < b.occurredAt) return -1;
  if (a.occurredAt > b.occurredAt) return 1;
  return 0;
}

function dedupeConsecutive(
  events: CanonicalTrackingEvent[],
): CanonicalTrackingEvent[] {
  const out: CanonicalTrackingEvent[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.normalizedStatus === event.normalizedStatus &&
      prev.location === event.location
    ) {
      // Keep the first occurrence; skip the duplicate.
      continue;
    }
    out.push(event);
  }
  return out;
}

function deriveCurrentStatus(
  snapshot: ShadowfaxOrderSnapshot | undefined,
  events: CanonicalTrackingEvent[],
): NormalizedStatus {
  // 1. Prefer the partner's authoritative headline status when present.
  if (snapshot?.status) {
    const mapped = mapShadowfaxStatus(snapshot.status);
    if (mapped) return mapped;
  }
  // 2. Fall back to the latest event in the timeline.
  if (events.length > 0) {
    return events[events.length - 1]!.normalizedStatus;
  }
  // 3. Last resort — surface EXCEPTION so the caller knows the
  // partner returned a timeline without anything mappable.
  return 'EXCEPTION';
}

function buildTimeline(
  awb: string,
  snapshot: ShadowfaxOrderSnapshot | undefined,
  rawEvents: ShadowfaxTrackingEvent[],
): CanonicalTrackingTimeline {
  const canonical = rawEvents
    .map(eventToCanonical)
    .sort(sortAscending);
  const deduped = dedupeConsecutive(canonical);
  const currentStatus = deriveCurrentStatus(snapshot, deduped);

  return {
    partner: SHADOWFAX_PARTNER_CODE,
    awb,
    currentStatus,
    ...(snapshot?.customer_track_url
      ? { customerTrackingUrl: snapshot.customer_track_url }
      : {}),
    events: deduped,
  };
}

/**
 * Convert a single-AWB tracking response into the canonical timeline.
 * Throws if the response is missing the required envelope shape — the
 * caller (service layer) is responsible for upstream error handling.
 */
export function fromShadowfaxTrackingResponse(
  resp: ShadowfaxTrackOrderSuccess,
): CanonicalTrackingTimeline {
  const awb =
    resp.order_details.awb_number ||
    // Shadowfax sometimes echoes only the AWB on the first event.
    resp.tracking_details[0]?.awb_number ||
    '';
  return buildTimeline(awb, resp.order_details, resp.tracking_details);
}

/**
 * Convert a bulk-tracking response into a map keyed by AWB. Each
 * entry's timeline is built via the same pipeline as the single-AWB
 * response so behaviour stays consistent.
 */
export function fromShadowfaxBulkTrackingResponse(
  resp: ShadowfaxBulkTrackSuccess,
): Map<string, CanonicalTrackingTimeline> {
  const out = new Map<string, CanonicalTrackingTimeline>();
  for (const entry of resp.data) {
    const awb = entry.awb_number;
    if (!awb) continue;
    const snapshot: ShadowfaxOrderSnapshot = stripTrackingDetails(entry);
    out.set(awb, buildTimeline(awb, snapshot, entry.tracking_details));
  }
  return out;
}

/**
 * Drop the embedded `tracking_details` from a bulk entry so we can
 * pass the rest as the order-snapshot to `buildTimeline`.
 */
function stripTrackingDetails(
  entry: ShadowfaxBulkTrackEntry,
): ShadowfaxOrderSnapshot {
  const { tracking_details: _td, ...snapshot } = entry;
  void _td;
  return snapshot;
}
