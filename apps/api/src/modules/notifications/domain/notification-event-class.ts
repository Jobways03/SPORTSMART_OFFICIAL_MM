/**
 * Phase 185 (#8) / Phase 189 (#1/#2/#6) — canonical notification event
 * classes + per-class metadata.
 *
 * `NotificationPreference.eventClass` stays a freeform String column (NOT a
 * Prisma enum): historical rows hold operational classes outside the
 * customer grid (e.g. 'admin.manual', 'admin.test_send'), and a hard enum
 * migration would reject them. The drift risk the audit flags is closed
 * instead by THIS single source of truth — the customer + admin write
 * boundaries validate every eventClass against it, so the customer-
 * controllable grid can never drift.
 *
 * Phase 189 adds `locked` classes (SECURITY, ACCOUNT): account-critical
 * alerts the customer can NOT disable, satisfying the spec's "security/
 * account-critical alerts cannot be disabled" requirement. Keep this list
 * and the storefront preference grid in lockstep.
 */
export type EventClassGroup = 'TRANSACTIONAL' | 'PROMOTIONAL' | 'CRITICAL';

export interface EventClassMeta {
  /** Human label for the storefront grid. */
  label: string;
  /** Visual + policy grouping. */
  group: EventClassGroup;
  /** When true, the customer may NOT disable this class (security/legal). */
  locked: boolean;
}

export const NOTIFICATION_EVENT_CLASS_META: Record<string, EventClassMeta> = {
  // ── Transactional (default on; customer may mute, with a warning UI) ──
  order: { label: 'Order updates', group: 'TRANSACTIONAL', locked: false },
  payment: { label: 'Payments', group: 'TRANSACTIONAL', locked: false },
  refund: { label: 'Returns & refunds', group: 'TRANSACTIONAL', locked: false },
  wallet: { label: 'Wallet', group: 'TRANSACTIONAL', locked: false },
  ticket: { label: 'Support', group: 'TRANSACTIONAL', locked: false },
  // ── Promotional (default on; opt-out freely) ─────────────────────────
  loyalty: { label: 'Loyalty & rewards', group: 'PROMOTIONAL', locked: false },
  marketing: { label: 'Promotions & marketing', group: 'PROMOTIONAL', locked: false },
  // ── Critical (always on — cannot be disabled by the customer) ────────
  security: { label: 'Security alerts', group: 'CRITICAL', locked: true },
  account: { label: 'Account & legal notices', group: 'CRITICAL', locked: true },
};

/** Ordered list of canonical class keys. */
export const NOTIFICATION_EVENT_CLASSES = Object.keys(
  NOTIFICATION_EVENT_CLASS_META,
) as ReadonlyArray<string>;

export function isKnownEventClass(value: string): boolean {
  return value in NOTIFICATION_EVENT_CLASS_META;
}

/** True when the customer is NOT allowed to disable this class. */
export function isLockedEventClass(value: string): boolean {
  return NOTIFICATION_EVENT_CLASS_META[value]?.locked === true;
}

/** The class keys the customer may freely toggle (non-locked). */
export function unlockedEventClasses(): string[] {
  return NOTIFICATION_EVENT_CLASSES.filter((c) => !isLockedEventClass(c));
}
