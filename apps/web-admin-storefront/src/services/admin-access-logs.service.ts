import { apiClient, ApiResponse } from '@/lib/api-client';

export type AccessActorType =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'SELLER'
  | 'FRANCHISE'
  | 'AFFILIATE';

export type AccessEventKind =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  // Phase 201 (#17) — "sign out everywhere".
  | 'LOGOUT_ALL_DEVICES'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_RESET'
  | 'NEW_DEVICE_DETECTED'
  // Phase 207 (#3) — 2FA / reset-OTP verify outcomes.
  | 'MFA_VERIFY_SUCCESS'
  | 'MFA_VERIFY_FAILED'
  | 'OTP_VERIFY_SUCCESS'
  | 'OTP_VERIFY_FAILED';

export interface AccessLogEntry {
  id: string;
  actorType: AccessActorType;
  actorId: string;
  actorRole: string | null;
  kind: AccessEventKind;
  ipAddress: string | null;
  userAgent: string | null;
  deviceHash: string | null;
  succeeded: boolean;
  reason: string | null;
  createdAt: string;
}

// Sub-roles that exist within actorType=ADMIN (mirrors the ADMIN_ROLES
// constant in core/guards/admin-auth.guard.ts). Other actor types may
// gain sub-roles later; for now only ADMIN has them.
export type AdminSubRole =
  | 'SUPER_ADMIN'
  | 'SELLER_ADMIN'
  | 'SELLER_SUPPORT'
  | 'SELLER_OPERATIONS'
  | 'AFFILIATE_ADMIN';

export const ADMIN_SUB_ROLES: AdminSubRole[] = [
  'SUPER_ADMIN',
  'SELLER_ADMIN',
  'SELLER_SUPPORT',
  'SELLER_OPERATIONS',
  'AFFILIATE_ADMIN',
];

/**
 * Human-friendly labels for admin sub-roles. Mirrors the wording shown
 * in the role-picker dropdown elsewhere in the admin UI so the same
 * role is referred to the same way across pages.
 *
 * `formatRoleLabel()` falls back to title-casing an unknown role so
 * future additions still render sensibly without a code change.
 */
export const ADMIN_SUB_ROLE_LABEL: Record<AdminSubRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  SELLER_ADMIN: 'Seller Admin',
  SELLER_SUPPORT: 'Seller Support',
  SELLER_OPERATIONS: 'Seller Operations',
  AFFILIATE_ADMIN: 'Affiliate Admin',
};

export function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  if ((ADMIN_SUB_ROLE_LABEL as Record<string, string>)[role]) {
    return (ADMIN_SUB_ROLE_LABEL as Record<string, string>)[role];
  }
  // Title-case unknown role keys: SELLER_NEW_THING → Seller New Thing.
  return role
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

export interface ByRoleResponse {
  actorRole: string;
  actorType: AccessActorType | null;
  since: string;
  hours: number;
  items: AccessLogEntry[];
}

export interface RecentActorRow {
  actorType: AccessActorType;
  actorId: string;
  actorRole: string | null;
  eventCount: number;
  lastEventAt: string;
  lastEventKind: AccessEventKind | null;
  lastEventSucceeded: boolean | null;
  lastEventIp: string | null;
  // Populated for ADMIN actors so operators can tell two SELLER_OPERATIONS
  // admins apart. Null for actor types not yet enriched (CUSTOMER, SELLER,
  // FRANCHISE, AFFILIATE) and for failed-login pseudo-actors that don't
  // have a matching admins row.
  displayName: string | null;
  email: string | null;
  // Additional custom-role names from admin_role_assignments. Excludes
  // system roles (which are the same as the primary role enum).
  customRoles: string[] | null;
}

export interface RecentActorsResponse {
  actorType: AccessActorType;
  since: string;
  hours: number;
  items: RecentActorRow[];
}

export interface RecentFailuresResponse {
  since: string;
  hours: number;
  items: AccessLogEntry[];
}

export interface SpikeRow {
  actorType: AccessActorType;
  actorId: string;
  ipAddress: string | null;
  failureCount: number;
  lastFailureAt: string;
}

export interface SpikeResponse {
  since: string;
  hours: number;
  minFailures: number;
  items: SpikeRow[];
}

