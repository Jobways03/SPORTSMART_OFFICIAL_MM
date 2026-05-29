/**
 * Phase 20 (2026-05-20) — Uniform franchise register response.
 *
 * Both the happy path AND the duplicate-email-or-phone path return
 * the SAME shape so the public API never reveals account existence.
 * Frontend always redirects to /register/verify regardless.
 *
 * `verificationEmailSent` surfaces whether the OTP email actually
 * shipped — when false, the verify page prompts a resend.
 */
export interface FranchiseRegisterResponseData {
  email: string;
  requiresVerification: true;
  verificationEmailSent: boolean;
  message: string;
  /** Present only on the fresh-registration path (omitted on
   *  duplicate-email/phone to keep enumeration safe). */
  franchiseId?: string;
}

export interface FranchiseVerifyEmailResponseData {
  email: string;
  verified: true;
}

export interface FranchiseResendVerificationOtpResponseData {
  email: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface FranchiseLoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  franchise: {
    franchiseId: string;
    franchiseCode: string;
    ownerName: string;
    businessName: string;
    email: string;
    phoneNumber: string;
    roles: string[];
    status: string;
    isEmailVerified: boolean;
  };
}
