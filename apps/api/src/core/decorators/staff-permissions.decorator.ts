import { SetMetadata } from '@nestjs/common';

/**
 * Phase 159u (staff-auth B3) — the staff permission a route requires. Enforced
 * by FranchiseAccessGuard for STAFF tokens; the franchise OWNER bypasses it
 * (the owner holds every capability over their own franchise).
 */
export const STAFF_PERMISSIONS_KEY = 'staffPermission';
export const StaffPermissions = (permission: string) =>
  SetMetadata(STAFF_PERMISSIONS_KEY, permission);
