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

  // Email-OTP MFA alternative to the authenticator. requestMfaEmailOtp
  // emails a 6-digit code; verifyMfaEmailOtp redeems it (separate from
  // verifyMfaChallenge because an email OTP and a TOTP code are both
  // 6 digits and the backend can't tell them apart by shape).
  requestMfaEmailOtp(
    challengeToken: string,
  ): Promise<ApiResponse<{ otpExpiresIn: number }>> {
    return apiClient<{ otpExpiresIn: number }>('/admin/auth/mfa-email/request', {
      method: 'POST',
      body: JSON.stringify({ challengeToken }),
    });
  },

  verifyMfaEmailOtp(
    input: MfaVerifyChallengeInput,
  ): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
    return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-email/verify', {
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

  // Phase 26 (2026-05-20) — password recovery flow. Backend has had
  // these endpoints since Phase 23; the admin frontend just never
  // surfaced a UI for them. Each step mirrors the customer / seller
  // recovery surface in shape.

  forgotPassword(
    email: string,
    captchaToken?: string,
  ): Promise<ApiResponse<null>> {
    return apiClient<null>('/admin/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, captchaToken }),
    });
  },

  verifyResetOtp(
    email: string,
    otp: string,
  ): Promise<ApiResponse<{ resetToken: string }>> {
    return apiClient<{ resetToken: string }>('/admin/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },

  resendResetOtp(email: string): Promise<ApiResponse<null>> {
    return apiClient<null>('/admin/auth/resend-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(
    resetToken: string,
    newPassword: string,
  ): Promise<ApiResponse<null>> {
    return apiClient<null>('/admin/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    });
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

// Phase 26 (2026-05-20) — /step-up now echoes the elevation window
// so the UI can render a countdown without a follow-up /status call.
export interface MfaStepUpResponse {
  stepUpVerifiedAt: string;
  stepUpExpiresAt: string;
  usedBackupCode: boolean;
}

// Phase 25 — /status surfaces MFA + backup-code state.
export interface MfaStatusResponse {
  enabled: boolean;
  enrolledAt: string | null;
  backupCodesRemaining: number;
  pendingEnrolment: boolean;
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

  stepUp(code: string): Promise<ApiResponse<MfaStepUpResponse>> {
    return apiClient<MfaStepUpResponse>('/admin/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  status(): Promise<ApiResponse<MfaStatusResponse>> {
    return apiClient<MfaStatusResponse>('/admin/mfa/status');
  },

  disable(): Promise<ApiResponse<null>> {
    return apiClient<null>('/admin/mfa/disable', { method: 'POST' });
  },

  regenerateBackupCodes(): Promise<ApiResponse<MfaCompleteEnrollmentResponse>> {
    return apiClient<MfaCompleteEnrollmentResponse>(
      '/admin/mfa/backup-codes/regenerate',
      { method: 'POST' },
    );
  },
};
