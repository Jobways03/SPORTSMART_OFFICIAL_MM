import { apiClient, ApiResponse } from '@/lib/api-client';

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
  decisionByAdminId: string | null;
  decisionAt: string | null;
  decisionRationale: string | null;
  // Phase 11 — populated when this dispute was promoted from a support
  // ticket. Admin UI shows a prominent back-link banner; the customer's
  // own portal never sees the dispute or this column.
  sourceTicketId?: string | null;
  // Phase 12 (ADR-016) — liability + remedy attribution.
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

export const adminDisputesService = {
  list(filter: {
    page?: number;
    limit?: number;
    status?: DisputeStatus | '';
    kind?: DisputeKind | '';
    assignedAdminId?: string | 'unassigned' | '';
    search?: string;
  } = {}): Promise<ApiResponse<DisputeListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 20));
    if (filter.status) qs.set('status', filter.status);
    if (filter.kind) qs.set('kind', filter.kind);
    if (filter.assignedAdminId) qs.set('assignedAdminId', filter.assignedAdminId);
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    return apiClient<DisputeListPage>(`/admin/disputes?${qs.toString()}`);
  },
  get(id: string): Promise<ApiResponse<DisputeDetail>> {
    return apiClient<DisputeDetail>(`/admin/disputes/${id}`);
  },
  reply(id: string, body: string, isInternalNote = false): Promise<ApiResponse<DisputeMessage>> {
    return apiClient<DisputeMessage>(`/admin/disputes/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ body, isInternalNote }),
    });
  },
  assign(id: string, adminId: string | null): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>(`/admin/disputes/${id}/assign`, {
      method: 'PATCH', body: JSON.stringify({ adminId }),
    });
  },
  setStatus(id: string, status: DisputeStatus): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>(`/admin/disputes/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  },
  setSeverity(id: string, severity: number): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>(`/admin/disputes/${id}/severity`, {
      method: 'PATCH', body: JSON.stringify({ severity }),
    });
  },
  /**
   * Phase 12 (ADR-016) — decide payload now requires liabilityParty +
   * customerRemedy. Backend validates the matrix; the UI nudges the
   * admin to a sensible default but the backend is the source of
   * truth.
   */
  decide(id: string, payload: {
    outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
    rationale: string;
    /** Required when customerRemedy is FULL_REFUND / PARTIAL_REFUND / GOODWILL_CREDIT (in paise). */
    amountInPaise?: number;
    liabilityParty: 'SELLER' | 'LOGISTICS' | 'PLATFORM' | 'CUSTOMER' | 'NONE';
    customerRemedy:
      | 'FULL_REFUND'
      | 'PARTIAL_REFUND'
      | 'NO_REFUND'
      | 'GOODWILL_CREDIT';
    logistics?: {
      courierName?: string;
      awbNumber?: string;
      evidenceFileId?: string;
      notes?: string;
    };
  }): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>(`/admin/disputes/${id}/decide`, {
      method: 'POST', body: JSON.stringify(payload),
    });
  },
  /**
   * Rescue path for ticket-promoted disputes that didn't inherit
   * order/return linkage. Backend validates the order/return belongs
   * to the dispute filer.
   */
  attachContext(id: string, payload: {
    orderNumber?: string;
    returnNumber?: string;
  }): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>(`/admin/disputes/${id}/attach-context`, {
      method: 'PATCH', body: JSON.stringify(payload),
    });
  },
};

export const STATUS_COLOR: Record<DisputeStatus, string> = {
  OPEN: '#b91c1c',
  UNDER_REVIEW: '#2A8595',
  AWAITING_INFO: '#d97706',
  RESOLVED_BUYER: '#15803d',
  RESOLVED_SELLER: '#15803d',
  RESOLVED_SPLIT: '#15803d',
  CLOSED: '#7A828F',
};

export const KIND_LABEL: Record<DisputeKind, string> = {
  RETURN_REJECTED: 'Return rejected',
  WRONG_ITEM_RECEIVED: 'Wrong item',
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  MISSING_FROM_PARCEL: 'Missing from parcel',
  OTHER: 'Other',
};
