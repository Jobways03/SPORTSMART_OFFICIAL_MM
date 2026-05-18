export { RolesGuard } from './roles.guard';
export { PermissionsGuard } from './permissions.guard';
export { PolicyGuard } from './policy.guard';
export { AdminAuthGuard } from './admin-auth.guard';
export { SellerAuthGuard } from './seller-auth.guard';
export { UserAuthGuard } from './user-auth.guard';
export { FranchiseAuthGuard } from './franchise-auth.guard';
export { FranchiseActiveGuard } from './franchise-active.guard';
export { AffiliateAuthGuard } from './affiliate-auth.guard';
export { AnyAuthGuard } from './any-auth.guard';
// Phase 10 (PR 10.10) — step-up auth for destructive ops. Re-export
// from core/step-up via the guards index so callers can pick up the
// guard + decorator alongside the existing auth primitives.
export { StepUpGuard } from '../step-up/step-up.guard';
export {
  RequiresStepUp,
  REQUIRES_STEP_UP_METADATA_KEY,
  type RequiresStepUpOptions,
} from '../step-up/requires-step-up.decorator';
