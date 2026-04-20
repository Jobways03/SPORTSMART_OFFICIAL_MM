import { apiClient, ApiError, ApiResponse } from '@/lib/api-client';


export interface SellerProfileData {
  sellerId: string;
  email: string;
  phoneNumber: string;
  sellerName: string;
  sellerShopName: string;
  sellerContactCountryCode: string | null;
  sellerContactNumber: string | null;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sellerZipCode: string | null;
  shortStoreDescription: string | null;
  detailedStoreDescription: string | null;
  sellerPolicy: string | null;
  sellerProfileImageUrl: string | null;
  sellerShopLogoUrl: string | null;
  status: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  lastProfileUpdatedAt: string | null;
  createdAt: string;
}

export interface UpdateProfilePayload {
  sellerName?: string;
  sellerShopName?: string;
  sellerContactCountryCode?: string;
  sellerContactNumber?: string;
  storeAddress?: string;
  city?: string;
  state?: string;
  country?: string;
  sellerZipCode?: string;
  shortStoreDescription?: string;
  detailedStoreDescription?: string;
  sellerPolicy?: string;
}

export interface MediaUploadResponse {
  sellerProfileImageUrl?: string | null;
  sellerShopLogoUrl?: string | null;
  profileCompletionPercentage: number;
}

export const sellerProfileService = {
  getProfile(token: string): Promise<ApiResponse<SellerProfileData>> {
    return apiClient<SellerProfileData>('/seller/profile', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  updateProfile(
    token: string,
    payload: UpdateProfilePayload,
  ): Promise<ApiResponse<SellerProfileData>> {
    return apiClient<SellerProfileData>('/seller/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  uploadProfileImage(
    token: string,
    file: File,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    const formData = new FormData();
    formData.append('profileImage', file);
    return apiClient<MediaUploadResponse>('/seller/profile/media/profile-image', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  },

  async deleteProfileImage(
    token: string,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    return apiClient<MediaUploadResponse>('/seller/profile/media/profile-image', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  uploadShopLogo(
    token: string,
    file: File,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    const formData = new FormData();
    formData.append('shopLogo', file);
    return apiClient<MediaUploadResponse>('/seller/profile/media/shop-logo', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  },

  async deleteShopLogo(
    token: string,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    return apiClient<MediaUploadResponse>('/seller/profile/media/shop-logo', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  sendEmailVerificationOtp(token: string): Promise<ApiResponse<void>> {
    return apiClient<void>('/seller/profile/verify-email/send-otp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
  },

  verifyEmail(
    token: string,
    otp: string,
  ): Promise<ApiResponse<{ isEmailVerified: boolean }>> {
    return apiClient<{ isEmailVerified: boolean }>('/seller/profile/verify-email/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ otp }),
    });
  },

  changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<ApiResponse<void>> {
    return apiClient<void>('/seller/profile/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
  },
};
