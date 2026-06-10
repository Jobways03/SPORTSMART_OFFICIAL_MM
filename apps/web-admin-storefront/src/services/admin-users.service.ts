import { apiClient, ApiResponse } from '@/lib/api-client';

export type AdminPrimaryRole =
  | 'SUPER_ADMIN'
  | 'SELLER_ADMIN'
  | 'SELLER_SUPPORT'
  | 'SELLER_OPERATIONS'
  | 'AFFILIATE_ADMIN'
  | 'RETAILER_ADMIN'
  | 'FRANCHISE_ADMIN';

export type AdminAccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface AdminCustomRoleRef {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminPrimaryRole;
  status: AdminAccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  customRoles: AdminCustomRoleRef[];
}

export interface AdminUserListResponse {
  items: AdminUser[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateAdminUserPayload {
  name: string;
  email: string;
  password: string;
  role: AdminPrimaryRole;
  customRoleIds?: string[];
}

export interface UpdateAdminUserPayload {
  name?: string;
  role?: AdminPrimaryRole;
  status?: AdminAccountStatus;
}

export const adminUsersService = {
  list(args?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: AdminAccountStatus;
  }): Promise<ApiResponse<AdminUserListResponse>> {
    const q = new URLSearchParams();
    if (args?.page) q.set('page', String(args.page));
    if (args?.limit) q.set('limit', String(args.limit));
    if (args?.search) q.set('search', args.search);
    if (args?.status) q.set('status', args.status);
    const qs = q.toString();
    return apiClient<AdminUserListResponse>(`/admin/users${qs ? `?${qs}` : ''}`);
  },

  getById(id: string): Promise<ApiResponse<AdminUser>> {
    return apiClient<AdminUser>(`/admin/users/${id}`);
  },

  create(payload: CreateAdminUserPayload): Promise<ApiResponse<AdminUser>> {
    return apiClient<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  update(id: string, payload: UpdateAdminUserPayload): Promise<ApiResponse<AdminUser>> {
    return apiClient<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  remove(id: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/users/${id}`, { method: 'DELETE' });
  },

  resetPassword(id: string, newPassword: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  },

  assignRole(adminId: string, roleId: string): Promise<ApiResponse<AdminUser>> {
    return apiClient<AdminUser>(`/admin/users/${adminId}/roles/${roleId}`, {
      method: 'POST',
    });
  },

  revokeRole(adminId: string, roleId: string): Promise<ApiResponse<AdminUser>> {
    return apiClient<AdminUser>(`/admin/users/${adminId}/roles/${roleId}`, {
      method: 'DELETE',
    });
  },
};

export const ADMIN_PRIMARY_ROLES: { value: AdminPrimaryRole; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'SELLER_ADMIN', label: 'Seller Admin' },
  { value: 'SELLER_OPERATIONS', label: 'Seller Operations' },
  { value: 'SELLER_SUPPORT', label: 'Seller Support' },
  { value: 'AFFILIATE_ADMIN', label: 'Affiliate Admin' },
  { value: 'RETAILER_ADMIN', label: 'Retailer Admin' },
  { value: 'FRANCHISE_ADMIN', label: 'Franchise Admin' },
];
