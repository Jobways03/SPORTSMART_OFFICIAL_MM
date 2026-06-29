import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'any_permissions';
/**
 * OR-gate: the route is allowed when the user holds ANY ONE of these
 * permissions (contrast @Permissions, which requires ALL). For shared,
 * low-sensitivity routes consumed by more than one admin persona — e.g. the
 * logistics courier-capability list both seller AND franchise admins legitimately
 * read. Combine with @Permissions only if you need (all of X) AND (any of Y).
 */
export const AnyPermissions = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
