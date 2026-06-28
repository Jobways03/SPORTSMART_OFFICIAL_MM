import type { SellerStatus } from '@prisma/client';

/**
 * Seller access policy — the single source of truth for "what can a
 * seller in status X do?"
 *
 * Centralised here so the same answer is given by:
 *   - `LoginSellerUseCase` (gate at credential check)
 *   - `SellerAuthGuard`     (gate on every authenticated request)
 *   - any future caller that needs to decide whether a seller is
 *     allowed to authenticate or stay authenticated.
 *
 * If you add a new status or change who-can-do-what, update this file
 * and the callers will pick it up. The rule is documented next to the
 * constant — please don't bypass `canLogin()` with an inline status
 * check elsewhere.
 */

/**
 * Statuses that are allowed to sign in and keep an active session.
 *
 * Why both `ACTIVE` and `PENDING_APPROVAL`:
 *
 * - `ACTIVE` is the normal operating state.
 * - `PENDING_APPROVAL` is the state every seller lands in after
 *   self-registration, before an admin flips them live. We *want* a
 *   PENDING seller to log in: they need to read the "pending review"
 *   banner, complete their profile, verify their email, and configure
 *   service areas. Otherwise admin would never have anything to
 *   review.
 *
 * Statuses **not** in this list and the rationale for excluding them:
 *
 * - `INACTIVE`    — operator-paused (rare). Seller can't change
 *                   anything until reactivated; blocking login keeps
 *                   the state explicit.
 * - `SUSPENDED`   — punitive. Login must be blocked so suspended
 *                   sellers can't continue acting on the platform.
 * - `DEACTIVATED` — terminal. Account effectively closed.
 *
 * IMPORTANT: this policy gates *authentication only*. Whether a
 * `PENDING_APPROVAL` seller can do business actions (allocate
 * orders, accept fulfilment, receive payouts) is enforced
 * separately in the relevant services (e.g.
 * `seller-allocation.service.ts` filters to `status === 'ACTIVE'`).
 * Login is intentionally more permissive than selling.
 */
export const LOGIN_ALLOWED_STATUSES: readonly SellerStatus[] = [
  'ACTIVE',
  'PENDING_APPROVAL',
] as const;

/**
 * Returns `true` if a seller in the given status should be allowed to
 * authenticate (or keep their existing session live). Callers should
 * prefer this helper to inline string-array checks so the policy
 * documentation stays the single source of truth.
 */
export function canLogin(status: SellerStatus): boolean {
  return LOGIN_ALLOWED_STATUSES.includes(status);
}

/**
 * Profile approval lock (2026-06).
 *
 * Once an admin APPROVES a seller (verificationStatus → VERIFIED) the seller's
 * profile is frozen for self-service: `profileLocked` is set true and the
 * seller can no longer edit any profile field or profile media. From then on
 * every change must go through the admin, who edits via the admin-only
 * AdminEditSeller endpoint (that path intentionally does NOT consult this flag).
 * Rejection clears the lock so the seller can fix and resubmit.
 *
 * `profileLocked` is deliberately a separate flag (not derived from
 * `verificationStatus`) so an admin can re-open self-editing later by clearing
 * it without de-verifying KYC — and so the read-only rule has a single source
 * of truth that every seller self-write path consults. Use this helper instead
 * of inline `profileLocked === true` checks so the rule stays consistent.
 */
export function isSellerProfileLocked(
  seller: { profileLocked?: boolean | null } | null | undefined,
): boolean {
  return seller?.profileLocked === true;
}