// Phase 207 (#6) — distributed-attack views.
export interface IpSpikeRow {
  ipAddress: string | null;
  failureCount: number;
  distinctAccounts: number;
  lastFailureAt: string;
}
export interface IpSpikeResponse {
  since: string;
  hours: number;
  minFailures: number;
  items: IpSpikeRow[];
}
export interface AccountSpikeRow {
  actorType: AccessActorType;
  actorId: string;
  failureCount: number;
  distinctIps: number;
  lastFailureAt: string;
}
export interface AccountSpikeResponse {
  since: string;
  hours: number;
  minFailures: number;
  items: AccountSpikeRow[];
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminAccessLogsService = {
  listForActor(
    actorType: AccessActorType,
    actorId: string,
    filter: {
      kind?: AccessEventKind;
      fromDate?: string;
      toDate?: string;
      limit?: number;
    } = {},
  ): Promise<ApiResponse<{ items: AccessLogEntry[] }>> {
    return apiClient(
      `/admin/access-logs/${actorType}/${encodeURIComponent(actorId)}${buildQs(filter)}`,
    );
  },

  failedLoginSpike(
    args: { hours?: number; minFailures?: number } = {},
  ): Promise<ApiResponse<SpikeResponse>> {
    return apiClient<SpikeResponse>(
      `/admin/access-logs/spike/failed-logins${buildQs(args)}`,
    );
  },

  // Phase 207 (#6) — one source IP across many accounts (spray / stuffing).
  ipSpike(
    args: { hours?: number; minFailures?: number } = {},
  ): Promise<ApiResponse<IpSpikeResponse>> {
    return apiClient<IpSpikeResponse>(
      `/admin/access-logs/spike/by-ip${buildQs(args)}`,
    );
  },

  // Phase 207 (#6) — one account across many IPs (distributed botnet).
  accountSpike(
    args: { hours?: number; minFailures?: number } = {},
  ): Promise<ApiResponse<AccountSpikeResponse>> {
    return apiClient<AccountSpikeResponse>(
      `/admin/access-logs/spike/by-account${buildQs(args)}`,
    );
  },

  listByRole(
    actorRole: string,
    args: {
      actorType?: AccessActorType;
      kind?: AccessEventKind;
      hours?: number;
      limit?: number;
    } = {},
  ): Promise<ApiResponse<ByRoleResponse>> {
    return apiClient<ByRoleResponse>(
      `/admin/access-logs/by-role/${encodeURIComponent(actorRole)}${buildQs(args)}`,
    );
  },

  recentActors(
    args: {
      actorType?: AccessActorType;
      actorRole?: string;
      hours?: number;
      limit?: number;
    } = {},
  ): Promise<ApiResponse<RecentActorsResponse>> {
    return apiClient<RecentActorsResponse>(
      `/admin/access-logs/recent-actors${buildQs(args)}`,
    );
  },

  recentFailures(
    args: {
      actorType?: AccessActorType;
      hours?: number;
      limit?: number;
    } = {},
  ): Promise<ApiResponse<RecentFailuresResponse>> {
    return apiClient<RecentFailuresResponse>(
      `/admin/access-logs/recent-failures${buildQs(args)}`,
    );
  },
};

export const KIND_LABEL: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: 'Sign in',
  LOGIN_FAILURE: 'Failed sign-in',
  LOGOUT: 'Sign out',
  LOGOUT_ALL_DEVICES: 'Sign out (all devices)',
  TOKEN_REFRESH: 'Token refresh',
  PASSWORD_RESET: 'Password reset',
  NEW_DEVICE_DETECTED: 'New device',
  MFA_VERIFY_SUCCESS: 'MFA verified',
  MFA_VERIFY_FAILED: 'MFA failed',
  OTP_VERIFY_SUCCESS: 'OTP verified',
  OTP_VERIFY_FAILED: 'OTP failed',
};

export const KIND_COLOR: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: '#16a34a',
  LOGIN_FAILURE: '#dc2626',
  LOGOUT: '#6b7280',
  LOGOUT_ALL_DEVICES: '#6b7280',
  TOKEN_REFRESH: '#0ea5e9',
  PASSWORD_RESET: '#f59e0b',
  NEW_DEVICE_DETECTED: '#dc2626',
  MFA_VERIFY_SUCCESS: '#16a34a',
  MFA_VERIFY_FAILED: '#dc2626',
  OTP_VERIFY_SUCCESS: '#16a34a',
  OTP_VERIFY_FAILED: '#dc2626',
};

export function browserOf(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Other';
}
