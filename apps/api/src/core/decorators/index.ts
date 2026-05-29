export { CurrentUser, CurrentUserPayload } from './current-user.decorator';
export { Roles, ROLES_KEY } from './roles.decorator';
export { Permissions, PERMISSIONS_KEY } from './permissions.decorator';
// Phase 24 (2026-05-20) — `@Public` decorator removed. Public routes
// are signalled by the ABSENCE of a `@UseGuards(<X>AuthGuard)`
// directive, which is the convention every controller already uses.
// The decorator existed for a global-guard model that never shipped,
// and zero call sites referenced it. Keeping it around was a false
// signal that a "marked public" semantics existed.
export {
  Policy,
  POLICY_METADATA,
  type PolicyDescriptor,
  type PolicyContextSource,
} from './policy.decorator';
