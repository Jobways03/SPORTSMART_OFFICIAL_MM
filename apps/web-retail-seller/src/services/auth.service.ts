import { apiClient, ApiResponse, SELLER_TYPE } from '@/lib/api-client';

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
      // Phase 38 — bake the seller-type discriminator (RETAIL) into
      // the body. See web-d2c-seller's auth.service for the parallel
      // D2C version.
      body: JSON.stringify({ ...payload, sellerType: SELLER_TYPE }),
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

  /**
   * Server-side logout — revokes every active SellerSession server-side
   * so a stolen refresh token can't be replayed after the click. The
   * caller still needs to clear local sessionStorage afterwards (the
   * shared logout helper does both).
   */
  logout(): Promise<ApiResponse> {
    return apiClient('/seller/auth/logout', {
      method: 'POST',
    });
  },
};
