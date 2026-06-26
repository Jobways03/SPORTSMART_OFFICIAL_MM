import { apiClient, ApiResponse } from '@/lib/api-client';

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  /**
   * Phase 21 (2026-05-20) — optional India mobile number collected at
   * registration. Backend validates with strict `^[6-9]\d{9}$` after
   * stripping non-digits.
   */
  phone?: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing?: boolean;
  captchaToken?: string;
}

/**
 * Phase 16 (2026-05-20) — register response is now uniform across the
 * happy path and the duplicate-email path. The frontend treats both
 * the same way: redirect to /register/verify and prompt the user
 * for the OTP that's (hopefully) in their inbox.
 */
export interface RegisterResponseData {
  email: string;
  requiresVerification: true;
  message: string;
}

export interface VerifyEmailOtpPayload {
  email: string;
  otp: string;
  captchaToken?: string;
}

export interface VerifyEmailOtpResponseData {
  email: string;
  verified: true;
}

export interface ResendVerificationOtpPayload {
  email: string;
  captchaToken?: string;
}

export interface ResendVerificationOtpResponseData {
  email: string;
  message: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  captchaToken?: string;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  // Phase 17 (2026-05-20) — `roles` removed from the response (no
  // storefront caller reads it). Server-side authorisation lives in
  // UserAuthGuard on every protected route.
  user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

/**
 * Phase 17 (2026-05-20) — Customer session probe response.
 *
 * Returned by GET /auth/me when the request carries a valid session
 * cookie. The shape is deliberately minimal so the frontend never
 * holds anything tokens-adjacent in JS memory.
 */
export interface AuthMeData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
}

export interface VerifyResetOtpResponseData {
  resetToken: string;
}

export const authService = {
  register(payload: RegisterPayload): Promise<ApiResponse<RegisterResponseData>> {
    return apiClient<RegisterResponseData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  verifyEmailOtp(
    payload: VerifyEmailOtpPayload,
  ): Promise<ApiResponse<VerifyEmailOtpResponseData>> {
    return apiClient<VerifyEmailOtpResponseData>('/auth/register/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  resendVerificationOtp(
    payload: ResendVerificationOtpPayload,
  ): Promise<ApiResponse<ResendVerificationOtpResponseData>> {
    return apiClient<ResendVerificationOtpResponseData>(
      '/auth/register/resend-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  login(payload: LoginPayload): Promise<ApiResponse<LoginResponseData>> {
    return apiClient<LoginResponseData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Sign in with Google. The `credential` is the signed JWT issued by
   * Google Identity Services (GIS) on the client. The API verifies it
   * server-side and, on success, sets the same httpOnly auth cookies
   * the password login sets — so the response shape matches
   * `LoginResponseData` and the post-login sequence (refresh() +
   * broadcastAuthChange()) is identical.
   */
  googleSignIn(credential: string): Promise<ApiResponse<LoginResponseData>> {
    return apiClient<LoginResponseData>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
  },

  /**
   * Phase 17 (2026-05-20) — cookie-friendly "am I signed in?" probe.
   *
   * The request relies on the httpOnly sm_access_customer cookie
   * (auto-sent via `credentials: 'include'` in the shared apiClient).
   * Returns the safe profile on success; throws ApiError(401) when
   * the session is invalid, expired, or revoked.
   */
  me(): Promise<ApiResponse<AuthMeData>> {
    return apiClient<AuthMeData>('/auth/me', { method: 'GET' });
  },

  forgotPassword(email: string): Promise<ApiResponse> {
    return apiClient('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  verifyResetOtp(email: string, otp: string): Promise<ApiResponse<VerifyResetOtpResponseData>> {
    return apiClient<VerifyResetOtpResponseData>('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },

  resendResetOtp(email: string): Promise<ApiResponse> {
    return apiClient('/auth/resend-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(resetToken: string, newPassword: string): Promise<ApiResponse> {
    return apiClient('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    });
  },

  /**
   * Phase 17 (2026-05-20) — Server-side logout.
   *
   * Revokes the calling Session on the server (default: current
   * device; pass `all=true` for "sign out everywhere"). The server
   * clears the sm_access_customer + sm_refresh_customer cookies on
   * the response too — the JS layer never had access to the tokens
   * in the cookie-based path, so there's no token-state for the
   * client to clear. Legacy sessionStorage cleanup runs in `finally`
   * so a partially-migrated client tidies up too.
   *
   * Best-effort: a 401 here typically means the access token had
   * already expired. Either way the local UI state is cleared so
   * the user appears signed out.
   */
  async logout(opts: { all?: boolean } = {}): Promise<void> {
    const query = opts.all ? '?all=true' : '';
    try {
      await apiClient(`/auth/logout${query}`, { method: 'POST' });
    } catch {
      // Best-effort — the cookie clear runs in the response of every
      // call (server-side `clearAuthCookies`). On 401 the cookies are
      // either gone or about to be; the local cleanup below covers
      // legacy tokens too.
    }
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('user');
    } catch {
      // Storage unavailable
    }
  },
};
