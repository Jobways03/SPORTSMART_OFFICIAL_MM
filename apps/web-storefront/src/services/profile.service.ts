import { apiClient, ApiResponse } from '@/lib/api-client';

export interface CustomerProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const profileService = {
  getProfile(): Promise<ApiResponse<CustomerProfile>> {
    return apiClient<CustomerProfile>('/customer/me');
  },

  updateProfile(payload: UpdateProfilePayload): Promise<ApiResponse<CustomerProfile>> {
    return apiClient<CustomerProfile>('/customer/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  changePassword(payload: ChangePasswordPayload): Promise<ApiResponse> {
    return apiClient('/customer/me/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
