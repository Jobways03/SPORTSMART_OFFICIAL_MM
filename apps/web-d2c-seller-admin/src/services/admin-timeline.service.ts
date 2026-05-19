import { apiClient, ApiResponse } from '@/lib/api-client';

export type CaseKind = 'return' | 'dispute' | 'ticket';

export interface TimelineEvent {
  kind: string;
  at: string;
  summary: string;
  actor?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * GET /admin/timeline/:caseKind/:caseId — admin view of the unified
 * case timeline. Includes internal notes; gated by `audit.read`.
 */
export function getAdminTimeline(
  caseKind: CaseKind,
  caseId: string,
): Promise<ApiResponse<TimelineEvent[]>> {
  return apiClient<TimelineEvent[]>(
    `/admin/timeline/${caseKind}/${encodeURIComponent(caseId)}`,
  );
}
