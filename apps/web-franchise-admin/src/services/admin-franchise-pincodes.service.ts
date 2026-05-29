import { apiClient, ApiResponse } from '@/lib/api-client';

/**
 * Franchise-admin pincode → coverage mapping endpoints. Mounted under
 * /admin/franchises/:franchiseId/pincodes so the franchise-admin auth
 * context applies (Bearer token from the shared api-client). Same
 * `{ success, message, data }` envelope as every other admin endpoint.
 */

export interface PincodeConflict {
  franchiseId: string;
  priority: number;
}

export interface FranchisePincodeMapping {
  id: string;
  franchiseId: string;
  pincode: string;
  priority: number;
  isActive: boolean;
  reason: string | null;
  assignedAt: string;
  removedAt: string | null;
  version: number;
  // Other active franchises that also serve this pincode. Empty when
  // this franchise is the sole coverage owner.
  conflictsWith: PincodeConflict[];
}

export interface UpsertPincodeInput {
  pincode: string;
  // 0–1000, backend default 100. Omit to keep the existing value on update.
  priority?: number;
  isActive?: boolean;
  reason?: string;
  // Optimistic-concurrency guard. Pass the `version` of the loaded row;
  // a 409 means it changed since you loaded.
  expectedVersion?: number;
}

export interface BulkAssignPincodesInput {
  pincodes: string[]; // max 5000
  priority?: number;
  reason?: string;
}

export interface BulkAssignResult {
  assigned: number;
}

export const franchiseAdminPincodesService = {
  list(franchiseId: string): Promise<ApiResponse<FranchisePincodeMapping[]>> {
    return apiClient<FranchisePincodeMapping[]>(
      `/admin/franchises/${franchiseId}/pincodes`,
    );
  },

  // Add a single mapping / update priority / activate / deactivate.
  upsert(
    franchiseId: string,
    body: UpsertPincodeInput,
  ): Promise<ApiResponse<FranchisePincodeMapping>> {
    return apiClient<FranchisePincodeMapping>(
      `/admin/franchises/${franchiseId}/pincodes`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },

  // All-or-nothing bulk assign. A 400 (thrown as ApiError) means some
  // pincodes were invalid and nothing was saved; the message lists examples.
  bulkAssign(
    franchiseId: string,
    body: BulkAssignPincodesInput,
  ): Promise<ApiResponse<BulkAssignResult>> {
    return apiClient<BulkAssignResult>(
      `/admin/franchises/${franchiseId}/pincodes/bulk`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  // Soft-remove (deactivate) a mapping by its id.
  remove(
    franchiseId: string,
    mappingId: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient<{ success: boolean }>(
      `/admin/franchises/${franchiseId}/pincodes/${mappingId}`,
      { method: 'DELETE' },
    );
  },
};
