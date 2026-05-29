import type {
  Ticket,
  TicketCategory,
  TicketMessage,
  TicketActorType,
  TicketStatus,
  TicketPriority,
} from '@prisma/client';

export const SUPPORT_REPOSITORY = Symbol('SUPPORT_REPOSITORY');

export interface CreateTicketInput {
  ticketNumber: string;
  subject: string;
  priority?: TicketPriority;
  creatorType: TicketActorType;
  creatorId: string;
  creatorName: string;
  creatorEmail: string;
  categoryId?: string | null;
  relatedOrderId?: string | null;
  relatedReturnId?: string | null;
  /** Computed by service from priority — when admin must respond by. */
  slaTargetAt?: Date | null;
  initialMessage: {
    senderType: TicketActorType;
    senderId: string;
    senderName: string;
    body: string;
  };
}

export interface CreateMessageInput {
  ticketId: string;
  senderType: TicketActorType;
  senderId: string;
  senderName: string;
  body: string;
  isInternalNote?: boolean;
  // Phase 11 — set when this row is the back-mirror of an admin reply
  // on the linked dispute. UNIQUE so a retried event handler can't
  // double-post on the customer's ticket.
  mirroredFromDisputeMessageId?: string;
}

export interface ListTicketsFilter {
  page: number;
  limit: number;
  // Buyer / seller filter — scope to a specific creator
  creatorType?: TicketActorType;
  creatorId?: string;
  // Admin filters
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedAdminId?: string | null; // explicit `null` = unassigned
  search?: string; // matches ticketNumber / subject / creator email/name
  // Admin queue only: sort URGENT→LOW first, then recency. Per-actor "my
  // tickets" lists leave this unset so a customer's view isn't reordered.
  sortByPriority?: boolean;
}

export interface ListTicketsPage {
  items: Ticket[];
  page: number;
  limit: number;
  total: number;
}

export interface TicketWithMessages {
  ticket: Ticket;
  messages: TicketMessage[];
  category: TicketCategory | null;
}

export interface SupportRepository {
  // ── Numbering ─────────────────────────────────────────────────
  generateNextTicketNumber(): Promise<string>;

  // ── Tickets ───────────────────────────────────────────────────
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  findTicketById(id: string): Promise<Ticket | null>;
  findTicketWithMessages(id: string): Promise<TicketWithMessages | null>;
  listTickets(filter: ListTicketsFilter): Promise<ListTicketsPage>;
  updateTicket(
    id: string,
    data: Partial<{
      status: TicketStatus;
      priority: TicketPriority;
      assignedAdminId: string | null;
      lastMessageAt: Date;
      resolvedAt: Date | null;
      closedAt: Date | null;
      closedByAdminId: string | null;
      resolutionSummary: string | null;
      slaTargetAt: Date | null;
      escalationLevel: number;
      escalatedAt: Date | null;
    }>,
  ): Promise<Ticket>;

  // ── Messages ──────────────────────────────────────────────────
  /** Inserts the message and bumps the ticket's lastMessageAt in one tx. */
  appendMessage(input: CreateMessageInput): Promise<TicketMessage>;

  // ── Categories ────────────────────────────────────────────────
  listCategories(scopedTo?: TicketActorType): Promise<TicketCategory[]>;
  findCategoryById(id: string): Promise<TicketCategory | null>;
  createCategory(input: {
    name: string;
    description?: string | null;
    scopedTo?: TicketActorType | null;
    sortOrder?: number;
  }): Promise<TicketCategory>;
  updateCategory(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      scopedTo: TicketActorType | null;
      sortOrder: number;
      active: boolean;
    }>,
  ): Promise<TicketCategory>;
}
