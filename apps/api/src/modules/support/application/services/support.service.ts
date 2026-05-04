import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Ticket,
  TicketActorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  ListTicketsFilter,
  ListTicketsPage,
  SupportRepository,
  SUPPORT_REPOSITORY,
  TicketWithMessages,
} from '../../domain/repositories/support.repository.interface';

export interface CreateTicketArgs {
  creator: {
    type: TicketActorType;
    id: string;
    name: string;
    email: string;
  };
  subject: string;
  body: string;
  priority?: TicketPriority;
  categoryId?: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
}

export interface ReplyArgs {
  ticketId: string;
  sender: {
    type: TicketActorType;
    id: string;
    name: string;
  };
  body: string;
  isInternalNote?: boolean;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(SUPPORT_REPOSITORY) private readonly repo: SupportRepository,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Tickets ──────────────────────────────────────────────────────

  async createTicket(args: CreateTicketArgs): Promise<Ticket> {
    const subject = args.subject?.trim();
    const body = args.body?.trim();
    if (!subject) throw new BadRequestAppException('Subject is required');
    if (subject.length > 200) {
      throw new BadRequestAppException('Subject too long (max 200 chars)');
    }
    if (!body) throw new BadRequestAppException('Body is required');
    if (body.length > 5000) {
      throw new BadRequestAppException('Body too long (max 5000 chars)');
    }

    if (args.categoryId) {
      const cat = await this.repo.findCategoryById(args.categoryId);
      if (!cat) throw new BadRequestAppException('Invalid category');
      if (cat.scopedTo && cat.scopedTo !== args.creator.type) {
        throw new BadRequestAppException(
          'Category is not available to this account type',
        );
      }
    }

    const ticketNumber = await this.repo.generateNextTicketNumber();
    const priority = args.priority ?? 'NORMAL';
    const slaTargetAt = computeSlaTarget(priority, new Date());
    const ticket = await this.repo.createTicket({
      ticketNumber,
      subject,
      priority,
      creatorType: args.creator.type,
      creatorId: args.creator.id,
      creatorName: args.creator.name,
      creatorEmail: args.creator.email,
      categoryId: args.categoryId ?? null,
      relatedOrderId: args.relatedOrderId ?? null,
      relatedReturnId: args.relatedReturnId ?? null,
      slaTargetAt,
      initialMessage: {
        senderType: args.creator.type,
        senderId: args.creator.id,
        senderName: args.creator.name,
        body,
      },
    });
    this.logger.log(
      `Ticket created ${ticket.ticketNumber} by ${args.creator.type}:${args.creator.id}`,
    );
    return ticket;
  }

  async getTicketDetailForActor(
    ticketId: string,
    actor: { type: TicketActorType; id: string; isAdmin: boolean },
  ): Promise<TicketWithMessages> {
    const detail = await this.repo.findTicketWithMessages(ticketId);
    if (!detail) throw new NotFoundAppException('Ticket not found');

    const isOwner =
      detail.ticket.creatorType === actor.type &&
      detail.ticket.creatorId === actor.id;
    if (!actor.isAdmin && !isOwner) {
      throw new ForbiddenAppException('Not allowed to view this ticket');
    }

    // Strip internal notes for non-admin viewers.
    const messages = actor.isAdmin
      ? detail.messages
      : detail.messages.filter((m) => !m.isInternalNote);

    return { ...detail, messages };
  }

  listTicketsForCreator(
    creator: { type: TicketActorType; id: string },
    filter: Omit<ListTicketsFilter, 'creatorType' | 'creatorId'>,
  ): Promise<ListTicketsPage> {
    return this.repo.listTickets({
      ...filter,
      creatorType: creator.type,
      creatorId: creator.id,
    });
  }

  listTicketsAdmin(filter: ListTicketsFilter): Promise<ListTicketsPage> {
    return this.repo.listTickets(filter);
  }

  // ── Messages ─────────────────────────────────────────────────────

  async reply(args: ReplyArgs): Promise<TicketWithMessages> {
    const body = args.body?.trim();
    if (!body) throw new BadRequestAppException('Body is required');
    if (body.length > 5000) {
      throw new BadRequestAppException('Body too long (max 5000 chars)');
    }

    const ticket = await this.repo.findTicketById(args.ticketId);
    if (!ticket) throw new NotFoundAppException('Ticket not found');

    if (ticket.status === 'CLOSED') {
      throw new BadRequestAppException(
        'Ticket is closed — re-open before replying',
      );
    }

    // Only ADMIN sender can mark a message as an internal note.
    const isInternalNote =
      args.isInternalNote === true && args.sender.type === 'ADMIN';

    // Permission: non-admin can only reply on tickets they own.
    if (args.sender.type !== 'ADMIN') {
      const isOwner =
        ticket.creatorType === args.sender.type &&
        ticket.creatorId === args.sender.id;
      if (!isOwner) {
        throw new ForbiddenAppException('Not allowed to reply on this ticket');
      }
    }

    await this.repo.appendMessage({
      ticketId: ticket.id,
      senderType: args.sender.type,
      senderId: args.sender.id,
      senderName: args.sender.name,
      body,
      isInternalNote,
    });

    // Notify the ticket creator on non-internal admin replies.
    // Internal notes never trigger a notification (admin → admin only).
    if (!isInternalNote) {
      try {
        await this.eventBus.publish({
          eventName: 'tickets.message.added',
          aggregate: 'Ticket',
          aggregateId: ticket.id,
          occurredAt: new Date(),
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            ticketSubject: ticket.subject,
            recipientType: ticket.creatorType,
            recipientId: ticket.creatorId,
            recipientName: ticket.creatorName,
            senderType: args.sender.type,
            senderName: args.sender.name,
            // Trim long replies to a one-line preview for the email.
            messagePreview:
              body.length > 240 ? body.slice(0, 237) + '…' : body,
          },
        });
      } catch {
        // events are best-effort
      }
    }

