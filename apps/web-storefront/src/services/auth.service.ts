import { apiClient, ApiResponse } from '@/lib/api-client';

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
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
};
