import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminLoginPayload {
  email: string;
  password: string;
}

export interface AdminLoginResponseData {
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

// When the admin has MFA enrolled, /admin/auth/login returns a challenge
// instead of tokens — the login page must trade it via verifyMfaChallenge.
export interface AdminLoginMfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  challengeExpiresIn: number;
  admin: { adminId: string; email: string };
}

export function isMfaChallenge(
  d: AdminLoginResponseData | AdminLoginMfaChallenge | undefined | null,
): d is AdminLoginMfaChallenge {
  return (d as AdminLoginMfaChallenge | undefined)?.mfaRequired === true;
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
  login(
    payload: AdminLoginPayload,
  ): Promise<ApiResponse<AdminLoginResponseData | AdminLoginMfaChallenge>> {
    return apiClient<AdminLoginResponseData | AdminLoginMfaChallenge>(
      '/admin/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
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
