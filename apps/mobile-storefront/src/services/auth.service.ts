import {apiClient, ApiResponse} from '../lib/api-client';
import {keychainStorage} from '../lib/storage';

// Mirrors apps/web-storefront/src/services/auth.service.ts — same endpoints,
// same request/response shapes, same single-source-of-truth on the API
// contract. The only difference is the local-storage clear in logout:
// web uses sessionStorage, we use Keychain via the same adapter the
// api-client uses.

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  // API RegisterDto requires these — they were missing here, which made
  // the API reject every mobile signup with a validation error.
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
}

export interface RegisterResponseData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
}

export interface VerifyResetOtpResponseData {
  resetToken: string;
}

export interface VerifyRegistrationOtpResponseData {
  email: string;
  verified: boolean;
}

export const authService = {
  register(payload: RegisterPayload): Promise<ApiResponse<RegisterResponseData>> {
    return apiClient<RegisterResponseData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(payload: LoginPayload): Promise<ApiResponse<LoginResponseData>> {
    return apiClient<LoginResponseData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Registration email-OTP verification. After /auth/register the account
  // exists but emailVerified=false, so login is rejected until the 6-digit
  // code emailed to the user is verified here. Mirrors the web storefront's
  // /register/verify flow. The endpoint does NOT return tokens — the caller
  // logs in separately once verified === true.
  verifyRegistrationOtp(
    email: string,
    otp: string,
  ): Promise<ApiResponse<VerifyRegistrationOtpResponseData>> {
    return apiClient<VerifyRegistrationOtpResponseData>(
      '/auth/register/verify-otp',
      {
        method: 'POST',
        body: JSON.stringify({email, otp}),
      },
    );
  },

  resendRegistrationOtp(email: string): Promise<ApiResponse> {
    return apiClient('/auth/register/resend-otp', {
      method: 'POST',
      body: JSON.stringify({email}),
    });
  },

  forgotPassword(email: string): Promise<ApiResponse> {
    return apiClient('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({email}),
    });
  },

  verifyResetOtp(
    email: string,
    otp: string,
  ): Promise<ApiResponse<VerifyResetOtpResponseData>> {
    return apiClient<VerifyResetOtpResponseData>('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({email, otp}),
    });
  },

  resendResetOtp(email: string): Promise<ApiResponse> {
    return apiClient('/auth/resend-reset-otp', {
      method: 'POST',
      body: JSON.stringify({email}),
    });
  },

  resetPassword(resetToken: string, newPassword: string): Promise<ApiResponse> {
    return apiClient('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({resetToken, newPassword}),
    });
  },

  async logout(): Promise<void> {
    try {
      await apiClient('/auth/logout', {method: 'POST'});
    } catch {
      // Best-effort — a 401 here means the access token already expired,
      // which is fine; we still clear locally.
    }
    await Promise.all([
      keychainStorage.removeItem('accessToken'),
      keychainStorage.removeItem('refreshToken'),
      keychainStorage.removeItem('user'),
    ]);
  },
};
