import { apiClient, ApiResponse } from '@/lib/api-client';

// ── Types ────────────────────────────────────────────────────────────────

export interface ClaimResponse {
  id: string;
}

export interface QueueStats {
  unclaimed: number;
  unclaimedGreen: number;
  unclaimedYellow: number;
  unclaimedRed: number;
  mine: number;
  breachedSla: number;
  totalToday: number;
}

export type RiskBand = 'GREEN' | 'YELLOW' | 'RED';

export interface MyTrayItem {
  id: string;
  orderNumber: string;
  totalAmount: string;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  itemCount: number;
  createdAt: string;
  claimedAt: string;
  claimExpiresAt: string;
  riskScore: number | null;
  riskBand: RiskBand | null;
}

// ── API ──────────────────────────────────────────────────────────────────

/** POST /admin/verification/claim-next — atomically claim the next PLACED order. */
export function claimNext(): Promise<ApiResponse<ClaimResponse | null>> {
  return apiClient<ClaimResponse | null>('/admin/verification/claim-next', {
    method: 'POST',
  });
}

/** GET /admin/verification/my-tray — orders this admin has currently claimed. */
export function getMyTray(): Promise<ApiResponse<MyTrayItem[]>> {
  return apiClient<MyTrayItem[]>('/admin/verification/my-tray');
}

/** GET /admin/verification/queue-stats — counts for the banner. */
export function getQueueStats(): Promise<ApiResponse<QueueStats>> {
  return apiClient<QueueStats>('/admin/verification/queue-stats');
}

/** POST /admin/verification/orders/:id/release — release a claim. */
export function releaseClaim(orderId: string): Promise<ApiResponse<null>> {
  return apiClient<null>(`/admin/verification/orders/${orderId}/release`, {
    method: 'POST',
  });
}

/** PATCH /admin/verification/orders/:id/approve — verify and route to sellers. */
export function approveOrder(
  orderId: string,
  remarks?: string,
): Promise<ApiResponse<unknown>> {
  return apiClient(`/admin/verification/orders/${orderId}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ remarks }),
  });
}

/** PATCH /admin/verification/orders/:id/reject — cancel and restore stock. */
export function rejectOrder(orderId: string): Promise<ApiResponse<null>> {
  return apiClient<null>(`/admin/verification/orders/${orderId}/reject`, {
    method: 'PATCH',
  });
}

// ── Team-lead view ──────────────────────────────────────────────────────

export interface TeamClaim {
  id: string;
  orderNumber: string;
  totalAmount: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
  claimedAt: string;
  claimExpiresAt: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  riskScore: number | null;
  riskBand: RiskBand | null;
}

export interface RiskInfo {
  score: number | null;
  band: RiskBand | null;
  reasons: string[];
  scoredAt: string | null;
}

/** GET /admin/verification/orders/:id/risk — band + reasons for detail page. */
export function getRiskInfo(orderId: string): Promise<ApiResponse<RiskInfo>> {
  return apiClient<RiskInfo>(`/admin/verification/orders/${orderId}/risk`);
}

/** POST /admin/verification/backfill-scores — SUPER_ADMIN only. */
export function backfillScores(): Promise<ApiResponse<{ scored: number }>> {
  return apiClient<{ scored: number }>('/admin/verification/backfill-scores', {
    method: 'POST',
  });
}

export interface BulkApproveResult {
  attempted: number;
  succeeded: number;
  failed: Array<{ orderId: string; orderNumber?: string; reason: string }>;
  approvedIds: string[];
  previewIds?: string[];
}

/**
 * POST /admin/verification/bulk-approve-green.
 * `dryRun: true` returns the IDs that would be approved without acting.
 */
export function bulkApproveGreen(
  limit: number,
  dryRun: boolean,
): Promise<ApiResponse<BulkApproveResult>> {
  return apiClient<BulkApproveResult>(
    '/admin/verification/bulk-approve-green',
    {
      method: 'POST',
      body: JSON.stringify({ limit, dryRun }),
    },
  );
}

export interface TeamStatus {
  summary: { totalClaimed: number; activeAdmins: number };
  claims: TeamClaim[];
}

/** GET /admin/verification/team-status — all live claims across the team. */
export function getTeamStatus(): Promise<ApiResponse<TeamStatus>> {
  return apiClient<TeamStatus>('/admin/verification/team-status');
}

/** POST /admin/verification/orders/:id/force-release — SUPER_ADMIN only. */
export function forceRelease(
  orderId: string,
  reason: string,
): Promise<ApiResponse<null>> {
  return apiClient<null>(
    `/admin/verification/orders/${orderId}/force-release`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}
