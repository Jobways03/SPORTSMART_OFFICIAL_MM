import { apiClient, ApiResponse } from '@/lib/api-client';

export type AccessEventKind =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'LOGOUT_ALL_DEVICES'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_RESET'
  | 'NEW_DEVICE_DETECTED';

/**
 * Phase 201 (#1) — mirrors the server's customer-safe projection
 * (CustomerAccessHistoryItem). The API no longer returns actorType,
 * actorId, deviceHash, reason or metadata; `newDevice` is a derived
 * boolean badge. Do not re-add the dropped fields — they were a PII /
 * enumeration leak.
 */
export interface AccessLogEntry {
  id: string;
  kind: AccessEventKind;
  ipAddress: string | null;
  userAgent: string | null;
  succeeded: boolean;
  createdAt: string;
  newDevice?: boolean;
}

export const accessHistoryService = {
  list(limit = 50): Promise<ApiResponse<{ items: AccessLogEntry[] }>> {
    return apiClient<{ items: AccessLogEntry[] }>(
      `/customer/account/access-history?limit=${limit}`,
    );
  },
};

/**
 * Phase 201 (#19) — privacy mask for the IP column. The full IP is kept
 * server-side for forensics, but the customer-facing UI only needs a
 * coarse "is this roughly my network" signal, so we blank the host
 * portion: IPv4 keeps the first two octets (203.0.x.x); IPv6 keeps the
 * first two hextets (2001:db8:…). Anything unrecognised is shown as a
 * dash rather than risking a partial leak.
 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '—';
  const addr = ip.trim();
  if (addr.includes(':')) {
    const groups = addr.split(':').filter(Boolean);
    if (groups.length < 2) return '—';
    return `${groups[0]}:${groups[1]}:…`;
  }
  const octets = addr.split('.');
  if (octets.length !== 4) return '—';
  return `${octets[0]}.${octets[1]}.x.x`;
}

export const KIND_LABEL: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: 'Sign in',
  LOGIN_FAILURE: 'Failed sign-in',
  LOGOUT: 'Sign out',
  LOGOUT_ALL_DEVICES: 'Signed out everywhere',
  TOKEN_REFRESH: 'Session refresh',
  PASSWORD_RESET: 'Password reset',
  NEW_DEVICE_DETECTED: 'New device alert',
};

export const KIND_COLOR: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: '#16a34a',
  LOGIN_FAILURE: '#dc2626',
  LOGOUT: '#6b7280',
  LOGOUT_ALL_DEVICES: '#6b7280',
  TOKEN_REFRESH: '#0ea5e9',
  PASSWORD_RESET: '#f59e0b',
  NEW_DEVICE_DETECTED: '#dc2626',
};
