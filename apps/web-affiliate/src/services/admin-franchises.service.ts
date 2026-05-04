import { apiFetch } from '@/lib/api';

export interface FranchiseSummary {
  id: string;
  ownerName?: string;
  businessName?: string;
  franchiseCode?: string;
}

export interface FranchiseListResponse {
  franchises: FranchiseSummary[];
  total?: number;
}

export interface CoverageEntry {
  id: string;
  coverageType: string;
  stateName?: string | null;
  cityName?: string | null;
  pincode?: string | null;
  priority: number;
}

export interface CoverageResponse {
  coverage: CoverageEntry[];
}

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// `apiFetch` auto-unwraps the `data` envelope. The pages here still
// expect a `{ data: ... }` shape so we re-wrap.
async function wrap<T>(p: Promise<T>): Promise<ApiEnvelope<T>> {
  const data = await p;
  return { success: true, data };
}

export const adminFranchisesService = {
  listFranchises(params: { limit?: number; page?: number } = {}): Promise<ApiEnvelope<FranchiseListResponse>> {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page != null) qs.set('page', String(params.page));
    const q = qs.toString();
    return wrap(apiFetch<FranchiseListResponse>(`/admin/franchises${q ? '?' + q : ''}`));
  },

  getCoverage(franchiseId: string): Promise<ApiEnvelope<CoverageResponse>> {
    return wrap(apiFetch<CoverageResponse>(`/admin/franchises/${franchiseId}/coverage`));
  },
};
