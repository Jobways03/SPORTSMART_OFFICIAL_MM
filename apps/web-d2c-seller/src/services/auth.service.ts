import { apiClient, ApiResponse } from '@/lib/api-client';

export interface SellerRegisterPayload {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing?: boolean;
  captchaToken?: string;
}

/**
 * Phase 18 (2026-05-20) — uniform register response shape mirrors the
 * backend `SellerRegisterResponseData`. Both fresh and duplicate
 * paths land in this shape so the public API does not leak account
 * existence. `verificationEmailSent: false` is the signal to show a
 * "we couldn't send your code — try resending" banner on the verify
 * page instead of pretending the OTP shipped.
 */
export interface SellerRegisterResponseData {
  email: string;
  requiresVerification: true;
  verificationEmailSent: boolean;
  message: string;
  sellerId?: string;
}

export interface SellerVerifyEmailPayload {
  email: string;
  otp: string;
  captchaToken?: string;
}

export interface SellerVerifyEmailResponseData {
  email: string;
  verified: true;
}

export interface SellerResendVerificationOtpPayload {
  email: string;
  captchaToken?: string;
}

export interface SellerResendVerificationOtpResponseData {
  email: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface SellerLoginPayload {
  identifier: string;
  password: string;
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
  };
}

export interface VerifyResetOtpResponseData {
  resetToken: string;
}

/** Shape of GET /seller/auth/me (cookie-authenticated session check). */
export interface SellerMeData {
  sellerId: string;
  email: string;
  sellerName: string;
  sellerShopName: string;
  phoneNumber: string;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  sellerType: string;
}

export const sellerAuthService = {
  /**
   * Cookie-authenticated session check. The access token now lives in an
   * httpOnly cookie (Phase 21) — login no longer writes sessionStorage —
   * so the dashboard validates the session via this endpoint on mount.
   */
  me(): Promise<ApiResponse<SellerMeData>> {
    return apiClient<SellerMeData>('/seller/auth/me', { method: 'GET' });
  },

  /**
   * Phase 18 (2026-05-20) — sellerType is NO LONGER sent in the body.
   * The api-client bakes `X-Seller-Type: D2C` (or RETAIL on the
   * retail portal) into every request via defaultHeaders, and the
   * backend derives the persisted value from that header. A D2C
   * portal can no longer impersonate a RETAIL seller (or vice
   * versa) because the body field doesn't exist on the DTO anymore.
   */
  register(payload: SellerRegisterPayload): Promise<ApiResponse<SellerRegisterResponseData>> {
    return apiClient<SellerRegisterResponseData>('/seller/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Phase 18 (2026-05-20) — public verify-email path. Unauthenticated:
   * a brand-new seller can verify before logging in, which closes the
   * "login allowed unverified" loophole the audit called CRITICAL.
   */
  verifyEmail(
    payload: SellerVerifyEmailPayload,
  ): Promise<ApiResponse<SellerVerifyEmailResponseData>> {
    return apiClient<SellerVerifyEmailResponseData>('/seller/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  resendVerificationOtp(
    payload: SellerResendVerificationOtpPayload,
  ): Promise<ApiResponse<SellerResendVerificationOtpResponseData>> {
    return apiClient<SellerResendVerificationOtpResponseData>(
      '/seller/auth/resend-verification-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  login(payload: SellerLoginPayload): Promise<ApiResponse<SellerLoginResponseData>> {
    return apiClient<SellerLoginResponseData>('/seller/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  forgotPassword(email: string): Promise<ApiResponse> {
    return apiClient('/seller/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  verifyResetOtp(email: string, otp: string): Promise<ApiResponse<VerifyResetOtpResponseData>> {
    return apiClient<VerifyResetOtpResponseData>('/seller/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },

  resendResetOtp(email: string): Promise<ApiResponse> {
    return apiClient('/seller/auth/resend-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(
    resetToken: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<ApiResponse> {
    return apiClient('/seller/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
    });
  },

  /**
   * Phase 21 (2026-05-20) — cookie-validated session probe.
   * Hits the SellerAuthGuard via GET /seller/auth/me. On 401 the
   * caller knows the seller is not logged in. Replaces the
   * sessionStorage-based "am I logged in?" pattern.
   */
  me(): Promise<ApiResponse<SellerMeData>> {
    return apiClient<SellerMeData>('/seller/auth/me');
  },

  /**
   * Server-side logout — revokes the CURRENT SellerSession by default.
   * Pass `{ all: true }` to revoke every active SellerSession for the
   * seller (use this for "Log out of all devices"). Always clears the
   * sm_access_seller + sm_refresh_seller httpOnly cookies on the
   * response.
   */
  logout(opts?: { all?: boolean }): Promise<ApiResponse> {
    const qs = opts?.all ? '?all=true' : '';
    return apiClient(`/seller/auth/logout${qs}`, {
      method: 'POST',
    });
  },
};

export interface SellerMeData {
  sellerId: string;
  email: string;
  sellerName: string;
  sellerShopName: string;
  phoneNumber: string;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  sellerType: string | null;
}
