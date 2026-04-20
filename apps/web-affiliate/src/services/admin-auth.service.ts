import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminLoginPayload {
  email: string;
  password: string;
}

export interface AdminLoginResponseData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: {
    adminId: string;
    name: string;
    email: string;
    role: string;
  };
}

export interface AdminMeResponseData {
  adminId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export const adminAuthService = {
  login(payload: AdminLoginPayload): Promise<ApiResponse<AdminLoginResponseData>> {
    return apiClient<AdminLoginResponseData>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  logout(): Promise<ApiResponse> {
    return apiClient('/admin/auth/logout', {
      method: 'POST',
    });
  },

  getMe(): Promise<ApiResponse<AdminMeResponseData>> {
    return apiClient<AdminMeResponseData>('/admin/auth/me');
  },
};
