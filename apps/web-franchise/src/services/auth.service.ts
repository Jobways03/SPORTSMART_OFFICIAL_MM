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

  register(payload: FranchiseRegisterPayload): Promise<ApiResponse> {
    return apiClient('/franchise/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
   * Server-side first so a stolen refresh token can't be replayed
   * after the user clicks logout. Network failure is best-effort; the
   * local clear still runs (the user expects to be logged out client-
   * side regardless).
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
