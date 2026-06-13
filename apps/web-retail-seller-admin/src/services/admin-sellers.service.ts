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
  // KYC identity (for the Verify KYC review). Optional because the list
  // endpoint doesn't return them — populated from the seller detail.
  legalBusinessName?: string | null;
  gstin?: string | null;
  gstStateCode?: string | null;
  panLast4?: string | null;
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
  // KYC identity submitted via onboarding.
  legalBusinessName: string | null;
  gstin: string | null;
  gstStateCode: string | null;
  gstRegistrationType: string | null;
  entityType: string | null;
  registeredBusinessAddressJson: {
    line1?: string;
    line2?: string;
    locality?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  } | null;
  isGstVerified: boolean;
  panLast4: string | null;
  // Bank payout details (masked).
  hasBankDetails: boolean;
  bankName: string | null;
  bankAccountHolderName: string | null;
  bankAccountLast4: string | null;
  bankIfscCode: string | null;
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

  impersonateSeller(sellerId: string): Promise<ApiResponse<{ accessToken: string; expiresIn: number }>> {
    return apiClient(`/admin/sellers/${sellerId}/impersonate`, {
      method: 'POST',
    });
  },

  // Proper KYC review actions. Unlike updateVerification (a raw status
  // override that skips the KYC requirement), approve requires the seller to
  // have submitted GSTIN+PAN via onboarding and sets ACTIVE+VERIFIED; reject
  // sends them back with a reason they can see. Both gated on sellers.approve.
  approveKyc(sellerId: string, notes?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/approve`, {
      method: 'POST',
      body: JSON.stringify(notes ? { notes } : {}),
    });
  },

  rejectKyc(sellerId: string, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  sendMessage(sellerId: string, subject: string, message: string, channel?: string): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/message`, {
      method: 'POST',
      body: JSON.stringify({ subject, message, channel }),
    });
  },

  updateBankDetails(
    sellerId: string,
    dto: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
      upiVpa?: string;
    },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/sellers/${sellerId}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
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
