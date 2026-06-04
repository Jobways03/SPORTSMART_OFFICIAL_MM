import { apiClient, ApiError, ApiResponse } from '@/lib/api-client';

// Auth is cookie-based (httpOnly). Only attach a Bearer header when a real
// legacy token is present. Sending an empty "Bearer " is worse than sending
// nothing: the API's seller guard does `bearer ?? cookie`, and since "" is
// not null/undefined the `??` keeps the empty string and rejects with 401.
// With no Authorization header, the guard falls through to the httpOnly cookie.
const authHeaders = (token?: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};


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
  // Phase 26 GST — read-only tax identity. Surfaced on the profile
  // page so sellers can see their submitted GSTIN/PAN after onboarding
  // without re-doing the onboarding form. Editing flows through admin
  // (post-verification, GSTIN is the source-of-truth for tax filings).
  gstin?: string | null;
  gstStateCode?: string | null;
  // Phase 19 (2026-05-20) — UNREGISTERED dropped from the public DTO
  // (API rejects it). Legacy rows in the DB may still surface the
  // value here, hence the wider union; new submissions cannot create
  // it. New approvals can leave gstRegistrationType unset.
  gstRegistrationType?: 'REGULAR' | 'COMPOSITION' | 'CASUAL' | 'UNREGISTERED' | string | null;
  legalBusinessName?: string | null;
  // Phase 19 (2026-05-20) — full PAN is no longer returned. Display
  // uses panLast4. Profile screens render "XXXXXX1234" client-side.
  panLast4?: string | null;
  isGstVerified?: boolean;
  isGstinManuallyVerified?: boolean;
  gstVerifiedAt?: string | null;
  panVerified?: boolean;
  // Phase 19 (2026-05-20) — verification status + dedicated KYC
  // review columns the onboarding wizard reads to decide which step
  // to show.
  verificationStatus?: 'NOT_VERIFIED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | string;
  kycApprovalNotes?: string | null;
  kycRejectionReason?: string | null;
  kycReviewedAt?: string | null;
  // True once registered with a logistics partner — pickup/identity
  // fields are frozen (the data feeds the courier warehouse), so the
  // portal locks the form and shows a "contact your admin" banner.
  logisticsLocked?: boolean;
  // Phase 19 (2026-05-20) — first-listing wizard flags. Returned by
  // the API so the wizard can show real "done / to-do" state for the
  // three post-approval steps.
  hasBankDetails?: boolean;
  hasFirstProduct?: boolean;
  hasDeliveryMethod?: boolean;
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
      headers: authHeaders(token),
    });
  },

  updateProfile(
    token: string,
    payload: UpdateProfilePayload,
  ): Promise<ApiResponse<SellerProfileData>> {
    return apiClient<SellerProfileData>('/seller/profile', {
      method: 'PATCH',
      headers: authHeaders(token),
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
      headers: authHeaders(token),
      body: formData,
    });
  },

  async deleteProfileImage(
    token: string,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    return apiClient<MediaUploadResponse>('/seller/profile/media/profile-image', {
      method: 'DELETE',
      headers: authHeaders(token),
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
      headers: authHeaders(token),
      body: formData,
    });
  },

  async deleteShopLogo(
    token: string,
  ): Promise<ApiResponse<MediaUploadResponse>> {
    return apiClient<MediaUploadResponse>('/seller/profile/media/shop-logo', {
      method: 'DELETE',
      headers: authHeaders(token),
    });
  },

  sendEmailVerificationOtp(token: string): Promise<ApiResponse<void>> {
    return apiClient<void>('/seller/profile/verify-email/send-otp', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
  },

  verifyEmail(
    token: string,
    otp: string,
  ): Promise<ApiResponse<{ isEmailVerified: boolean }>> {
    return apiClient<{ isEmailVerified: boolean }>('/seller/profile/verify-email/verify', {
      method: 'POST',
      headers: authHeaders(token),
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
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
  },
};
