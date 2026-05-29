/**
 * Phase 18 (2026-05-20) — uniform seller register response.
 *
 * Two changes vs the prior shape:
 *
 *   1. Both the happy path AND the duplicate-email-or-phone path
 *      return the SAME payload so the public API doesn't leak
 *      account existence. The frontend redirects to /register/verify
 *      regardless; the duplicate path silently absorbs.
 *
 *   2. `verificationEmailSent` surfaces whether the OTP email
 *      actually shipped. A `false` here tells the verify page to
 *      show a "we couldn't email you — request a new code" banner
 *      instead of pretending everything worked.
 *
 *   3. phoneNumber removed from the response (audit: "minor data
 *      exposure on what might be a logged response"). The seller
 *      already knows their phone.
 *
 *   4. sellerName / sellerShopName removed too — same reason; the
 *      seller already knows what they typed in.
 *
 *   5. sellerId still returned on the fresh path so admin tools can
 *      correlate; on the duplicate path it's not present (a uniform
 *      "if your account exists" message has no id to share).
 */
export interface SellerRegisterResponseData {
  email: string;
  requiresVerification: true;
  verificationEmailSent: boolean;
  message: string;
  sellerId?: string;
}

export interface SellerVerifyEmailResponseData {
  email: string;
  verified: true;
}

export interface SellerResendVerificationOtpResponseData {
  email: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface SellerLoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  seller: {
    sellerId: string;
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    roles: string[];
    status: string;
    isEmailVerified: boolean;
  };
}
