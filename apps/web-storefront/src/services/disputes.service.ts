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

export interface Dispute {
  id: string;
  disputeNumber: string;
  kind: DisputeKind;
  status: DisputeStatus;
  severity: number;
  masterOrderId: string | null;
  subOrderId: string | null;
  returnId: string | null;
  filedByName: string;
  summary: string;
  decisionRationale: string | null;
  decisionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeMessage {
  id: string;
  senderType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  senderId: string;
  senderName: string;
  body: string;
  isInternalNote: boolean;
  createdAt: string;
}

export interface DisputeDetail extends Dispute {
  messages: DisputeMessage[];
}

export interface DisputeListPage {
  items: Dispute[];
  page: number;
  limit: number;
  total: number;
}

export const disputesService = {
  list(page = 1, limit = 20, status?: DisputeStatus): Promise<ApiResponse<DisputeListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(limit));
    if (status) qs.set('status', status);
    return apiClient<DisputeListPage>(`/customer/disputes?${qs.toString()}`);
  },
  get(id: string): Promise<ApiResponse<DisputeDetail>> {
    return apiClient<DisputeDetail>(`/customer/disputes/${id}`);
  },
  file(payload: {
    kind: DisputeKind;
    summary: string;
    masterOrderId?: string;
    subOrderId?: string;
    returnId?: string;
  }): Promise<ApiResponse<Dispute>> {
    return apiClient<Dispute>('/customer/disputes', {
      method: 'POST', body: JSON.stringify(payload),
    });
  },
  reply(id: string, body: string): Promise<ApiResponse<DisputeMessage>> {
    return apiClient<DisputeMessage>(`/customer/disputes/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ body }),
    });
  },
};

export const STATUS_LABEL: Record<DisputeStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  AWAITING_INFO: 'Awaiting your info',
  RESOLVED_BUYER: 'Resolved (in your favour)',
  RESOLVED_SELLER: 'Resolved (against you)',
  RESOLVED_SPLIT: 'Resolved (partial)',
  CLOSED: 'Closed',
};

export const KIND_LABEL: Record<DisputeKind, string> = {
  RETURN_REJECTED: 'My return was rejected',
  WRONG_ITEM_RECEIVED: 'I received the wrong item',
  DAMAGED_IN_TRANSIT: 'Item arrived damaged',
  MISSING_FROM_PARCEL: 'An item was missing',
  OTHER: 'Other',
};
