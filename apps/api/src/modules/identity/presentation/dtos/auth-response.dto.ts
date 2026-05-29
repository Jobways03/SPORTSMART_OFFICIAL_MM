export interface RegisterResponseData {
  /**
   * Phase 16 (2026-05-20) — the register endpoint now returns 202
   * Accepted with a uniform "check your inbox" payload. Both the
   * happy path (new account created) and the duplicate-email path
   * return the same shape so the public API never leaks account
   * existence. requiresVerification is always true; clients should
   * redirect to /register/verify regardless.
   *
   * userId is intentionally omitted from the response so an
   * enumeration attacker cannot tell duplicate from fresh by the
   * UUID's presence / shape.
   */
  email: string;
  requiresVerification: true;
  message: string;
}

export interface VerifyEmailOtpResponseData {
  email: string;
  verified: true;
}

export interface ResendVerificationOtpResponseData {
  email: string;
  /**
   * Uniform "if you have an unverified account we sent a new code"
   * message. The endpoint never reveals whether the email actually
   * had a pending registration — same enumeration-defence pattern
   * as the forgot-password resend.
   */
  message: string;
}

/**
 * Phase 17 (2026-05-20) — Customer login response.
 *
 * `roles` was dropped from the user payload: the storefront never
 * read it (grep `\.roles` returns zero hits), and the only value the
 * field could ever carry on this endpoint was `['CUSTOMER']` — a
 * tautology once the request reaches this controller. Server-side
 * authorisation lives in UserAuthGuard's role check on every
 * protected route, not in the client trusting a self-reported claim.
 *
 * Tokens still appear in the body for backward-compat with the
 * sessionStorage-based legacy clients. The storefront migrated to
 * cookie-only auth in Phase 17; when every persona frontend follows,
 * we can drop them from the body too.
 */
export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}
