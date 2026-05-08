import type { TicketActorType, TicketPriority, TicketStatus } from '@prisma/client';

export interface CreateTicketDto {
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

export interface ReplyDto {
  body: string;
  isInternalNote?: boolean;
}

export interface AssignDto {
  // Pass null to unassign.
  adminId: string | null;
}

export interface SetStatusDto {
  status: TicketStatus;
}

export interface SetPriorityDto {
  priority: TicketPriority;
}

export interface CreateCategoryDto {
  name: string;
  description?: string;
  scopedTo?: TicketActorType;
  sortOrder?: number;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string | null;
  scopedTo?: TicketActorType | null;
  sortOrder?: number;
  active?: boolean;
}
