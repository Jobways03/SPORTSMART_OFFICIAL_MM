// Phase 106 (2026-05-23) — Phase 103 audit Gap #1 closure.
//
// The ReturnStatus enum has `COMPLETED` as the terminal post-refund
// state; the spec / customer copy calls this state "CLOSED". A full
// enum rename would be breaking (DB enum + migrations + every joined
// query in this monorepo). Instead we expose a stable alias + a
// label map so:
//
//   • Internal code keeps using `COMPLETED` everywhere — no churn.
//   • Customer-facing surfaces (emails, order page, return detail
//     UI) read from `RETURN_STATUS_LABEL[status]` to render
//     "Closed" without leaking the internal enum.
//   • Admin tooling reads `RETURN_STATUS_ADMIN_LABEL[status]` for
//     the technical/audit-correct name.
//
// The constant CLOSED below is the canonical alias — code that needs
// to compare against "the terminal post-refund state" should import
// this rather than hardcoding 'COMPLETED'.

import type { ReturnStatus } from '../../../core/fsm/status-transitions';

/**
 * Canonical alias for the terminal post-refund state. Spec calls
 * it CLOSED; the DB enum has COMPLETED. Use this constant in code
 * that needs to express "the closed terminal" without coupling to
 * the enum value.
 */
export const RETURN_STATUS_CLOSED: ReturnStatus = 'COMPLETED';

/**
 * Customer-facing label per status. Render this in emails, order
 * pages, and return detail UI surfaces. Falls back to the raw enum
 * name if the status is missing from the map (defensive default).
 */
export const RETURN_STATUS_CUSTOMER_LABEL: Record<string, string> = {
  REQUESTED: 'Return requested',
  APPROVED: 'Return approved',
  REJECTED: 'Return rejected',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  IN_TRANSIT: 'In transit to warehouse',
  RECEIVED: 'Received at warehouse',
  QC_APPROVED: 'Quality check passed',
  QC_REJECTED: 'Quality check failed',
  PARTIALLY_APPROVED: 'Partially approved',
  REFUND_PROCESSING: 'Refund processing',
  REFUNDED: 'Refund completed',
  REFUND_FAILED: 'Refund needs attention — our team is on it',
  COMPLETED: 'Closed',
  CANCELLED: 'Cancelled',
  DISPUTE_OVERTURNED: 'Reopened (dispute)',
  DISPUTE_PARTIAL_OVERRIDE: 'Reopened (partial)',
  DISPUTE_CONFIRMED: 'Closed (dispute upheld)',
  GOODWILL_CREDITED: 'Closed (goodwill credit)',
};

/**
 * Admin-facing label. Mostly mirrors the enum name; deliberately
 * technical so audit / ops dashboards stay consistent with the
 * underlying status string.
 */
export const RETURN_STATUS_ADMIN_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PICKUP_SCHEDULED: 'Pickup Scheduled',
  IN_TRANSIT: 'In Transit',
  RECEIVED: 'Received',
  QC_APPROVED: 'QC Approved',
  QC_REJECTED: 'QC Rejected',
  PARTIALLY_APPROVED: 'Partially Approved',
  REFUND_PROCESSING: 'Refund Processing',
  REFUNDED: 'Refunded',
  REFUND_FAILED: 'Refund Failed',
  COMPLETED: 'Closed (Completed)',
  CANCELLED: 'Cancelled',
  DISPUTE_OVERTURNED: 'Dispute Overturned',
  DISPUTE_PARTIAL_OVERRIDE: 'Dispute Partial Override',
  DISPUTE_CONFIRMED: 'Dispute Confirmed',
  GOODWILL_CREDITED: 'Goodwill Credited',
};

export function customerStatusLabel(status: string): string {
  return RETURN_STATUS_CUSTOMER_LABEL[status] ?? status;
}

export function adminStatusLabel(status: string): string {
  return RETURN_STATUS_ADMIN_LABEL[status] ?? status;
}

/**
 * Is this status the closed terminal? Handles both the enum value
 * and the spec alias (CLOSED).
 */
export function isReturnClosed(status: string): boolean {
  return status === RETURN_STATUS_CLOSED || status === 'CLOSED';
}
