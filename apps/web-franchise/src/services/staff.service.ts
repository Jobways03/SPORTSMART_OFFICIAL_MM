import { apiClient, ApiResponse } from '@/lib/api-client';

export type FranchiseStaffRole =
  | 'OWNER'
  | 'MANAGER'
  | 'POS_OPERATOR'
  | 'WAREHOUSE_STAFF';

export interface FranchiseStaff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: FranchiseStaffRole | string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AddStaffPayload {
  name: string;
  email: string;
  phone?: string;
  role: FranchiseStaffRole | string;
  password: string;
}

export interface UpdateStaffPayload {
  name?: string;
  phone?: string;
  role?: FranchiseStaffRole | string;
  isActive?: boolean;
}

export const franchiseStaffService = {
  listStaff(): Promise<ApiResponse<FranchiseStaff[]>> {
    return apiClient<FranchiseStaff[]>('/franchise/staff');
  },

  getStaff(staffId: string): Promise<ApiResponse<FranchiseStaff>> {
    return apiClient<FranchiseStaff>(`/franchise/staff/${staffId}`);
  },

  addStaff(payload: AddStaffPayload): Promise<ApiResponse<FranchiseStaff>> {
    return apiClient<FranchiseStaff>('/franchise/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateStaff(
    staffId: string,
    payload: UpdateStaffPayload,
  ): Promise<ApiResponse<FranchiseStaff>> {
    return apiClient<FranchiseStaff>(`/franchise/staff/${staffId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  removeStaff(staffId: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/franchise/staff/${staffId}`, {
      method: 'DELETE',
    });
  },
};
