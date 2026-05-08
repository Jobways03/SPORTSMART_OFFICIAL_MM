import { apiClient, ApiResponse } from '@/lib/api-client';

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED';

export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type TicketActorType =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'SELLER'
  | 'FRANCHISE'
  | 'AFFILIATE';

export interface TicketCategory {
  id: string;
  name: string;
  description: string | null;
  scopedTo: TicketActorType | null;
  sortOrder: number;
  active: boolean;
}

export interface AdminTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  creatorType: TicketActorType;
  creatorId: string;
  creatorName: string;
  creatorEmail: string;
  assignedAdminId: string | null;
  categoryId: string | null;
  relatedOrderId: string | null;
  relatedReturnId: string | null;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  closedByAdminId: string | null;
  // Phase 11 — set when this ticket has been promoted to a dispute.
  // Surfaced in admin UI as a back-link banner; absent on the
  // customer's view (it's never serialised to the storefront API).
  promotedToDisputeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTicketMessage {
  id: string;
  ticketId: string;
  senderType: TicketActorType;
  senderId: string;
  senderName: string;
  body: string;
  isInternalNote: boolean;
  createdAt: string;
}

export interface AdminTicketDetail {
  ticket: AdminTicket;
  messages: AdminTicketMessage[];
  category: TicketCategory | null;
}

export interface AdminTicketListPage {
  items: AdminTicket[];
  page: number;
  limit: number;
  total: number;
}

export interface AdminTicketFilters {
  page?: number;
  limit?: number;
  status?: TicketStatus | '';
  priority?: TicketPriority | '';
  // 'unassigned' to filter unassigned, or an admin id, or '' for all
  assignedAdminId?: string | 'unassigned' | '';
  search?: string;
}

export const adminSupportService = {
  listTickets(
    filters: AdminTicketFilters = {},
  ): Promise<ApiResponse<AdminTicketListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filters.page ?? 1));
    qs.set('limit', String(filters.limit ?? 20));
    if (filters.status) qs.set('status', filters.status);
    if (filters.priority) qs.set('priority', filters.priority);
    if (filters.assignedAdminId) qs.set('assignedAdminId', filters.assignedAdminId);
    if (filters.search?.trim()) qs.set('search', filters.search.trim());
    return apiClient<AdminTicketListPage>(`/admin/support/tickets?${qs.toString()}`);
  },
  getTicket(id: string): Promise<ApiResponse<AdminTicketDetail>> {
    return apiClient<AdminTicketDetail>(`/admin/support/tickets/${id}`);
  },
  reply(
    id: string,
    body: string,
    isInternalNote = false,
  ): Promise<ApiResponse<AdminTicketDetail>> {
    return apiClient<AdminTicketDetail>(`/admin/support/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, isInternalNote }),
    });
  },
  assign(id: string, adminId: string | null): Promise<ApiResponse<AdminTicket>> {
    return apiClient<AdminTicket>(`/admin/support/tickets/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ adminId }),
    });
  },
  setStatus(id: string, status: TicketStatus): Promise<ApiResponse<AdminTicket>> {
    return apiClient<AdminTicket>(`/admin/support/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  setPriority(
    id: string,
    priority: TicketPriority,
  ): Promise<ApiResponse<AdminTicket>> {
    return apiClient<AdminTicket>(`/admin/support/tickets/${id}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    });
  },
  listCategories(): Promise<ApiResponse<TicketCategory[]>> {
    return apiClient<TicketCategory[]>('/admin/support/categories');
  },
  /**
   * Phase 11 — promote a support ticket onto the formal-dispute track.
   * Customer never sees the dispute exists; their support thread keeps
   * working with mirrored admin replies under the "Support" brand
   * voice. See backend docs in DisputeService.promoteFromTicket.
   */
  promoteToDispute(
    id: string,
    payload: {
      kind:
        | 'RETURN_REJECTED'
        | 'WRONG_ITEM_RECEIVED'
        | 'DAMAGED_IN_TRANSIT'
        | 'MISSING_FROM_PARCEL'
        | 'OTHER';
      severity?: number;
      summary?: string;
      internalNote?: string;
    },
  ): Promise<
    ApiResponse<{
      ticketId: string;
      disputeId: string;
      disputeNumber: string;
    }>
  > {
    return apiClient<{
      ticketId: string;
      disputeId: string;
      disputeNumber: string;
    }>(`/admin/support/tickets/${id}/promote-to-dispute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Awaiting customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const STATUS_COLOR: Record<TicketStatus, string> = {
  OPEN: '#d97706',
  IN_PROGRESS: '#2A8595',
  WAITING_ON_CUSTOMER: '#b91c1c',
  RESOLVED: '#15803d',
  CLOSED: '#7A828F',
};

export const PRIORITY_COLOR: Record<TicketPriority, string> = {
  LOW: '#7A828F',
  NORMAL: '#525A65',
  HIGH: '#d97706',
  URGENT: '#b91c1c',
};
