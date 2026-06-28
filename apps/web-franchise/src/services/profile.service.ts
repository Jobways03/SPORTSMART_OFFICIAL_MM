import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseProfile {
  franchiseId: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  state: string | null;
  city: string | null;
  address: string | null;
  pincode: string | null;
  locality: string | null;
  country: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  status: string;
  verificationStatus: string;
  onlineFulfillmentRate: number;
  procurementFeeRate: number;
  contractStartDate: string | null;
  contractEndDate: string | null;
  warehouseAddress: string | null;
  warehousePincode: string | null;
  warehouseCity: string | null;
  warehouseState: string | null;
  warehouseLocality: string | null;
  warehouseCountry: string | null;
  profileImageUrl: string | null;
  logoUrl: string | null;
  assignedZone: string | null;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  createdAt: string;
  /** True once registered with a logistics partner — pickup/warehouse
   *  fields are frozen; the portal locks the form + shows a banner. */
  logisticsLocked?: boolean;
  // Profile approval lock (2026-06): true once an admin marks the franchise
  // VERIFIED — the profile page is read-only and changes go through the admin.
  profileLocked?: boolean;
  verificationRejectionReason?: string | null;
  /** True once payout bank details are on file — hides the "Add bank
   *  details" banner for approved franchises. */
  hasBankDetails?: boolean;
}

export type UpdateFranchiseProfilePayload = Partial<Pick<
  FranchiseProfile,
  | 'ownerName'
  | 'businessName'
  | 'state'
  | 'city'
  | 'address'
  | 'pincode'
  | 'locality'
  | 'country'
  | 'gstNumber'
  | 'panNumber'
  | 'warehouseAddress'
  | 'warehousePincode'
  | 'warehouseCity'
  | 'warehouseState'
  | 'warehouseLocality'
  | 'warehouseCountry'
>>;

export const franchiseProfileService = {
  getProfile(): Promise<ApiResponse<FranchiseProfile>> {
    return apiClient<FranchiseProfile>('/franchise/profile');
  },

  updateProfile(data: UpdateFranchiseProfilePayload): Promise<ApiResponse<FranchiseProfile>> {
    return apiClient<FranchiseProfile>('/franchise/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<ApiResponse<null>> {
    return apiClient<null>('/franchise/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  uploadProfileImage(file: File): Promise<ApiResponse<{ profileImageUrl: string | null }>> {
    const form = new FormData();
    form.append('image', file);
    return apiClient<{ profileImageUrl: string | null }>(
      '/franchise/profile/media/profile-image',
      { method: 'PATCH', body: form },
    );
  },

  deleteProfileImage(): Promise<ApiResponse<null>> {
    return apiClient<null>('/franchise/profile/media/profile-image', {
      method: 'DELETE',
    });
  },

  uploadLogo(file: File): Promise<ApiResponse<{ logoUrl: string | null }>> {
    const form = new FormData();
    form.append('image', file);
    return apiClient<{ logoUrl: string | null }>(
      '/franchise/profile/media/logo',
      { method: 'PATCH', body: form },
    );
  },

  deleteLogo(): Promise<ApiResponse<null>> {
    return apiClient<null>('/franchise/profile/media/logo', {
      method: 'DELETE',
    });
  },
};
