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
  | 'TOKEN_REFRESH'
  | 'PASSWORD_RESET'
  | 'NEW_DEVICE_DETECTED';

export interface AccessLogEntry {
  id: string;
  actorType: AccessActorType;
  actorId: string;
  kind: AccessEventKind;
  ipAddress: string | null;
  userAgent: string | null;
  deviceHash: string | null;
  succeeded: boolean;
  reason: string | null;
  createdAt: string;
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
};

export const KIND_LABEL: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: 'Sign in',
  LOGIN_FAILURE: 'Failed sign-in',
  LOGOUT: 'Sign out',
  TOKEN_REFRESH: 'Token refresh',
  PASSWORD_RESET: 'Password reset',
  NEW_DEVICE_DETECTED: 'New device',
};

export const KIND_COLOR: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: '#16a34a',
  LOGIN_FAILURE: '#dc2626',
  LOGOUT: '#6b7280',
  TOKEN_REFRESH: '#0ea5e9',
  PASSWORD_RESET: '#f59e0b',
  NEW_DEVICE_DETECTED: '#dc2626',
};

export function browserOf(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Other';
}