    // Status transitions: admin reply (non-internal) on OPEN → IN_PROGRESS,
    // and on IN_PROGRESS → WAITING_ON_CUSTOMER. Customer reply on
    // WAITING_ON_CUSTOMER → IN_PROGRESS so the queue picks it up.
    if (!isInternalNote) {
      const next = nextStatusOnReply(ticket.status, args.sender.type);
      if (next && next !== ticket.status) {
        await this.repo.updateTicket(ticket.id, { status: next });
      }
    }

    return this.getTicketDetailForActor(ticket.id, {
      type: args.sender.type,
      id: args.sender.id,
      isAdmin: args.sender.type === 'ADMIN',
    });
  }

  // ── Admin actions ────────────────────────────────────────────────

  async assign(ticketId: string, adminId: string | null): Promise<Ticket> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) throw new NotFoundAppException('Ticket not found');
    return this.repo.updateTicket(ticketId, { assignedAdminId: adminId });
  }

  async setStatus(
    ticketId: string,
    status: TicketStatus,
    adminId: string,
    resolutionSummary?: string,
  ): Promise<Ticket> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) throw new NotFoundAppException('Ticket not found');

    const data: Parameters<SupportRepository['updateTicket']>[1] = { status };
    if (status === 'RESOLVED') {
      data.resolvedAt = new Date();
      if (resolutionSummary?.trim()) {
        data.resolutionSummary = resolutionSummary.trim().slice(0, 2000);
      }
    }
    if (status === 'CLOSED') {
      data.closedAt = new Date();
      data.closedByAdminId = adminId;
      if (!ticket.resolvedAt) data.resolvedAt = new Date();
      if (resolutionSummary?.trim()) {
        data.resolutionSummary = resolutionSummary.trim().slice(0, 2000);
      }
    }
    if (status === 'OPEN' || status === 'IN_PROGRESS') {
      // Re-open: clear closed metadata + reset SLA so timers run again.
      data.closedAt = null;
      data.closedByAdminId = null;
      data.slaTargetAt = computeSlaTarget(ticket.priority, new Date());
    }
    return this.repo.updateTicket(ticketId, data);
  }

  async setPriority(
    ticketId: string,
    priority: TicketPriority,
  ): Promise<Ticket> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) throw new NotFoundAppException('Ticket not found');
    // Re-base SLA from now whenever priority changes — a downgrade
    // gives breathing room, an upgrade tightens the deadline.
    const slaTargetAt = computeSlaTarget(priority, new Date());
    return this.repo.updateTicket(ticketId, { priority, slaTargetAt });
  }

  async closeByCustomer(
    ticketId: string,
    customer: { type: TicketActorType; id: string },
  ): Promise<Ticket> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) throw new NotFoundAppException('Ticket not found');
    const isOwner =
      ticket.creatorType === customer.type &&
      ticket.creatorId === customer.id;
    if (!isOwner) {
      throw new ForbiddenAppException('Not allowed to close this ticket');
    }
    if (ticket.status === 'CLOSED') return ticket;
    return this.repo.updateTicket(ticketId, {
      status: 'CLOSED',
      closedAt: new Date(),
      resolvedAt: ticket.resolvedAt ?? new Date(),
    });
  }

  // ── Categories ───────────────────────────────────────────────────

  listCategories(scopedTo?: TicketActorType) {
    return this.repo.listCategories(scopedTo);
  }

  createCategory(input: {
    name: string;
    description?: string;
    scopedTo?: TicketActorType;
    sortOrder?: number;
  }) {
    if (!input.name?.trim()) {
      throw new BadRequestAppException('Name is required');
    }
    return this.repo.createCategory({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      scopedTo: input.scopedTo ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  updateCategory(
    id: string,
    input: Parameters<SupportRepository['updateCategory']>[1],
  ) {
    return this.repo.updateCategory(id, input);
  }
}

function nextStatusOnReply(
  current: TicketStatus,
  senderType: TicketActorType,
): TicketStatus | null {
  if (senderType === 'ADMIN') {
    if (current === 'OPEN') return 'IN_PROGRESS';
    if (current === 'IN_PROGRESS') return 'WAITING_ON_CUSTOMER';
    return null;
  }
  // Non-admin reply on a ticket waiting for them brings it back to the queue.
  if (current === 'WAITING_ON_CUSTOMER' || current === 'RESOLVED') {
    return 'IN_PROGRESS';
  }
  return null;
}

/**
 * SLA targets per priority. Time to first admin response.
 *   URGENT → 4h, HIGH → 24h, NORMAL → 48h, LOW → 5d.
 * No business-hour math today — clock runs continuously. If/when the
 * ops team needs business-hour SLAs, gate this on a flag and add a
 * working-hours calendar.
 */
const SLA_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 24,
  NORMAL: 48,
  LOW: 24 * 5,
};

export function computeSlaTarget(priority: TicketPriority, from: Date): Date {
  const hours = SLA_HOURS[priority] ?? 48;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
