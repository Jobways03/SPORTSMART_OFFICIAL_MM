import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminLoginPayload {
  email: string;
  password: string;
}

export interface AdminLoginSession {
  mfaRequired?: false;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: {
    adminId: string;
    name: string;
    email: string;
    role: string;
  };
}

/**
 * Returned by /admin/auth/login when the admin has MFA enrolled
 * (`mfaEnabledAt != null`). The caller must POST the TOTP code +
 * challengeToken to /admin/auth/mfa-verify to obtain the real session.
 */
export interface AdminLoginMfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  challengeExpiresIn: number;
  admin: {
    adminId: string;
    email: string;
  };
}

export type AdminLoginResponseData = AdminLoginSession | AdminLoginMfaChallenge;

export function isMfaChallenge(
  data: AdminLoginResponseData,
): data is AdminLoginMfaChallenge {
  return (data as AdminLoginMfaChallenge).mfaRequired === true;
}

export interface AdminMeResponseData {
  adminId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export const adminAuthService = {
  login(payload: AdminLoginPayload): Promise<ApiResponse<AdminLoginResponseData>> {
    // portalType identifies THIS portal so the API can reject a portal-specific
    // admin role (RETAILER_ADMIN / FRANCHISE_ADMIN / AFFILIATE_ADMIN) that tries
    // to sign in here. SUPER_ADMIN + generic roles are allowed from any portal.
    return apiClient<AdminLoginResponseData>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ ...payload, portalType: 'D2C' }),
    });
  },

  logout(): Promise<ApiResponse> {
    return apiClient('/admin/auth/logout', {
      method: 'POST',
    });
  },

  getMe(): Promise<ApiResponse<AdminMeResponseData>> {
    return apiClient<AdminMeResponseData>('/admin/auth/me');
  },
};
