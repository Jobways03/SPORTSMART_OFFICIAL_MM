import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: { adminId: string; name: string; email: string; role: string };
}

export const adminAuthService = {
  login(email: string, password: string): Promise<ApiResponse<AdminLoginResponse>> {
    return apiClient<AdminLoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  logout(): Promise<ApiResponse> {
    return apiClient('/admin/auth/logout', { method: 'POST' });
  },

  getMe(): Promise<ApiResponse<any>> {
    return apiClient('/admin/auth/me');
  },
};
