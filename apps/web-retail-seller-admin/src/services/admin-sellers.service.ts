import { apiClient, ApiResponse, SELLER_TYPE } from '@/lib/api-client';

export interface SellerListItem {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  status: string;
  verificationStatus: string;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  isEmailVerified: boolean;
  profileImageUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SellerListResponse {
  sellers: SellerListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SellerDetail {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  sellerContactCountryCode: string | null;
  sellerContactNumber: string | null;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sellerZipCode: string | null;
  shortStoreDescription: string | null;
  detailedStoreDescription: string | null;
  sellerPolicy: string | null;
  sellerProfileImageUrl: string | null;
  sellerShopLogoUrl: string | null;
  status: string;
  verificationStatus: string;
  // Phase 254 — tax identity (from AdminGetSellerUseCase). panVerified is what
  // the §194-O TDS engine keys off (unverified → §206AA 5% penalty; verified →
  // configured rate).
  legalBusinessName?: string | null;
  gstin?: string | null;
  gstStateCode?: string | null;
  panNumber?: string | null;
  panLast4?: string | null;
  panVerified?: boolean;
  isGstVerified?: boolean;
  gstVerifiedAt?: string | null;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  lastProfileUpdatedAt: string | null;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListSellersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  verificationStatus?: string;
  sortBy?: string;
  sortOrder?: string;
  fromDate?: string;
  toDate?: string;
}

export const adminSellersService = {
  listSellers(params: ListSellersParams = {}): Promise<ApiResponse<SellerListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.verificationStatus) query.set('verificationStatus', params.verificationStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params.fromDate) query.set('fromDate', params.fromDate);
    if (params.toDate) query.set('toDate', params.toDate);
    // Phase 38 — RETAIL admin only ever lists RETAIL sellers.
    query.set('sellerType', SELLER_TYPE);
    const qs = query.toString();
    return apiClient<SellerListResponse>(`/admin/sellers${qs ? `?${qs}` : ''}`);
  },

  getSeller(sellerId: string): Promise<ApiResponse<SellerDetail>> {
    return apiClient<SellerDetail>(`/admin/sellers/${sellerId}`);
  },

  editSeller(sellerId: string, payload: Record<string, unknown>): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  updateStatus(sellerId: string, status: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  updateVerification(sellerId: string, verificationStatus: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus, reason }),
    });
  },

  // Phase 254 — manual PAN / GSTIN verification. verifyPan flips the flag the
  // §194-O TDS engine keys off (drops 5% no-PAN penalty → configured rate);
  // verifyGstin marks the GSTIN verified for invoicing. Idempotent.
  verifyPan(sellerId: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/verify-pan`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  verifyGstin(sellerId: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/verify-gstin`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  impersonateSeller(sellerId: string): Promise<ApiResponse<{ accessToken: string; expiresIn: number }>> {
    return apiClient(`/admin/sellers/${sellerId}/impersonate`, {
      method: 'POST',
    });
  },

  sendMessage(sellerId: string, subject: string, message: string, channel?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/message`, {
      method: 'POST',
      body: JSON.stringify({ subject, message, channel }),
    });
  },

  changePassword(sellerId: string, newPassword: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/change-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    });
  },

  deleteSeller(sellerId: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },
};
