import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseListItem {
  id: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  status: string;
  verificationStatus: string;
  state: string | null;
  city: string | null;
  profileCompletionPercentage: number;
  isEmailVerified: boolean;
  createdAt: string;
}

export interface FranchiseListResponse {
  franchises: FranchiseListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface FranchiseDetail {
  id: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  gstNumber: string | null;
  panNumber: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;

  // Address — matches the FranchisePartner Prisma model exactly
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  locality: string | null;

  // Warehouse — only two fields exist on the backend today
  warehouseAddress: string | null;
  warehousePincode: string | null;

  // Zone — single string on the backend (FranchisePartner.assignedZone)
  assignedZone: string | null;

  // Commission rates
  onlineFulfillmentRate: number | null;
  procurementFeeRate: number | null;

  // Contract
  contractStartDate: string | null;
  contractEndDate: string | null;

  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListFranchisesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  verificationStatus?: string;
  sortBy?: string;
  sortOrder?: string;
  state?: string;
}

export interface FranchiseCatalogMapping {
  id: string;
  franchiseId: string;
  franchiseCode?: string;
  franchiseName?: string;
  productId: string;
  variantId: string | null;
  product: {
    id: string;
    title: string;
    slug?: string;
    productCode?: string;
  };
  variant: {
    id: string;
    masterSku: string;
    title: string;
    sku?: string;
  } | null;
  approvalStatus: string;
  sku: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FranchiseCatalogListResponse {
  mappings: FranchiseCatalogMapping[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListFranchiseCatalogParams {
  page?: number;
  limit?: number;
  franchiseId?: string;
  approvalStatus?: string;
  search?: string;
}

export interface FranchiseInventoryItem {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  productCode?: string;
  sku: string | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface FranchiseInventoryLedgerEntry {
  id: string;
  franchiseId: string;
  productId: string;
  variantId: string | null;
  type: string;
  quantity: number;
  balanceAfter: number;
  referenceId: string | null;
  referenceType: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FranchiseOrderItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  totalAmount: number;
  itemsCount: number;
  createdAt: string;
}

export const adminFranchisesService = {
  listFranchises(params: ListFranchisesParams = {}): Promise<ApiResponse<FranchiseListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.verificationStatus) query.set('verificationStatus', params.verificationStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params.state) query.set('state', params.state);
    const qs = query.toString();
    return apiClient<FranchiseListResponse>(`/admin/franchises${qs ? `?${qs}` : ''}`);
  },

  getFranchise(id: string): Promise<ApiResponse<FranchiseDetail>> {
    return apiClient<FranchiseDetail>(`/admin/franchises/${id}`);
  },

  updateStatus(id: string, status: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  updateVerification(id: string, verificationStatus: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus, reason }),
    });
  },

  updateCommission(
    id: string,
    payload: { onlineFulfillmentRate?: number; procurementFeeRate?: number },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/commission`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // Franchise catalog
  listCatalog(params: ListFranchiseCatalogParams = {}): Promise<ApiResponse<FranchiseCatalogListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.franchiseId) query.set('franchiseId', params.franchiseId);
    if (params.approvalStatus) query.set('approvalStatus', params.approvalStatus);
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return apiClient<FranchiseCatalogListResponse>(`/admin/franchise-catalog${qs ? `?${qs}` : ''}`);
  },

  approveCatalogMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/approve`, {
      method: 'PATCH',
    });
  },

  stopCatalogMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/stop`, {
      method: 'PATCH',
    });
  },

  // Franchise orders
  listFranchiseOrders(
    franchiseId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<ApiResponse<{ orders: FranchiseOrderItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient(`/admin/franchise-orders/franchises/${franchiseId}${qs ? `?${qs}` : ''}`);
  },

  // Inventory
  getInventory(franchiseId: string): Promise<ApiResponse<{ inventory: FranchiseInventoryItem[] }>> {
    return apiClient<{ inventory: FranchiseInventoryItem[] }>(
      `/admin/franchises/${franchiseId}/inventory`,
    );
  },

  getInventoryLedger(
    franchiseId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<ApiResponse<{ entries: FranchiseInventoryLedgerEntry[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient(`/admin/franchises/${franchiseId}/inventory/ledger${qs ? `?${qs}` : ''}`);
  },

  // ── Profile Edit ──────────────────────────────────────

  editFranchise(id: string, payload: Record<string, unknown>): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // ── Send Message ──────────────────────────────────────

  sendMessage(id: string, subject: string, message: string, channel?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ subject, message, channel }),
    });
  },

  // ── Change Password ───────────────────────────────────

  changePassword(id: string, newPassword: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/change-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    });
  },

  // ── Impersonate ───────────────────────────────────────

  impersonateFranchise(id: string): Promise<ApiResponse<{
    accessToken: string;
    expiresIn: number;
    franchise: {
      franchiseId: string;
      franchiseCode: string;
      ownerName: string;
      businessName: string;
      email: string;
    };
  }>> {
    return apiClient(`/admin/franchises/${id}/impersonate`, {
      method: 'POST',
    });
  },

  // ── Delete ────────────────────────────────────────────

  deleteFranchise(id: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },

  // ── POS Sales ─────────────────────────────────────────

  getPosSales(
    franchiseId: string,
    params: { page?: number; limit?: number; status?: string } = {},
  ): Promise<ApiResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient(`/admin/franchises/${franchiseId}/pos-sales${qs ? `?${qs}` : ''}`);
  },

  // ── Finance Ledger ────────────────────────────────────

  getFinanceLedger(
    franchiseId: string,
    params: { page?: number; limit?: number; sourceType?: string } = {},
  ): Promise<ApiResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.sourceType) query.set('sourceType', params.sourceType);
    const qs = query.toString();
    return apiClient(`/admin/franchise-finance/${franchiseId}/ledger${qs ? `?${qs}` : ''}`);
  },

  createAdjustment(franchiseId: string, amount: number, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/adjustment`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  },

  createPenalty(franchiseId: string, amount: number, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/penalty`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  },

  // ── Settlements ───────────────────────────────────────

  listSettlements(
    params: { page?: number; limit?: number; franchiseId?: string; status?: string } = {},
  ): Promise<ApiResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.franchiseId) query.set('franchiseId', params.franchiseId);
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient(`/admin/franchise-settlements${qs ? `?${qs}` : ''}`);
  },

  approveSettlement(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements/${id}/approve`, { method: 'PATCH' });
  },

  markSettlementPaid(id: string, paymentReference?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements/${id}/pay`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentReference }),
    });
  },

  // ── Order Actions ─────────────────────────────────────

  markOrderDelivered(subOrderId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-orders/${subOrderId}/mark-delivered`, {
      method: 'PATCH',
    });
  },
};
