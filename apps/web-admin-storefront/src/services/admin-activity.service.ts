import { apiClient, ApiResponse } from '@/lib/api-client';
import type { AccessActorType } from './admin-access-logs.service';

// Phase 208 (#1/#8) — widened from the original AUTH|BUSINESS pair.
export type ActivitySource = 'AUTH' | 'ADMIN_ACTION' | 'BUSINESS' | 'IMPERSONATION';

export interface ActivityItem {
  source: ActivitySource;
  id: string;
  actorId: string;
  actorRole: string | null;
  // AUTH: AccessEventKind. BUSINESS: actionType string from
  // admin_action_audit_logs.action_type column.
  kind: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  succeeded: boolean | null;
  reason: string | null;
  createdAt: string;
}

export interface ActivityTimelineResponse {
  items: ActivityItem[];
  since: string;
  hours: number;
  // Phase 208 (#9) — true when one source filled its page, so older
  // events MAY have been dropped at the merge boundary. The UI warns.
  truncated?: boolean;
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminActivityService = {
  timeline(args: {
    actorRole?: string;
    actorId?: string;
    actorType?: AccessActorType;
    hours?: number;
    limit?: number;
    source?: 'AUTH' | 'BUSINESS';
  } = {}): Promise<ApiResponse<ActivityTimelineResponse>> {
    return apiClient<ActivityTimelineResponse>(`/admin/activity${buildQs(args)}`);
  },
};
