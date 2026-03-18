import { apiClient, ApiResponse } from '@/lib/api-client';

export interface SellerRegisterPayload {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

export interface SellerRegisterResponseData {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
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

export const sellerAuthService = {
  register(payload: SellerRegisterPayload): Promise<ApiResponse<SellerRegisterResponseData>> {
    return apiClient<SellerRegisterResponseData>('/seller/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
};
