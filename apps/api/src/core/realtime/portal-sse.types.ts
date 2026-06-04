/**
 * Portal SSE shared types + the redaction / normalization tables.
 *
 * Kept in a standalone module (no Nest deps) so the projection logic is
 * pure-function testable without standing up the push service.
 */

export type SubscriberScope =
  | {
      kind: 'customer-case';
      customerId: string;
      resourceType?: string;
      resourceId?: string;
    }
  | { kind: 'admin-queue'; queues?: ReadonlyArray<EventFamily> }
  | { kind: 'seller-disputes'; sellerId: string }
  | { kind: 'franchise-cases'; franchiseId: string }
  | { kind: 'affiliate-earnings'; affiliateId: string };

/** Coarse event family derived from the domain event name prefix. */
export type EventFamily = 'returns' | 'disputes' | 'tickets' | 'sla' | 'affiliate';

/** High-level, client-stable event types. The SSE `event:` field. */
export type NormalizedType =
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'DISPUTE_MESSAGE_CREATED'
  | 'TICKET_MESSAGE_CREATED'
  | 'SLA_BREACH'
  | 'QUEUE_ITEM_UPDATED'
  | 'EARNINGS_UPDATED'
  | 'PAYOUT_UPDATED'
  | 'HEARTBEAT'
  | 'READY';

/** The resolved owners of the aggregate an event touches. */
export interface ResolvedAudience {
  customerId?: string;
  sellerId?: string;
  franchiseId?: string;
  affiliateId?: string;
}

export function familyOf(eventName: string): EventFamily | null {
  if (eventName.startsWith('returns.return.')) return 'returns';
  if (eventName.startsWith('disputes.')) return 'disputes';
  if (eventName.startsWith('tickets.')) return 'tickets';
  if (eventName.startsWith('sla.')) return 'sla';
  // Only the earnings/payout lifecycle — NOT affiliate auth/account/coupon
  // events (affiliate.logged_in / approved / coupon_created / …).
  if (
    eventName.startsWith('affiliate.commission.') ||
    eventName.startsWith('affiliate.payout.')
  ) {
    return 'affiliate';
  }
  return null;
}

/**
 * Admin-internal events that must NEVER fan out to a customer or seller
 * scope regardless of audience match — they carry finance/ops-only
 * context (rejection reasons, assignee identity, SLA breach internals).
 */
const INTERNAL_ONLY_EVENTS = new Set<string>([
  'disputes.refund_rejected',
  'tickets.assigned',
  'tickets.priority.changed',
]);

export function isInternalOnly(eventName: string): boolean {
  if (INTERNAL_ONLY_EVENTS.has(eventName)) return true;
  // The entire SLA family is an ops/admin concern.
  return eventName.startsWith('sla.');
}

/**
 * Which event families each scope is allowed to receive. SLA is admin-only;
 * customers/sellers never see the sla.* firehose. Internal-only events
 * (above) are additionally blocked for non-admin scopes.
 */
export function familyAllowedForScope(
  kind: SubscriberScope['kind'],
  family: EventFamily,
): boolean {
  switch (kind) {
    case 'admin-queue':
      return true;
    case 'customer-case':
      return family === 'returns' || family === 'disputes' || family === 'tickets';
    case 'seller-disputes':
      return family === 'disputes' || family === 'returns';
    case 'franchise-cases':
      // Franchises fulfil orders → they watch the returns/disputes on
      // their own sub-orders (never SLA/admin internals).
      return family === 'returns' || family === 'disputes';
    case 'affiliate-earnings':
      // Affiliates watch only their own commission/payout lifecycle.
      return family === 'affiliate';
    default:
      return false;
  }
}

export function normalizeType(eventName: string): NormalizedType {
  if (eventName === 'disputes.message.added') return 'DISPUTE_MESSAGE_CREATED';
  if (eventName === 'tickets.message.added') return 'TICKET_MESSAGE_CREATED';
  if (eventName.startsWith('sla.')) return 'SLA_BREACH';
  if (eventName.startsWith('affiliate.commission.')) return 'EARNINGS_UPDATED';
  if (eventName.startsWith('affiliate.payout.')) return 'PAYOUT_UPDATED';
  if (eventName === 'returns.return.requested' || eventName === 'disputes.filed') {
    return 'CASE_CREATED';
  }
  if (eventName.startsWith('returns.return.') || eventName.startsWith('disputes.')) {
    return 'CASE_UPDATED';
  }
  if (eventName.startsWith('tickets.')) return 'CASE_UPDATED';
  return 'CASE_UPDATED';
}

/**
 * Raw contact-PII / identity fields that must be stripped from EVERY
 * outbound frame (admin included). Ops looks the resource up by id; the
 * live stream never needs to carry email/phone/name/address.
 */
const PII_FIELDS = new Set<string>([
  'email',
  'phone',
  'address',
  'name',
  'customerEmail',
  'customerPhone',
  'customerName',
  'recipientEmail',
  'recipientName',
  'assigneeEmail',
  'assigneeName',
  'creatorEmail',
  'creatorName',
  'senderName',
  'filedByName',
  'body',
]);

const RESOURCE_ID_KEYS = [
  'returnId',
  'disputeId',
  'ticketId',
  'commissionId',
  'payoutRequestId',
] as const;

export function resourceIdOf(payload: Record<string, unknown>, aggregateId: string): string {
  for (const k of RESOURCE_ID_KEYS) {
    if (typeof payload[k] === 'string') return payload[k] as string;
  }
  return aggregateId;
}

function pickNumber(payload: Record<string, unknown>): string | undefined {
  return (payload['returnNumber'] ??
    payload['disputeNumber'] ??
    payload['ticketNumber']) as string | undefined;
}

function pickStatus(payload: Record<string, unknown>): string | undefined {
  return (payload['toStatus'] ??
    payload['status'] ??
    payload['qcDecision'] ??
    payload['outcome'] ??
    payload['currentStatus']) as string | undefined;
}

/**
 * Build the outbound `data` object for a given scope.
 *
 *  - customer / seller: a curated, leak-proof projection. The client uses
 *    it as a "something changed on resource X" signal and refetches detail
 *    via its authenticated REST endpoint. No PII, no financials, no
 *    internal notes — only the structural id/number/status.
 *  - admin: the full payload MINUS raw contact-PII and free-text message
 *    bodies (ops still gets ids/numbers/status/amounts/assignee-ids it
 *    needs to triage the queue).
 */
export function buildPayloadFor(
  kind: SubscriberScope['kind'],
  eventName: string,
  payload: Record<string, unknown>,
  aggregateId: string,
): Record<string, unknown> {
  const type = normalizeType(eventName);
  const resourceId = resourceIdOf(payload, aggregateId);
  const family = familyOf(eventName);

  if (kind === 'admin-queue') {
    const out: Record<string, unknown> = { type, eventName, family, resourceId };
    for (const [k, v] of Object.entries(payload)) {
      if (PII_FIELDS.has(k)) continue;
      if (k === 'messagePreview') continue; // free text may embed PII
      out[k] = v;
    }
    return out;
  }

  // customer / seller — curated projection only.
  const out: Record<string, unknown> = {
    type,
    eventName,
    family,
    resourceType: family,
    resourceId,
  };
  const number = pickNumber(payload);
  if (number) out['number'] = number;
  const status = pickStatus(payload);
  if (status) out['status'] = status;
  if (typeof payload['occurredAt'] === 'string') out['occurredAt'] = payload['occurredAt'];
  return out;
}
