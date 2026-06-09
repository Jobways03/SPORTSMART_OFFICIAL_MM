import { apiFetch } from '@/lib/api';

/**
 * Affiliate-admin MFA service. Mirrors web-admin-storefront's
 * admin-auth.service.ts (adminAuthService + adminMfaService), but adapted
 * to this app's `apiFetch` contract: apiFetch returns the unwrapped `.data`
 * of the API envelope and THROWS an ApiError on any non-2xx response. So
 * these methods resolve with the data payload on success and reject on
 * failure — callers use try/catch rather than checking `res.success`.
 *
 * The backend endpoints are identical to the ones the super-admin panel
 * uses (admin tokens, /admin/auth + /admin/mfa). They are already live; do
 * not change the backend.
 */

// ── Login MFA challenge (email-OTP alternative to the authenticator) ──────

export interface MfaVerifyChallengeResponse {
  accessToken?: string;
  token?: string;
  refreshToken?: string;
  expiresIn?: number;
  admin: { adminId: string; name?: string; email: string; role: string };
}

export const adminAuthService = {
  /**
   * Email a 6-digit login MFA code for an active sign-in challenge.
   * POST /admin/auth/mfa-email/request
   */
  requestMfaEmailOtp(
    challengeToken: string,
  ): Promise<{ otpExpiresIn: number }> {
    return apiFetch<{ otpExpiresIn: number }>('/admin/auth/mfa-email/request', {
      method: 'POST',
      body: JSON.stringify({ challengeToken }),
    });
  },

  /**
   * Redeem the emailed login MFA code and obtain a session.
   * POST /admin/auth/mfa-email/verify
   */
  verifyMfaEmailOtp(input: {
    challengeToken: string;
    code: string;
  }): Promise<MfaVerifyChallengeResponse> {
    return apiFetch<MfaVerifyChallengeResponse>('/admin/auth/mfa-email/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Redeem a TOTP / backup code for an active sign-in challenge.
   * POST /admin/auth/mfa-verify (kept so the existing TOTP path works).
   */
  verifyMfaChallenge(input: {
    challengeToken: string;
    code: string;
  }): Promise<MfaVerifyChallengeResponse> {
    return apiFetch<MfaVerifyChallengeResponse>('/admin/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};

// ── Step-up (re-authentication for destructive routes) ────────────────────

export interface MfaStepUpResponse {
  stepUpVerifiedAt?: string;
  stepUpExpiresAt?: string;
  usedBackupCode?: boolean;
}

export interface StepUpEmailOtpResponse {
  otpExpiresIn: number;
  maskedEmail?: string;
}

export const adminMfaService = {
  /**
   * Verify a step-up code (TOTP, backup, or emailed code).
   * POST /admin/mfa/step-up — resolves on success, throws ApiError on failure.
   */
  stepUp(code: string): Promise<MfaStepUpResponse> {
    return apiFetch<MfaStepUpResponse>('/admin/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /**
   * Email a 6-digit step-up code that stepUp() then accepts — the
   * no-authenticator alternative (no TOTP enrollment needed).
   * POST /admin/mfa/step-up/email/request
   */
  requestStepUpEmailOtp(): Promise<StepUpEmailOtpResponse> {
    return apiFetch<StepUpEmailOtpResponse>('/admin/mfa/step-up/email/request', {
      method: 'POST',
    });
  },
};
