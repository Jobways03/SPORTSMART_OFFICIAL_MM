import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseLoginPayload {
  identifier: string;
  password: string;
}

export interface FranchiseRegisterPayload {
  ownerName: string;
  businessName: string;
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
 * Phase 20 (2026-05-20) — Uniform register response. Same shape on
 * the happy and duplicate-email/phone paths so the API doesn't leak
 * account existence.
 */
export interface FranchiseRegisterResponseData {
  email: string;
  requiresVerification: true;
  verificationEmailSent: boolean;
  message: string;
  franchiseId?: string;
}

export interface FranchiseVerifyEmailPayload {
  email: string;
  otp: string;
  captchaToken?: string;
}

export interface FranchiseVerifyEmailResponseData {
  email: string;
  verified: true;
}

export interface FranchiseResendVerificationOtpPayload {
  email: string;
  captchaToken?: string;
}

export interface FranchiseResendVerificationOtpResponseData {
  email: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface FranchiseLoginResponse {
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

export interface VerifyResetOtpResponse {
  resetToken: string;
}

export const franchiseAuthService = {
  login(payload: FranchiseLoginPayload): Promise<ApiResponse<FranchiseLoginResponse>> {
    return apiClient<FranchiseLoginResponse>('/franchise/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  register(
    payload: FranchiseRegisterPayload,
  ): Promise<ApiResponse<FranchiseRegisterResponseData>> {
    return apiClient<FranchiseRegisterResponseData>('/franchise/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Phase 20 (2026-05-20) — public verify-email; unauthenticated.
   * Closes the chicken-and-egg the prior flow had.
   */
  verifyEmail(
    payload: FranchiseVerifyEmailPayload,
  ): Promise<ApiResponse<FranchiseVerifyEmailResponseData>> {
    return apiClient<FranchiseVerifyEmailResponseData>(
      '/franchise/auth/verify-email',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  resendVerificationOtp(
    payload: FranchiseResendVerificationOtpPayload,
  ): Promise<ApiResponse<FranchiseResendVerificationOtpResponseData>> {
    return apiClient<FranchiseResendVerificationOtpResponseData>(
      '/franchise/auth/resend-verification-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  forgotPassword(email: string): Promise<ApiResponse> {
    return apiClient('/franchise/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  verifyOtp(email: string, otp: string): Promise<ApiResponse<VerifyResetOtpResponse>> {
    return apiClient<VerifyResetOtpResponse>('/franchise/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },

  resetPassword(
    resetToken: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<ApiResponse> {
    return apiClient('/franchise/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
    });
  },

  /**
   * Server-side logout — POST /franchise/auth/logout revokes every
   * active FranchiseSession, then we clear local sessionStorage.
   */
  async logout(): Promise<void> {
    try {
      await apiClient('/franchise/auth/logout', { method: 'POST' });
    } catch {
      // 401 here usually just means the access token expired in-flight;
      // we still want to clear the local session.
    }
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('franchise');
    } catch {
      // Storage unavailable
    }
  },
};
