export { RolesGuard } from './roles.guard';
export { PermissionsGuard } from './permissions.guard';
export { PolicyGuard } from './policy.guard';
export { AdminAuthGuard } from './admin-auth.guard';
export { SellerAuthGuard } from './seller-auth.guard';
export { UserAuthGuard } from './user-auth.guard';
export { FranchiseAuthGuard } from './franchise-auth.guard';
export { FranchiseActiveGuard } from './franchise-active.guard';
// Phase 159u (staff-auth) — staff token guard + the dual owner-or-staff guard.
export { FranchiseStaffAuthGuard } from './franchise-staff-auth.guard';
export { FranchiseAccessGuard } from './franchise-access.guard';
export { AffiliateAuthGuard } from './affiliate-auth.guard';
export { AnyAuthGuard } from './any-auth.guard';
// Phase 38 — D2C / RETAIL seller-type scoping. Stack after one of the
// auth guards. See seller-type.guard.ts for the full pattern.
export { D2cOnlyGuard, RetailOnlyGuard, type SellerType } from './seller-type.guard';
// Phase 10 (PR 10.10) — step-up auth for destructive ops. Re-export
// from core/step-up via the guards index so callers can pick up the
// guard + decorator alongside the existing auth primitives.
export { StepUpGuard } from '../step-up/step-up.guard';
export {
  RequiresStepUp,
  REQUIRES_STEP_UP_METADATA_KEY,
  type RequiresStepUpOptions,
} from '../step-up/requires-step-up.decorator';

// Phase 28 (2026-05-21) — blocks destructive routes when the current
// request is authenticated via an admin impersonation token. Pairs
// with @BlockedWhileImpersonating() and depends on seller / franchise
// auth guards populating req.isImpersonation upstream.
export { BlockedWhileImpersonatingGuard } from '../impersonation/blocked-while-impersonating.guard';
export {
  BlockedWhileImpersonating,
  BLOCKED_WHILE_IMPERSONATING_KEY,
} from '../impersonation/blocked-while-impersonating.decorator';
