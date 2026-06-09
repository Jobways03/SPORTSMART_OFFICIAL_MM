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
 * POST /admin/mfa/enroll/begin
 *
 * Throws (409 Conflict) when the admin already has MFA enrolled — the
 * MFA page uses this signal to flip into the "already enrolled" view.
 */
export function beginMfaEnrollment(): Promise<
  ApiResponse<MfaBeginEnrollmentResponse>
> {
  return apiClient<MfaBeginEnrollmentResponse>('/admin/mfa/enroll/begin', {
    method: 'POST',
  });
}

/**
 * POST /admin/mfa/enroll/complete
 *
 * On success the response data carries the 10 single-use backup codes
 * in cleartext. The API has no path to surface them again — the page
 * MUST force the admin to confirm they've stored them.
 */
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

/**
 * POST /admin/mfa/step-up
 *
 * Stamps the current session's `stepUpVerifiedAt = now` so destructive
 * routes (`@RequiresStepUp()`) accept it for the configured window
 * (default 5 minutes). Accepts a 6-digit TOTP or a XXXXX-XXXXX backup
 * code.
 */
export function stepUp(code: string): Promise<ApiResponse<null>> {
  return apiClient<null>('/admin/mfa/step-up', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * POST /admin/mfa/step-up/email/request
 *
 * Email-OTP alternative to the authenticator for step-up. Emails a
 * 6-digit code that stepUp() then accepts — no TOTP enrollment needed.
 * The response surfaces a masked recipient so the UI can confirm where
 * the code went.
 */
export interface StepUpEmailOtpResponse {
  otpExpiresIn: number;
  maskedEmail: string;
}

export function requestStepUpEmailOtp(): Promise<
  ApiResponse<StepUpEmailOtpResponse>
> {
  return apiClient<StepUpEmailOtpResponse>('/admin/mfa/step-up/email/request', {
    method: 'POST',
  });
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
 * POST /admin/auth/mfa-verify
 *
 * Trades the (challengeToken, code) pair issued by /admin/auth/login
 * for a real session-token pair. This endpoint sits OUTSIDE
 * AdminAuthGuard — the challenge token itself is the proof.
 */
export function verifyMfaChallenge(
  input: MfaVerifyChallengeInput,
): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
  return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Login email-OTP (called from the login page) ─────────────────────────

/**
 * POST /admin/auth/mfa-email/request
 *
 * Email-OTP alternative to the authenticator at login. Given the
 * short-lived challengeToken issued by /admin/auth/login, emails a
 * 6-digit code. Kept separate from verifyMfaChallenge because an email
 * OTP and a TOTP code are both 6 digits and the backend can't tell them
 * apart by shape.
 */
export function requestMfaEmailOtp(
  challengeToken: string,
): Promise<ApiResponse<{ otpExpiresIn: number }>> {
  return apiClient<{ otpExpiresIn: number }>('/admin/auth/mfa-email/request', {
    method: 'POST',
    body: JSON.stringify({ challengeToken }),
  });
}

/**
 * POST /admin/auth/mfa-email/verify
 *
 * Redeems the emailed 6-digit code (paired with the challengeToken) for
 * a real session, mirroring verifyMfaChallenge.
 */
export function verifyMfaEmailOtp(
  input: MfaVerifyChallengeInput,
): Promise<ApiResponse<MfaVerifyChallengeResponse>> {
  return apiClient<MfaVerifyChallengeResponse>('/admin/auth/mfa-email/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
