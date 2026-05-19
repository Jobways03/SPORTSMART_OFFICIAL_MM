import { apiClient, ApiResponse } from '@/lib/api-client';

// ── Health snapshot types ────────────────────────────────────────────────

export interface RoutingHealthSnapshot {
  generatedAt: string;
  exceptionQueue: {
    count: number;
    oldestAgeHours: number | null;
  };
  reassignments: {
    last7dTotal: number;
    last7dFromSlaTimeout: number;
  };
  topRejectingNodes: Array<{
    nodeId: string;
    rejectionsLast7d: number;
  }>;
  unservicablePincodes: Array<{
    pincode: string;
    failedAllocationsLast30d: number;
  }>;
}

// ── Preview (dry-run) types ──────────────────────────────────────────────

export interface PreviewItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface AllocationCandidate {
  mappingId: string;
  sellerId?: string | null;
  franchiseId?: string | null;
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeName?: string | null;
  score: number;
  distanceKm: number | null;
  availableQty: number;
  reasons: string[];
}

export interface AllocationDecision {
  serviceable: boolean;
  primary: AllocationCandidate | null;
  alternates: AllocationCandidate[];
  reason?: string | null;
}

export interface PreviewItemResult {
  productId: string | null;
  variantId: string | null;
  quantity: number;
  error: string | null;
  allocation: AllocationDecision | null;
}

export interface PreviewResponse {
  pincode: string;
  summary: {
    totalItems: number;
    servicableItems: number;
    unservicableItems: number;
    failedItems: number;
  };
  results: PreviewItemResult[];
}

// ── API ──────────────────────────────────────────────────────────────────

/** GET /admin/routing/health — operational signals for the routing engine. */
export function getRoutingHealth(): Promise<ApiResponse<RoutingHealthSnapshot>> {
  return apiClient<RoutingHealthSnapshot>('/admin/routing/health');
}

/**
 * POST /admin/routing/preview — dry-run the allocator for a (pincode, items)
 * tuple. No stock is reserved. Capped server-side at 50 items per call.
 */
export function previewRouting(
  payload: {
    pincode: string;
    items: PreviewItem[];
  },
): Promise<ApiResponse<PreviewResponse>> {
  return apiClient<PreviewResponse>('/admin/routing/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
