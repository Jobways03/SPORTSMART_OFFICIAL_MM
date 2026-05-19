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

export type DisputeActorType = 'CUSTOMER' | 'SELLER' | 'ADMIN';

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
  liabilityParty?: 'NONE' | 'SELLER' | 'LOGISTICS' | 'PLATFORM' | 'CUSTOMER' | null;
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
  // Sellers never see internal admin notes — backend filters them out.
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

export const sellerDisputesService = {
  /** GET /seller/disputes — disputes filed BY this seller and AGAINST their sub-orders. */
  list(params: {
    page?: number;
    limit?: number;
    status?: DisputeStatus | '';
  } = {}) {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('limit', String(params.limit ?? 20));
    if (params.status) qs.set('status', params.status);
    return apiClient<DisputeListPage>(`/seller/disputes?${qs.toString()}`);
  },

  /** GET /seller/disputes/:id — full detail including messages and evidence visible to seller. */
  get(id: string) {
    return apiClient<DisputeDetail>(`/seller/disputes/${id}`);
  },

  /** POST /seller/disputes — file a new dispute (e.g. against a customer return). */
  file(payload: FileDisputePayload) {
    return apiClient<Dispute>('/seller/disputes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** POST /seller/disputes/:id/messages — reply / add a note. */
  reply(id: string, body: string) {
    return apiClient<DisputeMessage>(`/seller/disputes/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },

  /** POST /seller/disputes/:id/evidence — attach an already-uploaded file as evidence. */
  attachEvidence(id: string, fileId: string, caption?: string) {
    return apiClient<DisputeEvidence>(`/seller/disputes/${id}/evidence`, {
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
