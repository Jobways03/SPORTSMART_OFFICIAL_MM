import {apiClient, ApiResponse} from '../lib/api-client';

// Sign-in activity. Mirrors the web storefront's access-history.service +
// /account/access-history page and the server's customer-safe projection
// (no actorId / deviceHash / metadata — those were a PII leak).

export type AccessEventKind =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'LOGOUT_ALL_DEVICES'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_RESET'
  | 'NEW_DEVICE_DETECTED';

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
  list(limit = 50): Promise<ApiResponse<{items: AccessLogEntry[]}>> {
    return apiClient<{items: AccessLogEntry[]}>(
      `/customer/account/access-history?limit=${limit}`,
    );
  },
};

export const KIND_LABEL: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: 'Sign in',
  LOGIN_FAILURE: 'Failed sign-in',
  LOGOUT: 'Sign out',
  LOGOUT_ALL_DEVICES: 'Signed out everywhere',
  TOKEN_REFRESH: 'Session refresh',
  PASSWORD_RESET: 'Password reset',
  NEW_DEVICE_DETECTED: 'New device alert',
};

// Coarse "is this roughly my network" mask — the full IP stays server-side.
// IPv4 keeps the first two octets; IPv6 the first two hextets.
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
