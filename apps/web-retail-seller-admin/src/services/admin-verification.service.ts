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
  unclaimedCritical: number;
  unclaimedUnscored: number;
  mine: number;
  breachedSla: number;
  totalToday: number;
}

export type RiskBand = 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL';

/** A row in the read-only band-filtered orders list (GET …/orders). */
export interface VerificationOrderRow {
  id: string;
  orderNumber: string;
  /** Decimal money — kept as a string; only Number() at the format edge. */
  totalAmount: string;
  paymentMethod: string;
  paymentStatus: string;
  itemCount: number;
  createdAt: string;
  claimed: boolean;
  riskScore: number | null;
  riskBand: RiskBand | null;
  scoredAt: string | null;
}

export interface VerificationOrdersPage {
  items: VerificationOrderRow[];
  total: number;
  page: number;
  limit: number;
}

/** Band filters accepted by GET …/orders. */
export type VerificationBandFilter =
  | 'RED'
  | 'YELLOW'
  | 'GREEN'
  | 'CRITICAL'
  | 'HIGH'
  | 'RED_YELLOW'
  | 'UNSCORED'
  | 'ALL';

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

/**
 * POST /admin/verification/claim-next — atomically claim the next PLACED order.
 * With no `band`, claims the oldest unclaimed order (original behaviour). Pass a
 * band to claim the next order of that band ("claim next RED").
 */
export function claimNext(
  band?: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL',
): Promise<ApiResponse<ClaimResponse | null>> {
  return apiClient<ClaimResponse | null>('/admin/verification/claim-next', {
    method: 'POST',
    ...(band ? { body: JSON.stringify({ band }) } : {}),
  });
}

function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      q.set(key, String(value));
    }
  });
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

/**
 * GET /admin/verification/orders — read-only, band-filtered, paginated list of
 * orders in the queue (highest risk first). `band` accepts the composite
 * filters too (HIGH = RED+CRITICAL, RED_YELLOW = YELLOW+RED+CRITICAL).
 */
export function listVerificationOrders(params: {
  band?: VerificationBandFilter;
  onlyUnclaimed?: boolean;
  page?: number;
  limit?: number;
}): Promise<ApiResponse<VerificationOrdersPage>> {
  const qs = buildQuery({
    band: params.band,
    onlyUnclaimed: params.onlyUnclaimed,
    page: params.page,
    limit: params.limit,
  });
  return apiClient<VerificationOrdersPage>(`/admin/verification/orders${qs}`);
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

/**
 * POST /admin/verification/orders/:id/rescore — recompute the risk
 * score for one order. Useful when external data (e.g. AVS, fraud feed)
 * has been refreshed and the verifier wants the latest band before
 * acting. An optional `reason` (3..500 chars) is audited. Returns the
 * new RiskInfo.
 */
export function rescoreOrder(
  orderId: string,
  reason?: string,
): Promise<ApiResponse<RiskInfo>> {
  return apiClient<RiskInfo>(
    `/admin/verification/orders/${orderId}/rescore`,
    {
      method: 'POST',
      ...(reason ? { body: JSON.stringify({ reason }) } : {}),
    },
  );
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
