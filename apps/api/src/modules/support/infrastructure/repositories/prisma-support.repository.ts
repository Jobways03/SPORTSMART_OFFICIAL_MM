import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Ticket,
  TicketCategory,
  TicketMessage,
  TicketActorType,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CreateMessageInput,
  CreateTicketInput,
  ListTicketsFilter,
  ListTicketsPage,
  SupportRepository,
  TicketWithMessages,
} from '../../domain/repositories/support.repository.interface';

@Injectable()
export class PrismaSupportRepository implements SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async generateNextTicketNumber(): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const seq = await tx.ticketSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const year = new Date().getFullYear();
        const padded = String(seq.lastNumber).padStart(6, '0');
        return `TKT-${year}-${padded}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    return this.prisma.ticket.create({
      data: {
        ticketNumber: input.ticketNumber,
        subject: input.subject,
        priority: input.priority ?? 'NORMAL',
        creatorType: input.creatorType,
        creatorId: input.creatorId,
        creatorName: input.creatorName,
        creatorEmail: input.creatorEmail,
        categoryId: input.categoryId ?? null,
        relatedOrderId: input.relatedOrderId ?? null,
        relatedReturnId: input.relatedReturnId ?? null,
        slaTargetAt: input.slaTargetAt ?? null,
        messages: {
          create: {
            senderType: input.initialMessage.senderType,
            senderId: input.initialMessage.senderId,
            senderName: input.initialMessage.senderName,
            body: input.initialMessage.body,
          },
        },
      },
    });
  }

  async findTicketById(id: string): Promise<Ticket | null> {
    return this.prisma.ticket.findUnique({ where: { id } });
  }

  async findTicketWithMessages(id: string): Promise<TicketWithMessages | null> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        category: true,
      },
    });
    if (!ticket) return null;
    const { messages, category, ...rest } = ticket;
    return { ticket: rest as Ticket, messages, category };
  }

  async listTickets(filter: ListTicketsFilter): Promise<ListTicketsPage> {
    const { page, limit, search } = filter;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketWhereInput = {};
    if (filter.creatorType) where.creatorType = filter.creatorType;
    if (filter.creatorId) where.creatorId = filter.creatorId;
    if (filter.status) where.status = filter.status;
    if (filter.priority) where.priority = filter.priority;
    if (filter.assignedAdminId === null) {
      where.assignedAdminId = null;
    } else if (filter.assignedAdminId) {
      where.assignedAdminId = filter.assignedAdminId;
    }
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { ticketNumber: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { creatorEmail: { contains: q, mode: 'insensitive' } },
        { creatorName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        // Prisma orders enums by declaration order (LOW→URGENT), so `desc`
        // surfaces URGENT first. Only the admin queue opts into this.
        orderBy: filter.sortByPriority
          ? [{ priority: 'desc' }, { lastMessageAt: 'desc' }]
          : { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async updateTicket(
    id: string,
    data: Parameters<SupportRepository['updateTicket']>[1],
  ): Promise<Ticket> {
    return this.prisma.ticket.update({ where: { id }, data });
  }

  async appendMessage(input: CreateMessageInput): Promise<TicketMessage> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.ticketMessage.create({
        data: {
          ticketId: input.ticketId,
          senderType: input.senderType,
          senderId: input.senderId,
          senderName: input.senderName,
          body: input.body,
          isInternalNote: input.isInternalNote ?? false,
          mirroredFromDisputeMessageId:
            input.mirroredFromDisputeMessageId ?? null,
        },
      });
      // Bump activity timestamp only for non-internal messages — internal
      // notes shouldn't change the buyer's "last activity" view.
      if (!input.isInternalNote) {
        await tx.ticket.update({
          where: { id: input.ticketId },
          data: { lastMessageAt: message.createdAt },
        });
      }
      return message;
    });
  }

  async listCategories(scopedTo?: TicketActorType): Promise<TicketCategory[]> {
    return this.prisma.ticketCategory.findMany({
      where: {
        active: true,
        ...(scopedTo ? { OR: [{ scopedTo }, { scopedTo: null }] } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findCategoryById(id: string): Promise<TicketCategory | null> {
    return this.prisma.ticketCategory.findUnique({ where: { id } });
  }

  async createCategory(input: {
    name: string;
    description?: string | null;
    scopedTo?: TicketActorType | null;
    sortOrder?: number;
  }): Promise<TicketCategory> {
    return this.prisma.ticketCategory.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        scopedTo: input.scopedTo ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(
    id: string,
    data: Parameters<SupportRepository['updateCategory']>[1],
  ): Promise<TicketCategory> {
    return this.prisma.ticketCategory.update({ where: { id }, data });
  }
}
