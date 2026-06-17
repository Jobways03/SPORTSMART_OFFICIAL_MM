import { apiClient } from '@/lib/api-client';

export type DisputeKind =
  | 'RETURN_REJECTED'
  | 'WRONG_ITEM_RECEIVED'
  | 'DAMAGED_IN_TRANSIT'
  | 'MISSING_FROM_PARCEL'
  | 'OTHER';

export type DisputeStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'AWAITING_INFO'
  | 'RESOLVED_BUYER'
  | 'RESOLVED_SELLER'
  | 'RESOLVED_SPLIT'
  | 'CLOSED';

export type DisputeActorType = 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'FRANCHISE';

export interface Dispute {
  id: string;
  disputeNumber: string;
  kind: DisputeKind;
  status: DisputeStatus;
  severity: number;
  masterOrderId: string | null;
  subOrderId: string | null;
  returnId: string | null;
  filedByType: DisputeActorType;
  filedById: string;
  filedByName: string;
  summary: string;
  assignedAdminId: string | null;
  decisionAt: string | null;
  decisionRationale: string | null;
  liabilityParty?:
    | 'NONE'
    | 'SELLER'
    | 'LOGISTICS'
    | 'PLATFORM'
    | 'CUSTOMER'
    | 'FRANCHISE'
    | 'BRAND'
    | null;
  customerRemedy?:
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'NO_REFUND'
    | 'GOODWILL_CREDIT'
    | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeMessage {
  id: string;
  disputeId: string;
  senderType: DisputeActorType;
  senderId: string;
  senderName: string;
  body: string;
  // Franchises never see internal admin notes — backend filters them out.
  isInternalNote: boolean;
  createdAt: string;
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  fileId: string;
  caption: string | null;
  uploadedByType: DisputeActorType;
  uploadedById: string;
  uploadedAt: string;
}

export interface DisputeDetail extends Dispute {
  messages: DisputeMessage[];
  evidence: DisputeEvidence[];
}

export interface DisputeListPage {
  items: Dispute[];
  page: number;
  limit: number;
  total: number;
}

export interface FileDisputePayload {
  kind: DisputeKind;
  summary: string;
  masterOrderId?: string;
  subOrderId?: string;
  returnId?: string;
}

export const franchiseDisputesService = {
  /** GET /franchise/disputes — disputes filed BY this franchise and AGAINST their sub-orders. */
  list(params: {
    page?: number;
    limit?: number;
    status?: DisputeStatus | '';
  } = {}) {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('limit', String(params.limit ?? 20));
    if (params.status) qs.set('status', params.status);
    return apiClient<DisputeListPage>(`/franchise/disputes?${qs.toString()}`);
  },

  /** GET /franchise/disputes/:id — full detail including messages and evidence visible to the franchise. */
  get(id: string) {
    return apiClient<DisputeDetail>(`/franchise/disputes/${id}`);
  },

  /**
   * POST /franchise/disputes — file a new dispute (e.g. contesting a customer
   * return). The endpoint is @Idempotent, so an X-Idempotency-Key is required;
   * generate it once per submission so a retry / double-click doesn't create
   * two disputes.
   */
  file(payload: FileDisputePayload, idempotencyKey: string) {
    return apiClient<Dispute>('/franchise/disputes', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
  },

  /**
   * POST /franchise/disputes/:id/messages — reply / add a note. The endpoint is
   * @Idempotent, so an X-Idempotency-Key is required; pass a key that stays
   * stable across retries of the same message so a retry can't double-post.
   */
  reply(id: string, body: string, idempotencyKey: string) {
    return apiClient<DisputeMessage>(`/franchise/disputes/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
  },

  /** POST /franchise/disputes/:id/evidence — attach an already-uploaded file as evidence. */
  attachEvidence(id: string, fileId: string, caption?: string) {
    return apiClient<DisputeEvidence>(`/franchise/disputes/${id}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ fileId, caption }),
    });
  },
};

// ── Display helpers — kept in the service file so list + detail share them. ──

export const STATUS_LABEL: Record<DisputeStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  AWAITING_INFO: 'Awaiting info',
  RESOLVED_BUYER: 'Resolved — buyer favoured',
  RESOLVED_SELLER: 'Resolved — seller favoured',
  RESOLVED_SPLIT: 'Resolved — split',
  CLOSED: 'Closed',
};

export const STATUS_COLOR: Record<DisputeStatus, { bg: string; fg: string }> = {
  OPEN: { bg: '#fee2e2', fg: '#991b1b' },
  UNDER_REVIEW: { bg: '#dbeafe', fg: '#1e40af' },
  AWAITING_INFO: { bg: '#fef3c7', fg: '#92400e' },
  RESOLVED_BUYER: { bg: '#fde68a', fg: '#78350f' },
  RESOLVED_SELLER: { bg: '#dcfce7', fg: '#15803d' },
  RESOLVED_SPLIT: { bg: '#e0e7ff', fg: '#3730a3' },
  CLOSED: { bg: '#e5e7eb', fg: '#374151' },
};

export const KIND_LABEL: Record<DisputeKind, string> = {
  RETURN_REJECTED: 'Return rejected',
  WRONG_ITEM_RECEIVED: 'Wrong item received',
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  MISSING_FROM_PARCEL: 'Missing from parcel',
  OTHER: 'Other',
};
