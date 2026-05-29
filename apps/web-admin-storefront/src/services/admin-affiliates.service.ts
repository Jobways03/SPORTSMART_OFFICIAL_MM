import { apiClient, ApiResponse } from '@/lib/api-client';

export type AffiliateStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'REJECTED'
  | 'SUSPENDED';

export interface AffiliateRow {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  websiteUrl?: string | null;
  socialHandle?: string | null;
  joinReason?: string | null;
  status: AffiliateStatus;
  kycStatus?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  createdAt: string;
}

export interface AffiliateList {
  affiliates: AffiliateRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type CouponDiscountType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

// Prisma Decimal fields arrive as strings over JSON; numeric fields as numbers.
export interface AffiliateCoupon {
  id: string;
  code: string;
  isPrimary: boolean;
  isActive: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  usedCount: number;
  perUserLimit: number;
  minOrderValue?: string | number | null;
  customerDiscountType?: CouponDiscountType | null;
  customerDiscountValue?: string | number | null;
  maxDiscountAmount?: string | number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateRateHistoryRow {
  id: string;
  fromRate?: string | number | null;
  toRate?: string | number | null;
  changedByAdminId?: string | null;
  reason?: string | null;
  createdAt: string;
}

export interface AffiliateDetail extends AffiliateRow {
  commissionPercentage?: string | number | null;
  couponCodes: AffiliateCoupon[];
  commissionRateHistory: AffiliateRateHistoryRow[];
}

// Mirrors the controller body for PATCH /admin/affiliates/:id/coupons/:couponId.
// Dates are ISO strings (or null to clear); undefined means "leave unchanged".
export interface CouponConfigInput {
  isActive?: boolean;
  customerDiscountType?: CouponDiscountType | null;
  customerDiscountValue?: number | null;
  maxDiscountAmount?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  perUserLimit?: number;
  minOrderValue?: number | null;
}

// Phase 159b — create an additional coupon. Omitted fields fall to server
// defaults; `code` omitted means auto-generate. Dates are ISO strings.
export interface CreateCouponInput {
  code?: string;
  customerDiscountType?: CouponDiscountType;
  customerDiscountValue?: number;
  maxDiscountAmount?: number;
  minOrderValue?: number;
  maxUses?: number;
  perUserLimit?: number;
  startsAt?: string;
  expiresAt?: string;
  isPrimary?: boolean;
}

const BASE = '/admin/affiliates';

export const adminAffiliatesService = {
  list(params: { status?: string; page?: number; search?: string }): Promise<ApiResponse<AffiliateList>> {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.page) q.set('page', String(params.page));
    if (params.search) q.set('search', params.search);
    const qs = q.toString();
    return apiClient<AffiliateList>(`${BASE}${qs ? `?${qs}` : ''}`);
  },

  approve(id: string): Promise<ApiResponse<AffiliateRow>> {
    return apiClient<AffiliateRow>(`${BASE}/${id}/approve`, { method: 'PATCH' });
  },

  reject(id: string, reason: string): Promise<ApiResponse<AffiliateRow>> {
    return apiClient<AffiliateRow>(`${BASE}/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  suspend(id: string, reason: string): Promise<ApiResponse<AffiliateRow>> {
    return apiClient<AffiliateRow>(`${BASE}/${id}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  // Phase 159h — reactivate a SUSPENDED/INACTIVE affiliate; reason optional.
  reactivate(id: string, reason?: string): Promise<ApiResponse<AffiliateRow>> {
    return apiClient<AffiliateRow>(`${BASE}/${id}/reactivate`, {
      method: 'PATCH',
      body: JSON.stringify(reason ? { reason } : {}),
    });
  },

  // Phase 158 — affiliate detail (includes coupon codes for the config editor).
  getOne(id: string): Promise<ApiResponse<AffiliateDetail>> {
    return apiClient<AffiliateDetail>(`${BASE}/${id}`);
  },

  // Phase 159 — set/clear the per-affiliate commission rate. null clears the
  // override (falls back to the platform default). SUPER_ADMIN-only server-side.
  updateCommissionRate(
    id: string,
    percentage: number | null,
    reason?: string,
  ): Promise<ApiResponse<AffiliateRow>> {
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return apiClient<AffiliateRow>(`${BASE}/${id}/commission`, {
      method: 'PATCH',
      body: JSON.stringify({ percentage, reason }),
      headers: { 'X-Idempotency-Key': key },
    });
  },

  // Phase 159b — create an additional (campaign) coupon code for an affiliate.
  createCoupon(
    affiliateId: string,
    body: CreateCouponInput,
  ): Promise<ApiResponse<AffiliateCoupon>> {
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return apiClient<AffiliateCoupon>(`${BASE}/${affiliateId}/coupons`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-Idempotency-Key': key },
    });
  },

  // Phase 158 — update a coupon's customer-facing discount, caps + schedule.
  // The server enforces @Idempotent, so a double-submit replays the first
  // result rather than racing a second write.
  updateCouponConfig(
    affiliateId: string,
    couponId: string,
    body: CouponConfigInput,
  ): Promise<ApiResponse<AffiliateCoupon>> {
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return apiClient<AffiliateCoupon>(`${BASE}/${affiliateId}/coupons/${couponId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'X-Idempotency-Key': key },
    });
  },
};

export const AFFILIATE_STATUS_COLOR: Record<AffiliateStatus, { bg: string; fg: string }> = {
  PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
  ACTIVE: { bg: '#dcfce7', fg: '#166534' },
  INACTIVE: { bg: '#f3f4f6', fg: '#6b7280' },
  REJECTED: { bg: '#fee2e2', fg: '#b91c1c' },
  SUSPENDED: { bg: '#fee2e2', fg: '#991b1b' },
};
