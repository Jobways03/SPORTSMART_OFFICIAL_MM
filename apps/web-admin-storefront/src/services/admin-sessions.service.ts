import { apiClient, ApiResponse } from '@/lib/api-client';

// Phase 27 (2026-05-21) — AFFILIATE added in lockstep with the API.
export type ActorType = 'ADMIN' | 'USER' | 'SELLER' | 'FRANCHISE' | 'AFFILIATE';

export interface ActiveSessionRow {
  id: string;
  actorType: ActorType;
  actorId: string;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  // Phase 209 (#4) — last refresh-rotation timestamp + device label.
  // Lets the operator tell a live session from a stale one at a glance.
  lastUsedAt: string | null;
  deviceLabel: string | null;
}

export interface ListResponse {
  items: ActiveSessionRow[];
  total: number;
}

export interface ListFilters {
  actorType?: ActorType;
  actorId?: string;
  ipAddress?: string;
  limit?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const adminSessionsService = {
  list(filters: ListFilters = {}): Promise<ApiResponse<ListResponse>> {
    return apiClient<ListResponse>(`/admin/sessions${qs(filters as Record<string, string | number | undefined>)}`);
  },

  revoke(args: {
    sessionId: string;
    actorType: ActorType;
    reason?: string;
  }): Promise<ApiResponse<{ revoked: true; sessionId: string; actorType: ActorType; actorId: string; alreadyRevoked: boolean }>> {
    return apiClient(`/admin/sessions/${args.sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ actorType: args.actorType, reason: args.reason }),
    });
  },

  revokeAllForActor(args: {
    actorType: ActorType;
    actorId: string;
    reason?: string;
  }): Promise<ApiResponse<{ revoked: number; actorType: ActorType; actorId: string }>> {
    return apiClient(
      `/admin/sessions/revoke-all/${args.actorType}/${encodeURIComponent(args.actorId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: args.reason ?? null }),
      },
    );
  },
};
