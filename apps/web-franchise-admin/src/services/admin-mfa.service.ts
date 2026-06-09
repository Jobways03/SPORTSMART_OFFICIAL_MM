import { apiClient, ApiResponse } from '@/lib/api-client';

// ── Enrolment ────────────────────────────────────────────────────────────

export interface MfaBeginEnrollmentResponse {
  /** otpauth://totp/... URL ready for QR-code rendering or manual entry. */
  otpAuthUrl: string;
  /** Cleartext base32 secret; embedded in otpAuthUrl, surfaced for manual entry. */
  secret: string;
}

export interface MfaCompleteEnrollmentResponse {
  /** Cleartext backup codes — shown ONCE; server stores hashes only. */
  backupCodes: string[];
}

/**
 * POST /admin/mfa/enroll/begin — 409 when already enrolled (page flips to the
 * "already enrolled" view). The admin-mfa endpoints are scoped by req.adminId,
 * so the same franchise-admin JWT works unchanged (no persona scoping).
 */
export function beginMfaEnrollment(): Promise<
  ApiResponse<MfaBeginEnrollmentResponse>
> {
  return apiClient<MfaBeginEnrollmentResponse>('/admin/mfa/enroll/begin', {
    method: 'POST',
  });
}

/** POST /admin/mfa/enroll/complete — returns the one-time backup codes. */
export function completeMfaEnrollment(
  code: string,
): Promise<ApiResponse<MfaCompleteEnrollmentResponse>> {
  return apiClient<MfaCompleteEnrollmentResponse>(
    '/admin/mfa/enroll/complete',
    {
      method: 'POST',
      body: JSON.stringify({ code }),
    },
  );
}

// ── Step-up ──────────────────────────────────────────────────────────────

export interface MfaStepUpResponse {
  stepUpVerifiedAt: string;
  stepUpExpiresAt: string;
  usedBackupCode: boolean;
}

/**
 * POST /admin/mfa/step-up — stamps stepUpVerifiedAt=now so @RequiresStepUp()
 * routes accept the session for the step-up window. Accepts a 6-digit TOTP, a
 * XXXXX-XXXXX backup code, or a 6-digit emailed step-up code (see
 * requestStepUpEmailOtp). Wired into the shared api-client's STEP_UP_REQUIRED
 * interceptor via StepUpHandlerProvider.
 */
export function stepUp(
  code: string,
): Promise<ApiResponse<MfaStepUpResponse>> {
  return apiClient<MfaStepUpResponse>('/admin/mfa/step-up', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * POST /admin/mfa/step-up/email/request — emails a 6-digit step-up code that
 * stepUp() then accepts. The alternative to an authenticator app for admins
 * without TOTP enrollment.
 */
export function requestStepUpEmailOtp(): Promise<
  ApiResponse<{ otpExpiresIn: number; maskedEmail: string }>
> {
  return apiClient<{ otpExpiresIn: number; maskedEmail: string }>(
    '/admin/mfa/step-up/email/request',
    { method: 'POST' },
  );
}

// ── Login challenge (called from the login page) ─────────────────────────

export interface MfaVerifyChallengeInput {
  challengeToken: string;
  code: string;
}

export interface MfaVerifyChallengeResponse {
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
 * POST /admin/auth/mfa-verify — trades (challengeToken, code) for a real
 * session-token pair. Sits OUTSIDE AdminAuthGuard (the challenge token is the
 * proof). Called when login returns an MFA challenge.
 */
export function verifyMfaChallenge(
  input: MfaVerifyChallengeInput,
): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
  return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Email-OTP MFA alternative to the authenticator at login. requestMfaEmailOtp
// emails a 6-digit code; verifyMfaEmailOtp redeems it (separate endpoint from
// verifyMfaChallenge because an emailed OTP and a TOTP code are both 6 digits
// and the backend can't tell them apart by shape).

/** POST /admin/auth/mfa-email/request — emails a 6-digit login OTP. */
export function requestMfaEmailOtp(
  challengeToken: string,
): Promise<ApiResponse<{ otpExpiresIn: number }>> {
  return apiClient<{ otpExpiresIn: number }>('/admin/auth/mfa-email/request', {
    method: 'POST',
    body: JSON.stringify({ challengeToken }),
  });
}

/** POST /admin/auth/mfa-email/verify — redeems the emailed login OTP. */
export function verifyMfaEmailOtp(
  input: MfaVerifyChallengeInput,
): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
  return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-email/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
