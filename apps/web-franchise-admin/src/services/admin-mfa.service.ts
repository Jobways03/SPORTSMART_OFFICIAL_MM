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

/**
 * POST /admin/mfa/step-up — stamps stepUpVerifiedAt=now so @RequiresStepUp()
 * routes accept the session for the step-up window. Accepts a 6-digit TOTP or
 * a XXXXX-XXXXX backup code. (Used by the Accounts settlement actions later.)
 */
export function stepUp(code: string): Promise<ApiResponse<null>> {
  return apiClient<null>('/admin/mfa/step-up', {
    method: 'POST',
    body: JSON.stringify({ code }),
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
