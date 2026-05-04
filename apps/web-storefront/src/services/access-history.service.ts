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

export const accessHistoryService = {
  list(limit = 50): Promise<ApiResponse<{ items: AccessLogEntry[] }>> {
    return apiClient<{ items: AccessLogEntry[] }>(
      `/customer/account/access-history?limit=${limit}`,
    );
  },
};

export const KIND_LABEL: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: 'Sign in',
  LOGIN_FAILURE: 'Failed sign-in',
  LOGOUT: 'Sign out',
  TOKEN_REFRESH: 'Session refresh',
  PASSWORD_RESET: 'Password reset',
  NEW_DEVICE_DETECTED: 'New device alert',
};

export const KIND_COLOR: Record<AccessEventKind, string> = {
  LOGIN_SUCCESS: '#16a34a',
  LOGIN_FAILURE: '#dc2626',
  LOGOUT: '#6b7280',
  TOKEN_REFRESH: '#0ea5e9',
  PASSWORD_RESET: '#f59e0b',
  NEW_DEVICE_DETECTED: '#dc2626',
};
