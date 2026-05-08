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

export interface Ticket {
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
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: TicketActorType;
  senderId: string;
  senderName: string;
  body: string;
  isInternalNote: boolean;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Ticket;
  messages: TicketMessage[];
  category: TicketCategory | null;
}

export interface TicketListPage {
  items: Ticket[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateTicketPayload {
  subject: string;
  body: string;
  priority?: TicketPriority;
  categoryId?: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
  /** Customer-friendly numbers (e.g. SM20260062, RET-2026-000017). */
  relatedOrderNumber?: string;
  relatedReturnNumber?: string;
}

export const supportService = {
  listCategories(): Promise<ApiResponse<TicketCategory[]>> {
    return apiClient<TicketCategory[]>('/customer/support/categories');
  },
  listMyTickets(
    page = 1,
    limit = 20,
    status?: TicketStatus,
  ): Promise<ApiResponse<TicketListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(limit));
    if (status) qs.set('status', status);
    return apiClient<TicketListPage>(`/customer/support/tickets?${qs.toString()}`);
  },
  getTicket(id: string): Promise<ApiResponse<TicketDetail>> {
    return apiClient<TicketDetail>(`/customer/support/tickets/${id}`);
  },
  createTicket(payload: CreateTicketPayload): Promise<ApiResponse<Ticket>> {
    return apiClient<Ticket>('/customer/support/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  reply(ticketId: string, body: string): Promise<ApiResponse<TicketDetail>> {
    return apiClient<TicketDetail>(`/customer/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },
  closeTicket(ticketId: string): Promise<ApiResponse<Ticket>> {
    return apiClient<Ticket>(`/customer/support/tickets/${ticketId}/close`, {
      method: 'POST',
    });
  },
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Awaiting your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
