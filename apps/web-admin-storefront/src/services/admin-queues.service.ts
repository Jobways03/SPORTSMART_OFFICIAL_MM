import { apiClient, ApiResponse } from '@/lib/api-client';

export type QueueResource = 'dispute' | 'return' | 'ticket';
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type SlaState =
  | 'OK'
  | 'WARNING'
  | 'BREACHED'
  | 'BREACHED_ESCALATE'
  | 'NO_POLICY';

export interface QueueItem {
  resourceType: QueueResource;
  resourceId: string;
  status: string;
  number: string;
  createdAt: string;
  enteredStatusAt: string;
  slaState: SlaState;
  slaDeadlineAt: string | null;
  slaRemainingMinutes: number | null;
  slaPolicyName: string | null;
  riskScore: number;
  riskTier: RiskTier;
}

export interface QueueSummary {
  resource: QueueResource;
  total: number;
  breaching: number;
  warning: number;
  highRisk: number;
}

export interface QueueListResponse {
  items: QueueItem[];
  total: number;
}

export interface QueueListParams {
  page?: number;
  limit?: number;
  onlyBreaching?: boolean;
  minTier?: RiskTier;
}

export const adminQueuesService = {
  /**
   * GET /admin/queues/summary — counts per queue. Gated by `audit.read`.
   * Returns one entry per resource type (dispute, return, ticket).
   */
  summary(): Promise<ApiResponse<QueueSummary[]>> {
    return apiClient<QueueSummary[]>('/admin/queues/summary');
  },

  /**
   * GET /admin/queues/:resource — paginated case list with SLA + risk
   * metadata. Sorted server-side by SLA urgency then risk score.
   */
  list(
    resource: QueueResource,
    params: QueueListParams = {},
  ): Promise<ApiResponse<QueueListResponse>> {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('limit', String(params.limit ?? 20));
    if (params.onlyBreaching) qs.set('onlyBreaching', 'true');
    if (params.minTier) qs.set('minTier', params.minTier);
    return apiClient<QueueListResponse>(
      `/admin/queues/${resource}?${qs.toString()}`,
    );
  },
};
