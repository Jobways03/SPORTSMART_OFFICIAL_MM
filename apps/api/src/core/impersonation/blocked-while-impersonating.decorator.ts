import { SetMetadata } from '@nestjs/common';

/**
 * Phase 28 (2026-05-21) — Routes that destroy state on the target
 * actor (password change, KYC submit, payout requests, bank-details
 * update) decorate with `@BlockedWhileImpersonating()`. The companion
 * `BlockedWhileImpersonatingGuard` reads this metadata and refuses
 * the request when `req.isImpersonation === true`.
 *
 * Apply to: password change, payout request, bank-details update,
 * KYC submit, email/phone change, account deletion, OTP send/verify
 * (so admin can't auto-verify their way past the target's own
 * verification flow).
 *
 * Read access, profile edits (display name, store description) stay
 * open during impersonation — that's the legitimate "view what the
 * target sees" debugging use case.
 *
 * Usage:
 *
 *   @Post('change-password')
 *   @UseGuards(SellerAuthGuard, BlockedWhileImpersonatingGuard)
 *   @BlockedWhileImpersonating()
 *   async changePassword(...) {}
 */

export const BLOCKED_WHILE_IMPERSONATING_KEY = 'blocked_while_impersonating';

export const BlockedWhileImpersonating = () =>
  SetMetadata(BLOCKED_WHILE_IMPERSONATING_KEY, true);
