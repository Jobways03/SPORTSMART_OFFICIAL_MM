import { apiClient, ApiResponse } from '@/lib/api-client';

// ── Types ───────────────────────────────────────────────────────────────
export type FranchiseStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED';

export type FranchiseVerificationStatus =
  | 'NOT_VERIFIED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED';

export interface FranchiseListItem {
  id: string;
  franchiseId?: string;
  franchiseCode: string;
  ownerName?: string;
  businessName: string;
  email?: string;
  phoneNumber?: string;
  status: FranchiseStatus | string;
  verificationStatus: FranchiseVerificationStatus | string;
  assignedZone?: string | null;
  profileCompletionPercentage?: number;
  isProfileCompleted?: boolean;
  createdAt?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FranchiseList {
  franchises: FranchiseListItem[];
  pagination: Pagination;
}

export interface FranchiseDetail extends FranchiseListItem {
  state?: string;
  city?: string;
  address?: string;
  pincode?: string;
  locality?: string;
  country?: string;
  gstNumber?: string | null;
  panNumber?: string | null;
  onlineFulfillmentRate?: number;
  procurementFeeRate?: number;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  warehouseAddress?: string | null;
  warehousePincode?: string | null;
  profileImageUrl?: string | null;
  logoUrl?: string | null;
  isEmailVerified?: boolean;
  lastLoginAt?: string | null;
  updatedAt?: string;
  fulfillmentHold?: boolean;
}

export interface InventoryItem {
  productId: string;
  variantId?: string | null;
  productName?: string;
  sku?: string;
  stockQty: number;
  reservedQty?: number;
  availableQty?: number;
  lowStockThreshold?: number;
}

export interface PincodeMapping {
  id: string;
  pincode: string;
  priority?: number;
  isActive?: boolean;
  city?: string | null;
  state?: string | null;
  createdAt?: string;
}

export interface CatalogMapping {
  id: string;
  franchiseId: string;
  franchiseCode?: string;
  productId: string;
  productName?: string;
  sku?: string;
  approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'STOPPED' | 'REJECTED' | string;
  stockQty?: number;
  reservedQty?: number;
  createdAt?: string;
}

export interface PosReport {
  date: string;
  netRevenuePaise?: number;
  grossRevenuePaise?: number;
  saleCount?: number;
  returnCount?: number;
  voidCount?: number;
  closureStatus?: string;
  [k: string]: unknown;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

// ── Service ─────────────────────────────────────────────────────────────
export const adminFranchisesService = {
  list(opts: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    verificationStatus?: string;
  } = {}): Promise<ApiResponse<FranchiseList>> {
    return apiClient<FranchiseList>(
      `/admin/franchises${qs({
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
        search: opts.search,
        status: opts.status,
        verificationStatus: opts.verificationStatus,
      })}`,
    );
  },

  get(id: string): Promise<ApiResponse<FranchiseDetail>> {
    return apiClient<FranchiseDetail>(`/admin/franchises/${id}`);
  },

  setVerification(
    id: string,
    body: { verificationStatus: FranchiseVerificationStatus; reason?: string },
  ): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchises/${id}/verification`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  setStatus(
    id: string,
    body: { status: FranchiseStatus; reason?: string },
  ): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchises/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  setFulfillmentHold(
    id: string,
    hold: boolean,
    reason?: string,
  ): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchises/${id}/fulfillment-hold`, {
      method: hold ? 'POST' : 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },

  listInventory(
    id: string,
    opts: { page?: number; limit?: number; search?: string; lowStockOnly?: boolean } = {},
  ): Promise<ApiResponse<{ items: InventoryItem[]; pagination: Pagination }>> {
    return apiClient(
      `/admin/franchises/${id}/inventory${qs({
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
        search: opts.search,
        lowStockOnly: opts.lowStockOnly ? 'true' : undefined,
      })}`,
    );
  },

  listPincodes(id: string): Promise<ApiResponse<{ mappings: PincodeMapping[] }>> {
    return apiClient(`/admin/franchises/${id}/pincodes`);
  },

  listCatalog(opts: {
    franchiseId?: string;
    approvalStatus?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<{ mappings: CatalogMapping[]; pagination: Pagination }>> {
    return apiClient(
      `/admin/franchise-catalog${qs({
        franchiseId: opts.franchiseId,
        approvalStatus: opts.approvalStatus,
        search: opts.search,
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
      })}`,
    );
  },

  approveCatalog(mappingId: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/approve`, { method: 'PATCH' });
  },

  rejectCatalog(mappingId: string, reason: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  stopCatalog(mappingId: string, reason: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/stop`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  getPosReport(id: string, date?: string): Promise<ApiResponse<PosReport>> {
    return apiClient<PosReport>(`/admin/franchises/${id}/pos-report${qs({ date })}`);
  },
};
