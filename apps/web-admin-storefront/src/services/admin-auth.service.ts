import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminLoginSession {
  mfaRequired?: false;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: { adminId: string; name: string; email: string; role: string };
}

/**
 * Returned by /admin/auth/login when the admin has MFA enrolled. The
 * caller must POST the TOTP code + challengeToken to
 * /admin/auth/mfa-verify to obtain the real session.
 */
export interface AdminLoginMfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  challengeExpiresIn: number;
  admin: { adminId: string; email: string };
}

export type AdminLoginResponse = AdminLoginSession | AdminLoginMfaChallenge;

export function isMfaChallenge(
  data: AdminLoginResponse,
): data is AdminLoginMfaChallenge {
  return (data as AdminLoginMfaChallenge).mfaRequired === true;
}

export interface MfaVerifyChallengeInput {
  challengeToken: string;
  code: string;
}

export interface MfaVerifyChallengeResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: { adminId: string; name: string; email: string; role: string };
}

export const adminAuthService = {
  login(email: string, password: string): Promise<ApiResponse<AdminLoginResponse>> {
    return apiClient<AdminLoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  verifyMfaChallenge(
    input: MfaVerifyChallengeInput,
  ): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
    return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  logout(): Promise<ApiResponse> {
    return apiClient('/admin/auth/logout', { method: 'POST' });
  },

  getMe(): Promise<ApiResponse<any>> {
    return apiClient('/admin/auth/me');
  },
};

// ── MFA enrolment ────────────────────────────────────────────────────────

export interface MfaBeginEnrollmentResponse {
  otpAuthUrl: string;
  secret: string;
}

export interface MfaCompleteEnrollmentResponse {
  backupCodes: string[];
}

export const adminMfaService = {
  beginEnrollment(): Promise<ApiResponse<MfaBeginEnrollmentResponse>> {
    return apiClient<MfaBeginEnrollmentResponse>('/admin/mfa/enroll/begin', {
      method: 'POST',
    });
  },

  completeEnrollment(
    code: string,
  ): Promise<ApiResponse<MfaCompleteEnrollmentResponse>> {
    return apiClient<MfaCompleteEnrollmentResponse>(
      '/admin/mfa/enroll/complete',
      { method: 'POST', body: JSON.stringify({ code }) },
    );
  },

  stepUp(code: string): Promise<ApiResponse<null>> {
    return apiClient<null>('/admin/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },
};
