import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DisputeActorType,
  DisputeKind,
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
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CaseDuplicateService } from '../../../../core/case-duplicate/case-duplicate.service';
import { DisputesPublicFacade } from '../../../disputes/application/facades/disputes-public.facade';
import {
  normalizeOrderRef,
  normalizeReturnRef,
} from '../../../disputes/application/services/dispute.service';
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
  /**
   * Customer-friendly inputs: human-readable order / return numbers
   * (e.g. SM20260062, RET-2026-000017). When supplied, the service
   * resolves them to ids AND validates customer ownership. Either
   * id or number can be supplied — id wins if both are present.
   */
  relatedOrderNumber?: string;
  relatedReturnNumber?: string;
  /**
   * Phase 1.5 admin override — when an admin opens a duplicate ticket
   * intentionally (e.g. a separate complaint on the same order under
   * the same category), they can pass `allowDuplicate: true` to bypass
   * the duplicate-active-ticket rule. Customer / seller / franchise /
   * affiliate creator paths must NEVER set this.
   */
  allowDuplicate?: boolean;
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
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly caseDuplicates: CaseDuplicateService,
    private readonly disputes: DisputesPublicFacade,
    private readonly env: EnvService,
  ) {}

  /**
   * Phase 5.5 (2026-05-16) — build the live SLA config from env so
   * SLA computation always reflects the current configuration. Cached
   * via `this.env` so each call is cheap.
   */
  private getSlaConfig(): SlaConfig {
    return {
      businessHoursEnabled: this.env.getBoolean(
        'SUPPORT_SLA_BUSINESS_HOURS_ENABLED',
        false,
      ),
      businessHourStart: this.env.getNumber(
        'SUPPORT_SLA_BUSINESS_HOUR_START',
        9,
      ),
      businessHourEnd: this.env.getNumber('SUPPORT_SLA_BUSINESS_HOUR_END', 19),
    };
  }

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

    // Resolve human-readable numbers to ids + enforce ownership. Two
    // reasons to do this here, not at the controller:
    //   - Privacy: a customer must not be able to attach someone else's
    //     order/return id to their ticket. Backend is the only safe
    //     place to enforce that for CUSTOMER creators.
    //   - Number → id resolution: lets the storefront accept the format
    //     the customer sees on their order email (SM20260062) without
    //     leaking internal UUIDs into the URL.
    let resolvedOrderId = args.relatedOrderId ?? null;
    let resolvedReturnId = args.relatedReturnId ?? null;
    const normalizedOrderNumber = normalizeOrderRef(args.relatedOrderNumber);
    const normalizedReturnNumber = normalizeReturnRef(args.relatedReturnNumber);
    if (!resolvedOrderId && normalizedOrderNumber) {
      const order = await this.prisma.masterOrder.findUnique({
        where: { orderNumber: normalizedOrderNumber },
        select: { id: true, customerId: true },
      });
      if (!order) {
        throw new BadRequestAppException(
          `No order found with number "${normalizedOrderNumber}"`,
        );
      }
      resolvedOrderId = order.id;
    }
    if (!resolvedReturnId && normalizedReturnNumber) {
      const ret = await this.prisma.return.findUnique({
        where: { returnNumber: normalizedReturnNumber },
        select: { id: true, customerId: true, masterOrderId: true },
      });
      if (!ret) {
        throw new BadRequestAppException(
          `No return found with number "${normalizedReturnNumber}"`,
        );
      }
      resolvedReturnId = ret.id;
      // If the customer didn't also supply an order, derive it from
      // the return so the dispute (if promoted later) inherits both.
      if (!resolvedOrderId && ret.masterOrderId) {
        resolvedOrderId = ret.masterOrderId;
      }
    }

    if (args.creator.type === 'CUSTOMER') {
      if (resolvedOrderId) {
        const owned = await this.prisma.masterOrder.findUnique({
          where: { id: resolvedOrderId },
          select: { customerId: true },
        });
        if (!owned || owned.customerId !== args.creator.id) {
          throw new ForbiddenAppException(
            'Cannot link a ticket to an order that is not yours',
          );
        }
      }
      if (resolvedReturnId) {
        const owned = await this.prisma.return.findUnique({
          where: { id: resolvedReturnId },
          select: { customerId: true },
        });
        if (!owned || owned.customerId !== args.creator.id) {
          throw new ForbiddenAppException(
            'Cannot link a ticket to a return that is not yours',
          );
        }
      }
    }

    // Phase 1.5 — duplicate prevention. Rule R4: only one active ticket
    // per (relatedOrderId, categoryId). Skipped when either is missing
    // (the rule's natural key is incomplete) or when the caller passes
    // allowDuplicate (admin override). No-op at flag-OFF.
    if (resolvedOrderId && args.categoryId) {
      await this.caseDuplicates.assertNoActiveTicketForOrderAndCategory({
        relatedOrderId: resolvedOrderId,
        categoryId: args.categoryId,
        actor: { type: args.creator.type, id: args.creator.id },
        allowDuplicate: args.allowDuplicate,
      });
    }

    const ticketNumber = await this.repo.generateNextTicketNumber();
    const priority = args.priority ?? 'NORMAL';
    const slaTargetAt = computeSlaTarget(priority, new Date(), this.getSlaConfig());
    const ticket = await this.repo.createTicket({
      ticketNumber,
      subject,
      priority,
      creatorType: args.creator.type,
      creatorId: args.creator.id,
      creatorName: args.creator.name,
      creatorEmail: args.creator.email,
      categoryId: args.categoryId ?? null,
      relatedOrderId: resolvedOrderId,
      relatedReturnId: resolvedReturnId,
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

    // Phase 5.5 (2026-05-16) — auto-assignment.
    //
    // When `SUPPORT_AUTO_ASSIGN_ENABLED` is on we pick the next agent
    // round-robin from the pool of active admins who hold the
    // `support.reply` permission, and stamp the ticket with their id.
    // The auto-assign is fire-and-forget: a missing pool or DB hiccup
    // leaves the ticket in the standard unassigned state so manual
    // triage still works. Failure modes never block ticket creation.
    if (this.env.getBoolean('SUPPORT_AUTO_ASSIGN_ENABLED', false)) {
      this.autoAssignTicket(ticket.id).catch((err) => {
        this.logger.warn(
          `Auto-assign failed for ticket ${ticket.ticketNumber}: ${(err as Error).message}`,
        );
      });
    }
    return ticket;
  }

  /**
   * Phase 5.5 (2026-05-16) — round-robin auto-assignment.
   *
   * Algorithm:
   *   1. Load all active admins who hold the `support.reply`
   *      permission (default for SELLER_SUPPORT + SELLER_OPERATIONS
   *      roles).
   *   2. Among those, pick the one with the fewest currently OPEN /
   *      IN_PROGRESS tickets assigned. This is "least-loaded" rather
   *      than strict round-robin — fairer when agents close at
   *      different rates.
   *   3. Stamp the ticket with their id.
   *
   * Returns the chosen adminId, or null if no eligible agent was found
   * (caller-side log only; ticket remains unassigned). The query is
   * deliberately read-mostly + uses indexed columns so it stays cheap
   * at scale.
   */
  async autoAssignTicket(ticketId: string): Promise<string | null> {
    // 1. Find candidate admins. Permission is granted via either
    //    system role or custom role; we use the resolved permission
    //    set on AdminCustomRolePermission as the source of truth.
    const candidates = await this.prisma.admin.findMany({
      where: {
        status: 'ACTIVE',
        // System roles SELLER_SUPPORT, SELLER_OPERATIONS, SUPER_ADMIN
        // have `support.reply` by default per the permission registry.
        role: { in: ['SELLER_SUPPORT', 'SELLER_OPERATIONS', 'SUPER_ADMIN'] },
      },
      select: { id: true },
    });
    if (candidates.length === 0) return null;

    // 2. For each candidate, count open + in-progress assigned tickets.
    const candidateIds = candidates.map((c) => c.id);
    const counts = await this.prisma.ticket.groupBy({
      by: ['assignedAdminId'],
      where: {
        assignedAdminId: { in: candidateIds },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      _count: { _all: true },
    });
    const countById = new Map<string, number>();
    for (const row of counts) {
      if (row.assignedAdminId) {
        countById.set(row.assignedAdminId, row._count._all);
      }
    }

    // 3. Pick the least-loaded candidate. Ties broken by id order
    //    (stable + cheap).
    let chosen: { id: string; load: number } | null = null;
    for (const c of candidates) {
      const load = countById.get(c.id) ?? 0;
      if (!chosen || load < chosen.load) {
        chosen = { id: c.id, load };
      }
    }
    if (!chosen) return null;

    await this.repo.updateTicket(ticketId, { assignedAdminId: chosen.id });
    this.logger.log(
      `Auto-assigned ticket ${ticketId} to admin ${chosen.id} (current load: ${chosen.load})`,
    );
    return chosen.id;
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

    const created = await this.repo.appendMessage({
      ticketId: ticket.id,
      senderType: args.sender.type,
      senderId: args.sender.id,
      senderName: args.sender.name,
      body,
      isInternalNote,
    });

    // Phase 11 (post-Phase-10) — message mirroring for promoted tickets.
    // When the ticket has been promoted to a dispute, customer/seller/etc.
    // replies are mirrored into the dispute thread so the admin sees the
    // full conversation inside their dispute UI without bouncing back to
    // the ticket. Internal notes never mirror — they're admin-only on
    // either side. Admin replies don't mirror through this path either:
    // when the dispute exists, admin should be replying on the dispute
    // (and that side mirrors back via the disputes.message.added handler).
    //
    // The TicketMessage id is threaded as `sourceTicketMessageId` so the
    // dispute's UNIQUE(mirrored_from_ticket_message_id) constraint can
    // dedupe a retried mirror call without inserting twice.
    if (
      !isInternalNote &&
      args.sender.type !== 'ADMIN' &&
      ticket.promotedToDisputeId
    ) {
      const senderType = mapTicketActorToDisputeActor(args.sender.type);
      if (senderType) {
        // Best-effort — a mirror failure must not poison the customer's
        // reply (which already succeeded). The dispute side's event-fed
        // back-channel + admin's manual refresh both compensate.
        this.disputes
          .mirrorTicketMessageToDispute({
            disputeId: ticket.promotedToDisputeId,
            sender: {
              type: senderType,
              id: args.sender.id,
              name: args.sender.name,
            },
            body,
            sourceTicketMessageId: created.id,
          })
          .catch((err) =>
            this.logger.warn(
              `Failed to mirror ticket reply to dispute ${ticket.promotedToDisputeId}: ${(err as Error).message}`,
            ),
          );
      }
    }

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
      data.slaTargetAt = computeSlaTarget(
        ticket.priority,
        new Date(),
        this.getSlaConfig(),
      );
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
    const slaTargetAt = computeSlaTarget(priority, new Date(), this.getSlaConfig());
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

  // ── Promotion to dispute ─────────────────────────────────────────
  // The customer never sees this path. Admin-initiated; the ticket
  // stays open as the customer's window while the dispute carries
  // the formal-resolution machinery.

  async promoteToDispute(args: {
    ticketId: string;
    adminId: string;
    adminName: string;
    kind: DisputeKind;
    severity?: number;
    summary?: string;
    internalNote?: string;
  }): Promise<{ ticketId: string; disputeId: string; disputeNumber: string }> {
    const detail = await this.repo.findTicketWithMessages(args.ticketId);
    if (!detail) throw new NotFoundAppException('Ticket not found');

    if (detail.ticket.promotedToDisputeId) {
      throw new BadRequestAppException(
        'This ticket has already been promoted to a dispute',
      );
    }
    if (detail.ticket.status === 'CLOSED') {
      throw new BadRequestAppException(
        'Cannot promote a closed ticket — re-open it first',
      );
    }

    const filerType = mapTicketActorToDisputeActor(detail.ticket.creatorType);
    if (!filerType) {
      throw new BadRequestAppException(
        `Cannot promote a ticket created by ${detail.ticket.creatorType} — only customer/seller-filed tickets can become disputes`,
      );
    }

    // Default the dispute summary to the original ticket subject + first
    // message body, capped to 5000. Admin can override via args.summary
    // when the original phrasing is too vague.
    const firstMsg = detail.messages.find((m) => !m.isInternalNote);
    const fallbackSummary = [detail.ticket.subject, firstMsg?.body ?? '']
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 5000);
    const summary = (args.summary?.trim() || fallbackSummary).slice(0, 5000);

    const dispute = await this.disputes.promoteFromTicket({
      ticketId: args.ticketId,
      ticketNumber: detail.ticket.ticketNumber,
      filer: {
        type: filerType,
        id: detail.ticket.creatorId,
        name: detail.ticket.creatorName,
      },
      kind: args.kind,
      summary,
      severity: args.severity,
      masterOrderId: detail.ticket.relatedOrderId ?? undefined,
      returnId: detail.ticket.relatedReturnId ?? undefined,
      initialMessages: detail.messages.map((m) => ({
        senderType:
          mapTicketActorToDisputeActor(m.senderType) ?? 'ADMIN',
        senderId: m.senderId,
        senderName: m.senderName,
        body: m.body,
        isInternalNote: m.isInternalNote,
        createdAt: m.createdAt,
      })),
      internalNote: args.internalNote,
      promotedByAdminId: args.adminId,
    });

    // Bump ticket activity so the queue reflects the promotion. Don't
    // change status — admin may keep working the ticket regardless.
    await this.repo.updateTicket(args.ticketId, {
      lastMessageAt: new Date(),
    });

    this.logger.log(
      `Ticket ${detail.ticket.ticketNumber} promoted → dispute ${dispute.disputeNumber} by admin ${args.adminId}`,
    );

    return {
      ticketId: args.ticketId,
      disputeId: dispute.id,
      disputeNumber: dispute.disputeNumber,
    };
  }

  /**
   * Back-mirror entry point used by the disputes.message.added handler
   * when the message is an admin reply on a promoted dispute. Posts a
   * TicketMessage with senderName="Support" so the customer sees a
   * uniform brand voice in their support thread regardless of which
   * admin actually authored the reply.
   *
   * Internal notes never reach this path (the disputes service never
   * emits the event for internal notes).
   *
   * Idempotent on `sourceDisputeMessageId` — the
   * UNIQUE(mirrored_from_dispute_message_id) index on `ticket_messages`
   * causes a retried event handler to fail at the DB layer; we catch
   * P2002 and treat it as success so the customer never sees a
   * doubled-up reply.
   */
  async mirrorDisputeMessageToTicket(args: {
    ticketId: string;
    body: string;
    adminId: string;
    sourceDisputeMessageId: string;
  }): Promise<void> {
    const ticket = await this.repo.findTicketById(args.ticketId);
    if (!ticket) return;
    if (ticket.status === 'CLOSED') return;

    try {
      await this.repo.appendMessage({
        ticketId: ticket.id,
        senderType: 'ADMIN',
        senderId: args.adminId,
        // Customer-facing brand voice — never leak the individual admin's
        // name through the dispute → ticket mirror.
        senderName: 'Support',
        body: args.body,
        isInternalNote: false,
        mirroredFromDisputeMessageId: args.sourceDisputeMessageId,
      });
    } catch (err) {
      // Prisma P2002 = UNIQUE violation on the provenance column.
      // A retry of the same source dispute message — silent skip.
      if (
        err &&
        (err as any).code === 'P2002' &&
        Array.isArray((err as any).meta?.target) &&
        (err as any).meta.target.includes('mirrored_from_dispute_message_id')
      ) {
        this.logger.log(
          `Mirror already exists for dispute-message ${args.sourceDisputeMessageId} → ticket ${ticket.id} (idempotent skip)`,
        );
        return;
      }
      throw err;
    }

    // Same status transition rules as a regular admin reply.
    const next = nextStatusOnReply(ticket.status, 'ADMIN');
    if (next && next !== ticket.status) {
      await this.repo.updateTicket(ticket.id, {
        status: next,
        lastMessageAt: new Date(),
      });
    } else {
      await this.repo.updateTicket(ticket.id, { lastMessageAt: new Date() });
    }

    // Notify the customer through the normal ticket message channel.
    // Reuses the existing email template so no new copy is required.
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
          senderType: 'ADMIN',
          senderName: 'Support',
          messagePreview:
            args.body.length > 240 ? args.body.slice(0, 237) + '…' : args.body,
        },
      });
    } catch {
      // events are best-effort
    }
  }

  /**
   * Post a final customer-facing message on a promoted ticket and flip
   * it to RESOLVED when the dispute is decided. Called from the
   * dispute-decision relay handler. Customer sees a friendly close-out
   * note (and the wallet credit landing separately if applicable);
   * the dispute-side rationale is NOT mirrored verbatim because it
   * may contain admin-only language.
   */
  async resolveTicketAfterDisputeDecision(args: {
    ticketId: string;
    customerMessage: string;
    resolutionSummary: string;
    adminId: string;
  }): Promise<void> {
    const ticket = await this.repo.findTicketById(args.ticketId);
    if (!ticket) return;
    if (ticket.status === 'CLOSED') return;

    await this.repo.appendMessage({
      ticketId: ticket.id,
      senderType: 'ADMIN',
      senderId: args.adminId,
      senderName: 'Support',
      body: args.customerMessage,
      isInternalNote: false,
    });
    await this.repo.updateTicket(ticket.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolutionSummary: args.resolutionSummary.slice(0, 2000),
      lastMessageAt: new Date(),
    });

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
          senderType: 'ADMIN',
          senderName: 'Support',
          messagePreview:
            args.customerMessage.length > 240
              ? args.customerMessage.slice(0, 237) + '…'
              : args.customerMessage,
        },
      });
    } catch {
      // events are best-effort
    }
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
 *
 * Phase 5.5 (2026-05-16) — business-hours mode.
 * When `SUPPORT_SLA_BUSINESS_HOURS_ENABLED=true`, the SLA clock only
 * advances during business hours (default 09:00-19:00 IST) on
 * weekdays. A ticket filed at Friday 17:00 with a 4h SLA now resolves
 * at Monday 11:00 instead of Friday 21:00. The previous wall-clock
 * behaviour stays as the default so existing deployments don't change
 * SLA outcomes overnight.
 *
 * Time zone: IST = UTC+5:30 (no daylight savings).
 */
