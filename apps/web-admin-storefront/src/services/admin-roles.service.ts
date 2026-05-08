import { apiClient, ApiResponse } from '@/lib/api-client';

export interface PermissionEntry {
  key: string;
  description: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissions: string[];
}

export interface CreateRolePayload {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRolePayload {
  description?: string;
  permissions?: string[];
}

export const adminRolesService = {
  listPermissions(): Promise<ApiResponse<PermissionEntry[]>> {
    return apiClient<PermissionEntry[]>('/admin/roles/permissions');
  },

  listRoles(): Promise<ApiResponse<RoleSummary[]>> {
    return apiClient<RoleSummary[]>('/admin/roles');
  },

  createRole(payload: CreateRolePayload): Promise<ApiResponse<RoleSummary>> {
    return apiClient<RoleSummary>('/admin/roles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateRole(id: string, payload: UpdateRolePayload): Promise<ApiResponse<RoleSummary>> {
    return apiClient<RoleSummary>(`/admin/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteRole(id: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/roles/${id}`, { method: 'DELETE' });
  },

  setActive(id: string, active: boolean): Promise<ApiResponse<RoleSummary>> {
    return apiClient<RoleSummary>(`/admin/roles/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
  },

  assignRoleToAdmin(roleId: string, adminId: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/roles/${roleId}/admins/${adminId}`, { method: 'POST' });
  },

  revokeRoleFromAdmin(roleId: string, adminId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/roles/${roleId}/admins/${adminId}`, {
      method: 'DELETE',
    });
  },
};

/** Group permissions by their module prefix (e.g. "wallets.read" → "wallets"). */
export function groupPermissionsByModule(
  perms: PermissionEntry[],
): Array<{ module: string; items: PermissionEntry[] }> {
  const map = new Map<string, PermissionEntry[]>();
  for (const p of perms) {
    const mod = p.key.split('.')[0] || 'other';
    const arr = map.get(mod) ?? [];
    arr.push(p);
    map.set(mod, arr);
  }
  return Array.from(map.entries()).map(([module, items]) => ({
    module,
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
  }));
}
