import { SetMetadata } from '@nestjs/common';

/**
 * Phase 10 (PR 10.10) — Step-up auth decorator.
 *
 * Apply to controller methods (or whole controllers) that mutate
 * "high-stakes" state — admin deletion, high-value refunds, MFA
 * rotation, credential rotation, etc. The companion `StepUpGuard`
 * inspects the metadata, looks up the current admin session's
 * `stepUpVerifiedAt`, and rejects the request if no fresh step-up
 * has happened within `maxAgeMs`.
 *
 * Default window: 5 minutes. Long enough that an admin doing a
 * series of destructive ops in one sitting only enters the TOTP
 * once; short enough that a stolen session token + walked-away
 * laptop can't be used to drain the system later.
 *
 * Usage:
 *
 *   @Post('/admins/:id/delete')
 *   @UseGuards(AdminAuthGuard, StepUpGuard)
 *   @RequiresStepUp()
 *   async deleteAdmin() { ... }
 *
 *   // Tighter window for the most sensitive action:
 *   @RequiresStepUp({ maxAgeMs: 60_000 })  // 1 minute
 */

export const REQUIRES_STEP_UP_METADATA_KEY = 'requires_step_up';

export interface RequiresStepUpOptions {
  /**
   * Max age in milliseconds of the session's last step-up verification.
   * Default 5 minutes. Set lower for the most destructive routes.
   */
  maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

export const RequiresStepUp = (options: RequiresStepUpOptions = {}) =>
  SetMetadata(REQUIRES_STEP_UP_METADATA_KEY, {
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
  });