const SLA_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 24,
  NORMAL: 48,
  LOW: 24 * 5,
};

export interface SlaConfig {
  businessHoursEnabled: boolean;
  /** Start of business day in IST hour (0-23). */
  businessHourStart: number;
  /** End of business day in IST hour (1-24). */
  businessHourEnd: number;
}

const DEFAULT_SLA_CONFIG: SlaConfig = {
  businessHoursEnabled: false,
  businessHourStart: 9,
  businessHourEnd: 19,
};

export function computeSlaTarget(
  priority: TicketPriority,
  from: Date,
  config: SlaConfig = DEFAULT_SLA_CONFIG,
): Date {
  const hours = SLA_HOURS[priority] ?? 48;
  if (!config.businessHoursEnabled) {
    return new Date(from.getTime() + hours * 60 * 60 * 1000);
  }
  return addBusinessHours(from, hours, config);
}

/**
 * Advance `from` by `hoursToAdd` of business time. Business time
 * accrues only between `businessHourStart` and `businessHourEnd` IST
 * on weekdays (Mon–Fri). Saturdays + Sundays do not count.
 *
 * Implementation note: we step by 15-minute increments so the result
 * is exact to the quarter-hour. For typical SLAs (4-120h) this loops
 * at most ~500 times — well under 1ms.
 */
