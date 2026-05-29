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
}

export const sellerSupportService = {
  listCategories(): Promise<ApiResponse<TicketCategory[]>> {
    return apiClient<TicketCategory[]>('/seller/support/categories');
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
    return apiClient<TicketListPage>(`/seller/support/tickets?${qs.toString()}`);
  },
  getTicket(id: string): Promise<ApiResponse<TicketDetail>> {
    return apiClient<TicketDetail>(`/seller/support/tickets/${id}`);
  },
  createTicket(payload: CreateTicketPayload): Promise<ApiResponse<Ticket>> {
    return apiClient<Ticket>('/seller/support/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  reply(ticketId: string, body: string): Promise<ApiResponse<TicketDetail>> {
    return apiClient<TicketDetail>(`/seller/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },
  closeTicket(ticketId: string): Promise<ApiResponse<Ticket>> {
    return apiClient<Ticket>(`/seller/support/tickets/${ticketId}/close`, {
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
