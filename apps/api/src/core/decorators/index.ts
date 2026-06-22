export { CurrentUser, CurrentUserPayload } from './current-user.decorator';
export { Roles, ROLES_KEY } from './roles.decorator';
export { Permissions, PERMISSIONS_KEY } from './permissions.decorator';
// `@Public` re-introduced (2026-06-22) to ship the global-guard model that
// Phase 24 had deferred. With GlobalAuthGuard registered, "absence of a guard"
// is no longer a safe public signal (a forgotten guard would now 401 in strict
// mode), so intentionally-public routes opt out explicitly with `@Public()`.
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export {
  Policy,
  POLICY_METADATA,
  type PolicyDescriptor,
  type PolicyContextSource,
} from './policy.decorator';