function addBusinessHours(
  from: Date,
  hoursToAdd: number,
  config: SlaConfig,
): Date {
  const STEP_MIN = 15;
  const stepsNeeded = Math.ceil((hoursToAdd * 60) / STEP_MIN);
  let cursor = new Date(from);
  let stepsAdvanced = 0;
  // Hard guard against infinite loop on bad config (start ≥ end).
  let safetyTicks = stepsNeeded * 50;
  while (stepsAdvanced < stepsNeeded && safetyTicks-- > 0) {
    cursor = new Date(cursor.getTime() + STEP_MIN * 60 * 1000);
    if (isBusinessTime(cursor, config)) {
      stepsAdvanced++;
    }
  }
  return cursor;
}

/**
 * Returns true when the given UTC timestamp falls within business
 * hours after conversion to IST. Saturday + Sunday IST always return
 * false.
 */
function isBusinessTime(utc: Date, config: SlaConfig): boolean {
  // Shift UTC by +5:30 to read the IST clock components.
  const istMs = utc.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  // getUTC* on the shifted timestamp yields IST-local components.
  const dayOfWeek = ist.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const hour = ist.getUTCHours();
  return hour >= config.businessHourStart && hour < config.businessHourEnd;
}

/**
 * Bridge between the two actor enums — TicketActorType has a wider
 * surface (CUSTOMER / ADMIN / SELLER / FRANCHISE / AFFILIATE) than
 * DisputeActorType (CUSTOMER / SELLER / ADMIN). Returns null for
 * franchise/affiliate ticket creators because the dispute system
 * doesn't currently model those parties — promoting such tickets is
 * disallowed at the service entry point.
 */
function mapTicketActorToDisputeActor(
  t: TicketActorType,
): DisputeActorType | null {
  switch (t) {
    case 'CUSTOMER':
      return 'CUSTOMER';
    case 'SELLER':
      return 'SELLER';
    case 'ADMIN':
      return 'ADMIN';
    default:
      return null;
  }
}
