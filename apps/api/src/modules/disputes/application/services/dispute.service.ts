import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Dispute,
  DisputeActorType,
  DisputeKind,
  DisputeStatus,
} from '@prisma/client';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { CaseDuplicateService } from '../../../../core/case-duplicate/case-duplicate.service';
import { applyOptimisticTransition } from '../../../../core/fsm/optimistic-transition';
import { RefundInstructionService } from '../../../refund-instructions/application/services/refund-instruction.service';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';

export interface FileDisputeArgs {
  filer: { type: DisputeActorType; id: string; name: string };
  kind: DisputeKind;
  summary: string;
  masterOrderId?: string;
  subOrderId?: string;
  returnId?: string;
}

/**
 * Args for ticket-promotion path. Differs from `FileDisputeArgs` in
 * three ways:
 *   - The link satisfaction is `sourceTicketId`, not master/sub/return.
 *   - Duplicate prevention is skipped (the ticket itself was the
 *     dedupe surface; promoting again is admin-explicit).
 *   - The filer is whoever opened the ticket — usually the customer,
 *     but the admin doing the promotion is the actor of record for
 *     the audit log.
 *
 * Existing TicketMessages are mirrored as DisputeMessage rows so the
 * admin sees full prior context inside the dispute view without
 * round-tripping back to the ticket.
 */
export interface PromoteFromTicketArgs {
  ticketId: string;
  ticketNumber: string;
  filer: { type: DisputeActorType; id: string; name: string };
  kind: DisputeKind;
  summary: string;
  masterOrderId?: string;
  subOrderId?: string;
  returnId?: string;
  severity?: number;
  // Existing ticket conversation to mirror in. Each entry becomes a
  // DisputeMessage with senderType mapped from TicketActorType.
  initialMessages: Array<{
    senderType: DisputeActorType;
    senderId: string;
    senderName: string;
    body: string;
    isInternalNote: boolean;
    createdAt: Date;
  }>;
  // Admin-only triage note posted as a DisputeMessage with
  // isInternalNote=true. Optional. Used to capture "why we're
  // promoting" without leaking it back to the ticket.
  internalNote?: string;
  promotedByAdminId: string;
}

export interface ReplyArgs {
  disputeId: string;
  sender: { type: DisputeActorType; id: string; name: string };
  body: string;
  isInternalNote?: boolean;
}

export interface DecisionArgs {
  disputeId: string;
  adminId: string;
  outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
  rationale: string;
  /**
   * Refund amount in paise. Required when customerRemedy is FULL_REFUND
   * / PARTIAL_REFUND / GOODWILL_CREDIT, forbidden when NO_REFUND.
   */
  amountInPaise?: number;
  /**
   * Phase 12 — who pays for this outcome. Validated against the matrix
   * in `validateDecisionMatrix()`:
   *   RESOLVED_BUYER  → SELLER | LOGISTICS | PLATFORM
   *   RESOLVED_SPLIT  → SELLER | LOGISTICS | PLATFORM
   *   RESOLVED_SELLER → CUSTOMER | NONE
   */
  liabilityParty: 'SELLER' | 'LOGISTICS' | 'PLATFORM' | 'CUSTOMER' | 'NONE';
  /**
   * Phase 12 — what the customer receives. Validated against the
   * outcome:
   *   FULL_REFUND      → outcome must be RESOLVED_BUYER
   *   PARTIAL_REFUND   → outcome must be RESOLVED_SPLIT
   *   GOODWILL_CREDIT  → outcome RESOLVED_BUYER + liabilityParty PLATFORM
   *   NO_REFUND        → outcome RESOLVED_SELLER
   */
  customerRemedy: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NO_REFUND' | 'GOODWILL_CREDIT';
  /** Optional courier metadata when liabilityParty=LOGISTICS. */
  logistics?: {
    courierName?: string;
    awbNumber?: string;
    evidenceFileId?: string;
    notes?: string;
  };
}

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly caseDuplicates: CaseDuplicateService,
    // Phase 12 — RefundInstruction is the single source of truth for
    // money owed to the customer. DisputeService.decide enqueues one
    // here; the saga executes it. Wallet credit is NEVER called
    // directly from this module.
    private readonly refundInstruction: RefundInstructionService,
    // Phase 12 — liability ledger. The right row gets written based on
    // who pays (seller / courier / platform). Idempotent — saga
    // replays don't duplicate.
    private readonly ledger: LiabilityLedgerPublicFacade,
  ) {}

  // ── Numbering ────────────────────────────────────────────────────

  async generateNextDisputeNumber(): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const seq = await tx.disputeSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const year = new Date().getFullYear();
        return `DSP-${year}-${String(seq.lastNumber).padStart(6, '0')}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async fileDispute(args: FileDisputeArgs): Promise<Dispute> {
    const summary = args.summary?.trim();
    if (!summary) throw new BadRequestAppException('summary is required');
    if (summary.length > 5000) throw new BadRequestAppException('summary too long (max 5000)');
    if (!args.masterOrderId && !args.subOrderId && !args.returnId) {
      throw new BadRequestAppException('Must link a masterOrderId, subOrderId, or returnId');
    }

    // Phase 1.5 — duplicate prevention. Two rules apply at file time:
    //   R2: an active dispute already exists for this returnId
    //   R3: an active dispute of the same kind already exists on this order
    // Both no-op when CASE_DUPLICATE_PREVENTION_ENABLED is false. Run
    // BEFORE generateNextDisputeNumber so we don't burn a number on a
    // duplicate.
    if (args.returnId) {
      await this.caseDuplicates.assertNoActiveDisputeForReturn({
        returnId: args.returnId,
        actor: { type: args.filer.type, id: args.filer.id },
      });
    }
    if (args.masterOrderId) {
      await this.caseDuplicates.assertNoActiveDisputeForOrderAndKind({
        masterOrderId: args.masterOrderId,
        kind: args.kind,
        actor: { type: args.filer.type, id: args.filer.id },
      });
    }

    const disputeNumber = await this.generateNextDisputeNumber();
    const dispute = await this.prisma.dispute.create({
      data: {
        disputeNumber,
        kind: args.kind,
        masterOrderId: args.masterOrderId ?? null,
        subOrderId: args.subOrderId ?? null,
        returnId: args.returnId ?? null,
        filedByType: args.filer.type,
        filedById: args.filer.id,
        filedByName: args.filer.name,
        summary,
        messages: {
          create: {
            senderType: args.filer.type,
            senderId: args.filer.id,
            senderName: args.filer.name,
            body: summary,
          },
        },
      },
    });
    this.logger.log(
      `Dispute ${dispute.disputeNumber} filed by ${args.filer.type}:${args.filer.id} (${args.kind})`,
    );

    this.eventBus
      .publish({
        eventName: 'disputes.filed',
        aggregate: 'Dispute',
        aggregateId: dispute.id,
        occurredAt: new Date(),
        payload: {
          disputeId: dispute.id,
          disputeNumber: dispute.disputeNumber,
          kind: dispute.kind,
          filedByType: dispute.filedByType,
          filedById: dispute.filedById,
          filedByName: dispute.filedByName,
          masterOrderId: dispute.masterOrderId,
          subOrderId: dispute.subOrderId,
          returnId: dispute.returnId,
          summary: dispute.summary.length > 240
            ? dispute.summary.slice(0, 237) + '…'
            : dispute.summary,
        },
      })
      .catch(() => undefined);

    return dispute;
  }

  /**
   * Ticket-promotion entry point. Used by the support module when an
   * admin decides a ticket needs the formal dispute machinery
   * (refund decision, audit chain, SLA escalation). Customer never
   * sees this path — they keep talking on the ticket; admin handles
   * everything in the dispute UI; mirroring keeps both sides aligned.
   *
   * Bypasses the duplicate-prevention guard because the ticket itself
   * was the dedupe surface for the customer's complaint; promoting it
   * is an admin-explicit second-stage action. Bypasses the
   * masterOrderId/subOrderId/returnId requirement because
   * `sourceTicketId` IS the link of record (a ticket may not have
   * those fields populated for general inquiries).
   */
  async promoteFromTicket(args: PromoteFromTicketArgs): Promise<Dispute> {
    const summary = args.summary?.trim();
    if (!summary) throw new BadRequestAppException('summary is required');
    if (summary.length > 5000) throw new BadRequestAppException('summary too long (max 5000)');
    if (args.severity != null && (args.severity < 1 || args.severity > 100)) {
      throw new BadRequestAppException('severity must be 1-100');
    }

    const disputeNumber = await this.generateNextDisputeNumber();

    const dispute = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          disputeNumber,
          kind: args.kind,
          severity: args.severity ?? 50,
          masterOrderId: args.masterOrderId ?? null,
          subOrderId: args.subOrderId ?? null,
          returnId: args.returnId ?? null,
          sourceTicketId: args.ticketId,
          filedByType: args.filer.type,
          filedById: args.filer.id,
          filedByName: args.filer.name,
          summary,
        },
      });

      // Mirror prior ticket conversation as DisputeMessage rows so
      // the admin sees full context. createdAt is preserved so the
      // dispute thread reads chronologically against the original
      // exchange.
      if (args.initialMessages.length > 0) {
        await tx.disputeMessage.createMany({
          data: args.initialMessages.map((m) => ({
            disputeId: created.id,
            senderType: m.senderType,
            senderId: m.senderId,
            senderName: m.senderName,
            body: m.body,
            isInternalNote: m.isInternalNote,
            createdAt: m.createdAt,
          })),
        });
      }

      // Lock the back-reference on the ticket so the next promotion
      // attempt fails on the unique constraint. Doing this inside the
      // tx keeps both sides consistent even if the caller crashes.
      await tx.ticket.update({
        where: { id: args.ticketId },
        data: { promotedToDisputeId: created.id },
      });

      // Optional admin-only triage note inside the dispute. Recorded
      // as the LAST message so it shows below the mirrored ticket
      // history in admin UI.
      if (args.internalNote && args.internalNote.trim().length > 0) {
        await tx.disputeMessage.create({
          data: {
            disputeId: created.id,
            senderType: 'ADMIN',
            senderId: args.promotedByAdminId,
            senderName: args.filer.name, // shown only to admins
            body: args.internalNote.trim(),
            isInternalNote: true,
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Dispute ${dispute.disputeNumber} promoted from ticket ${args.ticketNumber} by admin ${args.promotedByAdminId}`,
    );

    this.eventBus
      .publish({
        eventName: 'disputes.filed',
        aggregate: 'Dispute',
        aggregateId: dispute.id,
        occurredAt: new Date(),
        payload: {
          disputeId: dispute.id,
          disputeNumber: dispute.disputeNumber,
          kind: dispute.kind,
          filedByType: dispute.filedByType,
          filedById: dispute.filedById,
          filedByName: dispute.filedByName,
          masterOrderId: dispute.masterOrderId,
          subOrderId: dispute.subOrderId,
          returnId: dispute.returnId,
          sourceTicketId: dispute.sourceTicketId,
          // Distinguishes promotion-spawned disputes from direct filings
          // for any downstream notification routing — the customer-facing
          // notification on this branch is suppressed (they only get the
          // ticket-side update).
          promotedFromTicket: true,
          summary:
            dispute.summary.length > 240
              ? dispute.summary.slice(0, 237) + '…'
              : dispute.summary,
        },
      })
      .catch(() => undefined);

    this.audit
      .writeAuditLog({
        actorId: args.promotedByAdminId,
        action: 'dispute.promote_from_ticket',
        module: 'disputes',
        resource: 'dispute',
        resourceId: dispute.id,
        oldValue: { ticketId: args.ticketId, ticketNumber: args.ticketNumber },
        newValue: {
          disputeId: dispute.id,
          disputeNumber: dispute.disputeNumber,
          kind: dispute.kind,
        },
      })
      .catch(() => undefined);

    return dispute;
  }

  /**
   * Phase 12 follow-up — attach order / return context to a dispute
   * that was promoted from a generic ticket (no relatedOrderId /
   * relatedReturnId). Without this rescue path, orphan disputes can
   * never be assigned SELLER liability because the seller can't be
   * resolved (see resolveSellerIdIfNeeded).
   *
   * Rules:
   *   - At least one of orderNumber / returnNumber must be supplied.
   *   - The resolved order/return MUST belong to the dispute's filer
   *     (when filed by a CUSTOMER) — prevents an admin typo from
   *     pinning unrelated traffic to a third party's seller.
   *   - Idempotent: re-running with the same numbers no-ops; running
   *     with different ones throws ('already linked').
   *   - When a return is supplied, masterOrderId + subOrderId are
   *     also derived from it (returns always have both).
   */
  async attachContext(args: {
    disputeId: string;
    adminId: string;
    orderNumber?: string;
    returnNumber?: string;
  }): Promise<Dispute> {
    const orderNumber = normalizeOrderRef(args.orderNumber);
    const returnNumber = normalizeReturnRef(args.returnNumber);
    if (!orderNumber && !returnNumber) {
      throw new BadRequestAppException(
        'Provide at least one of orderNumber / returnNumber',
      );
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: args.disputeId },
      select: {
        id: true,
        disputeNumber: true,
        status: true,
        filedByType: true,
        filedById: true,
        masterOrderId: true,
        subOrderId: true,
        returnId: true,
      },
    });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    if (dispute.status.startsWith('RESOLVED_') || dispute.status === 'CLOSED') {
      throw new BadRequestAppException(
        'Cannot attach context to a closed dispute',
      );
    }

    // Resolve the references.
    let resolvedMasterOrderId: string | null = null;
    let resolvedSubOrderId: string | null = null;
    let resolvedReturnId: string | null = null;

    if (returnNumber) {
      const ret = await this.prisma.return.findUnique({
        where: { returnNumber },
        select: {
          id: true,
          customerId: true,
          masterOrderId: true,
          subOrderId: true,
        },
      });
      if (!ret) {
        throw new BadRequestAppException(
          `No return found with number "${returnNumber}"`,
        );
      }
      if (
        dispute.filedByType === 'CUSTOMER' &&
        ret.customerId !== dispute.filedById
      ) {
        throw new BadRequestAppException(
          `Return ${returnNumber} does not belong to the dispute filer`,
        );
      }
      resolvedReturnId = ret.id;
      resolvedMasterOrderId = ret.masterOrderId;
      resolvedSubOrderId = ret.subOrderId;
    }

    if (orderNumber) {
      const order = await this.prisma.masterOrder.findUnique({
        where: { orderNumber },
        select: { id: true, customerId: true },
      });
      if (!order) {
        throw new BadRequestAppException(
          `No order found with number "${orderNumber}"`,
        );
      }
      if (
        dispute.filedByType === 'CUSTOMER' &&
        order.customerId !== dispute.filedById
      ) {
        throw new BadRequestAppException(
          `Order ${orderNumber} does not belong to the dispute filer`,
        );
      }
      // If both order and return supplied, the return's masterOrderId
      // must match the supplied orderNumber — otherwise admin made a
      // mistake (return belongs to a different order).
      if (
        resolvedMasterOrderId &&
        resolvedMasterOrderId !== order.id
      ) {
        throw new BadRequestAppException(
          `Return ${returnNumber} is not part of order ${orderNumber}`,
        );
      }
      resolvedMasterOrderId = order.id;
    }

    // Idempotency / mismatch check.
    const conflicts: string[] = [];
    if (
      dispute.masterOrderId &&
      resolvedMasterOrderId &&
      dispute.masterOrderId !== resolvedMasterOrderId
    ) {
      conflicts.push('masterOrderId');
    }
    if (
      dispute.subOrderId &&
      resolvedSubOrderId &&
      dispute.subOrderId !== resolvedSubOrderId
    ) {
      conflicts.push('subOrderId');
    }
    if (
      dispute.returnId &&
      resolvedReturnId &&
      dispute.returnId !== resolvedReturnId
    ) {
      conflicts.push('returnId');
    }
    if (conflicts.length > 0) {
      throw new BadRequestAppException(
        `Dispute already linked to a different ${conflicts.join(', ')} — unlink first or contact ops`,
      );
    }

    const updated = await this.prisma.dispute.update({
      where: { id: args.disputeId },
      data: {
        masterOrderId: dispute.masterOrderId ?? resolvedMasterOrderId,
        subOrderId: dispute.subOrderId ?? resolvedSubOrderId,
        returnId: dispute.returnId ?? resolvedReturnId,
      },
    });

    this.audit
      .writeAuditLog({
        actorId: args.adminId,
        action: 'dispute.attach_context',
        module: 'disputes',
        resource: 'dispute',
        resourceId: updated.id,
        oldValue: {
          masterOrderId: dispute.masterOrderId,
          subOrderId: dispute.subOrderId,
          returnId: dispute.returnId,
        },
        newValue: {
          masterOrderId: updated.masterOrderId,
          subOrderId: updated.subOrderId,
          returnId: updated.returnId,
          orderNumber: orderNumber ?? null,
          returnNumber: returnNumber ?? null,
        },
      })
      .catch(() => undefined);

    this.logger.log(
      `Dispute ${updated.disputeNumber} context attached by admin ${args.adminId} ` +
        `(masterOrderId=${updated.masterOrderId}, subOrderId=${updated.subOrderId}, returnId=${updated.returnId})`,
    );

    return updated;
  }

  /**
   * Internal entry point used by the message-mirror handler when the
   * customer replies on a ticket whose `promotedToDisputeId` is set.
   * Bypasses the customer-facing ABAC + closed-state check because
   * the customer is talking on the ticket, not the dispute — they
   * don't know the dispute exists. The dispute's own reply guard
   * (no replies once the dispute reaches RESOLVED_x or CLOSED) is
   * honoured: if the dispute is
   * already closed, the mirror silently no-ops so the ticket reply
   * still succeeds.
   *
   * Idempotent on sourceTicketMessageId — the unique index
   * mirrored_from_ticket_message_id on dispute_messages causes a
   * retried call (e.g. event handler replay) to fail at the DB layer
   * with P2002; we catch that specific error and treat it as success.
   */
  async mirrorTicketMessageToDispute(args: {
    disputeId: string;
    sender: { type: DisputeActorType; id: string; name: string };
    body: string;
    sourceTicketMessageId: string;
  }): Promise<void> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: args.disputeId },
      select: { id: true, status: true },
    });
    if (!dispute) return;
    if (dispute.status === 'CLOSED' || dispute.status.startsWith('RESOLVED_')) {
      return;
    }
    try {
      await this.prisma.disputeMessage.create({
        data: {
          disputeId: args.disputeId,
          senderType: args.sender.type,
          senderId: args.sender.id,
          senderName: args.sender.name,
          body: args.body,
          isInternalNote: false,
          mirroredFromTicketMessageId: args.sourceTicketMessageId,
        },
      });
      await this.prisma.dispute.update({
        where: { id: args.disputeId },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      // Prisma P2002 = UNIQUE constraint violation. Surfaces when the
      // same source ticket-message id has already been mirrored — the
      // intended idempotent no-op. Re-throw anything else.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(
          `Mirror already exists for ticket-message ${args.sourceTicketMessageId} → dispute ${args.disputeId} (idempotent skip)`,
        );
        return;
      }
      throw err;
    }
  }

  async getDisputeForActor(
    disputeId: string,
    actor: { type: DisputeActorType; id: string; isAdmin: boolean },
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!dispute) throw new NotFoundAppException('Dispute not found');

    if (!actor.isAdmin) {
      const isFiler =
        dispute.filedByType === actor.type && dispute.filedById === actor.id;
      // Sellers also see disputes filed against their sub-order, even
      // when the buyer was the filer. Cross-check via the sub_orders
      // table (cheap point lookup, only runs when isFiler is false).
      let isAffectedSeller = false;
      if (!isFiler && actor.type === 'SELLER' && dispute.subOrderId) {
        const sub = await this.prisma.subOrder.findUnique({
          where: { id: dispute.subOrderId },
          select: { sellerId: true },
        });
        isAffectedSeller = sub?.sellerId === actor.id;
      }
      if (!isFiler && !isAffectedSeller) {
        throw new ForbiddenAppException('Not allowed');
      }
    }

    return {
      ...dispute,
      messages: actor.isAdmin
        ? dispute.messages
        : dispute.messages.filter((m) => !m.isInternalNote),
    };
  }

  async listForActor(
    actor: { type: DisputeActorType; id: string },
    page = 1,
    limit = 20,
    status?: DisputeStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.DisputeWhereInput = {
      filedByType: actor.type,
      filedById: actor.id,
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip, take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Disputes filed against a given seller's sub-orders (regardless of
   * whether the seller themselves filed). Used by the seller portal so
   * a seller sees buyer-filed complaints against them.
   */
  async listAgainstSeller(
    sellerId: string,
    page = 1,
    limit = 20,
    status?: DisputeStatus,
  ) {
    const skip = (page - 1) * limit;
    // Resolve the sub-order ids belonging to this seller, then filter
    // disputes whose subOrderId is in that set OR whose filedBy is the
    // seller themselves (covers both "filed against me" and "I filed").
    const subs = await this.prisma.subOrder.findMany({
      where: { sellerId },
      select: { id: true },
    });
    const subIds = subs.map((s) => s.id);
    const where: Prisma.DisputeWhereInput = {
      OR: [
        { subOrderId: { in: subIds } },
        { filedByType: 'SELLER', filedById: sellerId },
      ],
    };
    if (status) (where as any).status = status;
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async listAdmin(filter: {
    page: number;
    limit: number;
    status?: DisputeStatus;
    kind?: DisputeKind;
    assignedAdminId?: string | null;
    search?: string;
  }) {
    const skip = (filter.page - 1) * filter.limit;
    const where: Prisma.DisputeWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.assignedAdminId === null) where.assignedAdminId = null;
    else if (filter.assignedAdminId) where.assignedAdminId = filter.assignedAdminId;
    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { disputeNumber: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { filedByName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip, take: filter.limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  // ── Messaging ────────────────────────────────────────────────────

  async reply(args: ReplyArgs) {
    const body = args.body?.trim();
    if (!body) throw new BadRequestAppException('body is required');
    const dispute = await this.prisma.dispute.findUnique({ where: { id: args.disputeId } });
    if (!dispute) throw new NotFoundAppException('Dispute not found');

    if (dispute.status === 'CLOSED' || dispute.status.startsWith('RESOLVED_')) {
      throw new BadRequestAppException('Cannot reply on a closed/resolved dispute');
    }

    const isInternalNote =
      args.isInternalNote === true && args.sender.type === 'ADMIN';

    if (args.sender.type !== 'ADMIN') {
      const isOwner =
        dispute.filedByType === args.sender.type &&
        dispute.filedById === args.sender.id;
      // Sellers may also reply on disputes filed against their sub-order.
      let isAffectedSeller = false;
      if (!isOwner && args.sender.type === 'SELLER' && dispute.subOrderId) {
        const sub = await this.prisma.subOrder.findUnique({
          where: { id: dispute.subOrderId },
          select: { sellerId: true },
        });
        isAffectedSeller = sub?.sellerId === args.sender.id;
      }
      if (!isOwner && !isAffectedSeller) {
        throw new ForbiddenAppException('Not allowed');
      }
    }

    const message = await this.prisma.disputeMessage.create({
      data: {
        disputeId: args.disputeId,
        senderType: args.sender.type,
        senderId: args.sender.id,
        senderName: args.sender.name,
        body,
        isInternalNote,
      },
    });

    // Bump updatedAt so the queue ordering reflects activity.
    await this.prisma.dispute.update({
      where: { id: args.disputeId },
      data: { updatedAt: new Date() },
    });

    // Notify the other side on non-internal messages. Full body
    // included in the payload (not just preview) so the support-module
    // back-mirror handler can repost it verbatim onto the linked
    // ticket. The notification handler still uses messagePreview for
    // the email subject/snippet.
    if (!isInternalNote) {
      this.eventBus
        .publish({
          eventName: 'disputes.message.added',
          aggregate: 'Dispute',
          aggregateId: args.disputeId,
          occurredAt: new Date(),
          payload: {
            disputeId: args.disputeId,
            disputeNumber: dispute.disputeNumber,
            // The just-created DisputeMessage row id. The support
            // module's back-mirror handler stores this on the
            // mirrored TicketMessage so a retried event can't
            // duplicate-post on the customer's thread.
            messageId: message.id,
            senderType: args.sender.type,
            senderId: args.sender.id,
            senderName: args.sender.name,
            body,
            messagePreview: body.length > 240 ? body.slice(0, 237) + '…' : body,
            // Recipients computed by the handler from filer + assigned admin
            // + affected seller — we don't enumerate them here.
            filedByType: dispute.filedByType,
            filedById: dispute.filedById,
            subOrderId: dispute.subOrderId,
            assignedAdminId: dispute.assignedAdminId,
            // Phase 11 — set when the dispute was promoted from a ticket;
            // the support module's mirror handler routes the message back
            // onto the customer's ticket so they see admin replies under
            // the "Support" brand voice without ever knowing the dispute
            // exists. Suppresses the customer-facing dispute notification
            // on this branch (the ticket-message email handles it).
            sourceTicketId: dispute.sourceTicketId,
          },
        })
        .catch(() => undefined);
    }

    return message;
  }

  // ── Admin actions ────────────────────────────────────────────────

  async assign(disputeId: string, adminId: string | null) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    // Assignment auto-promotes OPEN → UNDER_REVIEW. Any other status
    // keeps its current value (assigning is independent of state).
    const targetStatus =
      dispute.status === 'OPEN' ? 'UNDER_REVIEW' : dispute.status;
    return applyOptimisticTransition({
      kind: 'DisputeStatus',
      toStatus: targetStatus,
      current: dispute,
      update: (where, statusPatch) =>
        this.prisma.dispute.update({
          where: { id: where.id, version: where.version } as any,
          data: {
            ...statusPatch,
            status: statusPatch.status as DisputeStatus,
            assignedAdminId: adminId,
          },
        }),
    });
  }

  async setStatus(
    disputeId: string,
    status: DisputeStatus,
    adminId?: string,
  ) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    const updated = await applyOptimisticTransition({
      kind: 'DisputeStatus',
      toStatus: status,
      current: dispute,
      update: (where, statusPatch) =>
        this.prisma.dispute.update({
          where: { id: where.id, version: where.version } as any,
          data: {
            ...statusPatch,
            status: statusPatch.status as DisputeStatus,
          },
        }),
    });

    // When the admin manually closes a dispute (procedural CLOSED — not
    // a RESOLVED_x decision), the linked support ticket on the
    // customer side needs to flip to RESOLVED too. Otherwise the
    // customer is left staring at an "Awaiting your reply" / "In
    // progress" state forever after we've internally walked away
    // from the case. Emits an event so the support module's
    // DisputeMirrorHandler can do the back-mirror without a
    // cross-module method call.
    //
    // No-op for legacy direct-filed disputes (sourceTicketId null) —
    // those have no customer ticket to keep in sync.
    if (
      status === 'CLOSED' &&
      dispute.status !== 'CLOSED' &&
      dispute.sourceTicketId
    ) {
      this.eventBus
        .publish({
          eventName: 'disputes.closed',
          aggregate: 'Dispute',
          aggregateId: dispute.id,
          occurredAt: new Date(),
          payload: {
            disputeId: dispute.id,
            disputeNumber: dispute.disputeNumber,
            sourceTicketId: dispute.sourceTicketId,
            closedByAdminId: adminId ?? null,
          },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  async setSeverity(disputeId: string, severity: number) {
    if (severity < 1 || severity > 100) {
      throw new BadRequestAppException('severity must be 1-100');
    }
    return this.prisma.dispute.update({ where: { id: disputeId }, data: { severity } });
  }

  /**
   * Phase 12 (post-Phase-11) — refactored per ADR-016.
   *
   * Three concerns previously tangled in the handler are now properly
   * separated:
   *   1. Decide: this method writes the dispute outcome + liability
   *      attribution + customer remedy.
   *   2. Record payable: a RefundInstruction is created when the
   *      customer is owed money. The saga executes the wallet credit;
   *      this service never touches the wallet directly.
   *   3. Record cost: one of SellerDebit / LogisticsClaim /
   *      PlatformExpense is written to attribute the cost. Recovery is
   *      a downstream concern (settlement run / claims ops).
   *
   * Validation enforces the matrix in ADR-016 — invalid combinations
   * are rejected before any DB write.
   */
  async decide(args: DecisionArgs) {
    const rationale = args.rationale?.trim();
    if (!rationale) throw new BadRequestAppException('rationale is required');
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: args.disputeId },
    });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    if (dispute.status.startsWith('RESOLVED_') || dispute.status === 'CLOSED') {
      throw new BadRequestAppException(`Dispute already ${dispute.status}`);
    }

    // Run the decision-matrix validator before touching any tables —
    // if the (outcome, liability, remedy, amount) tuple is illegal we
    // want to fail loudly + cleanly, not write a partial record.
    const amountInPaise = this.validateDecisionMatrix(args);

    const sellerIdForDebit = await this.resolveSellerIdIfNeeded(
      args.liabilityParty,
      dispute,
    );

    // ── 1. Atomic dispute write + outbox event ──────────────────────
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await applyOptimisticTransition({
        kind: 'DisputeStatus',
        toStatus: args.outcome,
        current: dispute,
        update: (where, statusPatch) =>
          tx.dispute.update({
            where: { id: where.id, version: where.version } as any,
            data: {
              ...statusPatch,
              status: statusPatch.status as DisputeStatus,
              decisionByAdminId: args.adminId,
              decisionAt: new Date(),
              decisionRationale: rationale,
              decisionAmountInPaise: amountInPaise,
              liabilityParty: args.liabilityParty,
              customerRemedy: args.customerRemedy,
            },
          }),
      });
      await this.eventBus.publish(
        {
          eventName: 'disputes.decided',
          aggregate: 'Dispute',
          aggregateId: row.id,
          occurredAt: new Date(),
          payload: {
            disputeId: row.id,
            disputeNumber: row.disputeNumber,
            outcome: row.status,
            amountInPaise,
            rationale,
            decidedByAdminId: args.adminId,
            filedByType: row.filedByType,
            filedById: row.filedById,
            masterOrderId: row.masterOrderId,
            subOrderId: row.subOrderId,
            returnId: row.returnId,
            sourceTicketId: row.sourceTicketId,
            // Phase 12 fields surfaced in the event so the support
            // mirror handler + any future webhook subscribers see the
            // full attribution without a re-fetch.
            liabilityParty: args.liabilityParty,
            customerRemedy: args.customerRemedy,
          },
        },
        { tx },
      );
      return row;
    });

    // ── 2. RefundInstruction (only when customer is owed money) ─────
    // Saga executes wallet credit. This service does NOT call
    // WalletPublicFacade directly — that's the boundary the rebuild
    // exists to enforce.
    if (
      amountInPaise &&
      amountInPaise > 0 &&
      (args.customerRemedy === 'FULL_REFUND' ||
        args.customerRemedy === 'PARTIAL_REFUND' ||
        args.customerRemedy === 'GOODWILL_CREDIT')
    ) {
      try {
        await this.refundInstruction.createForDispute({
          disputeId: updated.id,
          disputeNumber: updated.disputeNumber,
          customerId: updated.filedById,
          masterOrderId: updated.masterOrderId,
          amountInPaise,
          // Phase 12 (ADR-017) — let the threshold gate see the
          // remedy so goodwill always queues for finance approval.
          customerRemedy: args.customerRemedy as any,
        });
      } catch (err) {
        // Don't roll back the decision — the dispute IS decided, the
        // refund failed to enqueue. Queue an admin task so finance can
        // investigate. The saga itself enqueues failure tasks too;
        // this catch is for upstream errors (e.g. instruction-creation
        // failure before the saga even starts).
        this.logger.error(
          `Failed to create RefundInstruction for dispute ${updated.disputeNumber}: ${(err as Error).message}`,
        );
        // Phase 0 (PR 0.14) — set a 24h SLA on the admin task so the
        // breach-detector cron escalates if finance hasn't acted by
        // then. The customer's dispute shows "resolved" but their
        // wallet hasn't been credited yet; we cannot let the task
        // sit indefinitely in the ops queue.
        await this.ledger
          .enqueueAdminTask({
            kind: 'REFUND_INSTRUCTION_FAILED',
            sourceType: 'DISPUTE',
            sourceId: updated.id,
            reason: `RefundInstruction enqueue failed: ${(err as Error).message}`,
            slaHours: 24,
          })
          .catch(() => undefined);
        // Phase 0 (PR 0.14) — notify the customer their dispute is
        // resolved but the refund is pending manual review. Without
        // this, customers see "resolved" in their portal but never
        // get the money / wallet credit and have to file a follow-up
        // ticket. Best-effort emit; the admin task is the canonical
        // recovery channel.
        await this.eventBus
          .publish({
            eventName: 'disputes.refund_failure.queued',
            aggregate: 'Dispute',
            aggregateId: updated.id,
            occurredAt: new Date(),
            payload: {
              disputeId: updated.id,
              disputeNumber: updated.disputeNumber,
              customerId: updated.filedById,
              masterOrderId: updated.masterOrderId,
              amountInPaise: amountInPaise.toString(),
              reason: (err as Error).message,
              slaHours: 24,
            },
          })
          .catch(() => undefined);
      }
    }

    // ── 3. Liability ledger row ─────────────────────────────────────
    await this.recordLiabilityLedger({
      dispute: updated,
      args,
      amountInPaise,
      sellerIdForDebit,
    });

    // ── 4. Linked-return status update ──────────────────────────────
    if (updated.returnId) {
      await this.updateLinkedReturnStatus({
        returnId: updated.returnId,
        outcome: args.outcome,
        customerRemedy: args.customerRemedy,
        liabilityParty: args.liabilityParty,
      });
    }

    // ── 5. Audit (best-effort, outside the tx) ──────────────────────
    this.audit
      .writeAuditLog({
        actorId: args.adminId,
        action: 'dispute.decide',
        module: 'disputes',
        resource: 'dispute',
        resourceId: updated.id,
        oldValue: { status: dispute.status },
        newValue: {
          outcome: args.outcome,
          amountInPaise,
          rationale,
          liabilityParty: args.liabilityParty,
          customerRemedy: args.customerRemedy,
        },
      })
      .catch(() => undefined);

    return updated;
  }

  /**
   * Decision matrix per ADR-016. Returns the validated `amountInPaise`
   * (null if NO_REFUND, positive int otherwise). Throws BadRequest on
   * any illegal combination.
   */
  private validateDecisionMatrix(args: DecisionArgs): number | null {
    const { outcome, liabilityParty, customerRemedy } = args;

    // Outcome ↔ remedy compatibility.
    const ok =
      (outcome === 'RESOLVED_BUYER' &&
        (customerRemedy === 'FULL_REFUND' ||
          customerRemedy === 'GOODWILL_CREDIT')) ||
      (outcome === 'RESOLVED_SPLIT' && customerRemedy === 'PARTIAL_REFUND') ||
      (outcome === 'RESOLVED_SELLER' && customerRemedy === 'NO_REFUND');
    if (!ok) {
      throw new BadRequestAppException(
        `Outcome ${outcome} is not compatible with customerRemedy ${customerRemedy}. ` +
          `Valid pairs: BUYER+FULL_REFUND, BUYER+GOODWILL_CREDIT, SPLIT+PARTIAL_REFUND, SELLER+NO_REFUND.`,
      );
    }

    // Liability ↔ remedy compatibility.
    if (customerRemedy === 'NO_REFUND') {
      if (liabilityParty !== 'CUSTOMER' && liabilityParty !== 'NONE') {
        throw new BadRequestAppException(
          'NO_REFUND requires liabilityParty CUSTOMER or NONE',
        );
      }
    } else if (customerRemedy === 'GOODWILL_CREDIT') {
      if (liabilityParty !== 'PLATFORM') {
        throw new BadRequestAppException(
          'GOODWILL_CREDIT requires liabilityParty PLATFORM (cost absorbed)',
        );
      }
    } else {
      // FULL_REFUND or PARTIAL_REFUND
      if (
        liabilityParty !== 'SELLER' &&
        liabilityParty !== 'LOGISTICS' &&
        liabilityParty !== 'PLATFORM'
      ) {
        throw new BadRequestAppException(
          `${customerRemedy} requires liabilityParty SELLER, LOGISTICS, or PLATFORM`,
        );
      }
    }

    // Amount validation.
    if (customerRemedy === 'NO_REFUND') {
      if (args.amountInPaise && args.amountInPaise > 0) {
        throw new BadRequestAppException(
          'amountInPaise must be omitted for NO_REFUND',
        );
      }
      return null;
    }
    if (
      !args.amountInPaise ||
      !Number.isInteger(args.amountInPaise) ||
      args.amountInPaise <= 0
    ) {
      throw new BadRequestAppException(
        'amountInPaise (positive integer paise) is required for refund / goodwill outcomes',
      );
    }
    return args.amountInPaise;
  }

  /**
   * Resolve the seller id when the liability is going to land on the
   * seller. We need the SubOrder.sellerId snapshot — fetched once
   * here, before the transaction, since the ledger write happens
   * outside the dispute tx.
   */
  private async resolveSellerIdIfNeeded(
    liabilityParty: DecisionArgs['liabilityParty'],
    dispute: {
      subOrderId: string | null;
      returnId: string | null;
      masterOrderId: string | null;
    },
  ): Promise<string | null> {
    if (liabilityParty !== 'SELLER') return null;

    // Tier 1 — sub-order is the cleanest signal.
    if (dispute.subOrderId) {
      const so = await this.prisma.subOrder.findUnique({
        where: { id: dispute.subOrderId },
        select: { sellerId: true },
      });
      if (so?.sellerId) return so.sellerId;
    }

    // Tier 2 — return points at exactly one sub-order.
    if (dispute.returnId) {
      const ret = await this.prisma.return.findUnique({
        where: { id: dispute.returnId },
        select: { subOrder: { select: { sellerId: true } } },
      });
      if (ret?.subOrder?.sellerId) return ret.subOrder.sellerId;
    }

    // Tier 3 — only a master-order is set (typical for ticket-promoted
    // disputes where the customer wrote about an order generally,
    // before specifying which item). If the master has exactly one
    // SELLER-fulfilled sub-order, use it. If multiple sellers, refuse
    // with an actionable error so admin knows to either re-attribute
    // or pick a different liability party.
    if (dispute.masterOrderId) {
      const subs = await this.prisma.subOrder.findMany({
        where: {
          masterOrderId: dispute.masterOrderId,
          fulfillmentNodeType: 'SELLER',
          sellerId: { not: null },
        },
        select: { id: true, sellerId: true },
      });
      const uniqueSellers = Array.from(
        new Set(subs.map((s) => s.sellerId).filter((x): x is string => !!x)),
      );
      if (uniqueSellers.length === 1) {
        return uniqueSellers[0]!;
      }
      if (uniqueSellers.length > 1) {
        throw new BadRequestAppException(
          `Cannot auto-assign SELLER liability — order has ${uniqueSellers.length} sellers. ` +
            `Either link the dispute to a specific sub-order / return, or pick a different "Who pays" (PLATFORM / LOGISTICS).`,
        );
      }
    }

    throw new BadRequestAppException(
      'Cannot assign liability to SELLER — this dispute has no order context. ' +
        'Pick a different "Who pays" (PLATFORM absorbs the cost, or LOGISTICS if it\'s a courier issue).',
    );
  }

  /**
   * Writes exactly ONE ledger row based on liabilityParty + remedy.
   * Idempotent — saga retries / event replays land on the existing
   * row. Best-effort: a ledger failure does NOT roll back the
   * dispute (the decision stands; ops sees an admin task).
   */
  private async recordLiabilityLedger(args: {
    dispute: {
      id: string;
      disputeNumber: string;
      masterOrderId: string | null;
      subOrderId: string | null;
    };
    args: DecisionArgs;
    amountInPaise: number | null;
    sellerIdForDebit: string | null;
  }): Promise<void> {
    const { dispute, args: a, amountInPaise, sellerIdForDebit } = args;

    if (!amountInPaise || amountInPaise <= 0) {
      // NO_REFUND path — nothing to attribute. Customer-fault gets a
      // commission release (handled separately by the existing
      // commission-on-hold flow), no ledger write.
      return;
    }

    try {
      switch (a.liabilityParty) {
        case 'SELLER':
          if (!sellerIdForDebit) return;
          await this.ledger.recordSellerDebit({
            sellerId: sellerIdForDebit,
            sourceType: 'DISPUTE',
            sourceId: dispute.id,
            orderId: dispute.masterOrderId,
            subOrderId: dispute.subOrderId,
            amountInPaise,
            reason: `Dispute ${dispute.disputeNumber} resolved against seller — recoverable from settlement`,
          });
          return;
        case 'LOGISTICS':
          await this.ledger.fileLogisticsClaim({
            sourceType: 'DISPUTE',
            sourceId: dispute.id,
            courierName: a.logistics?.courierName,
            awbNumber: a.logistics?.awbNumber,
            amountInPaise,
            reason: `Dispute ${dispute.disputeNumber} attributed to logistics — recover from courier`,
            evidenceFileId: a.logistics?.evidenceFileId,
            notes: a.logistics?.notes,
          });
          return;
        case 'PLATFORM':
          await this.ledger.recordPlatformExpense({
            sourceType: 'DISPUTE',
            sourceId: dispute.id,
            expenseType:
              a.customerRemedy === 'GOODWILL_CREDIT'
                ? 'GOODWILL'
                : 'PLATFORM_FAULT',
            amountInPaise,
            reason: `Dispute ${dispute.disputeNumber} ${a.customerRemedy === 'GOODWILL_CREDIT' ? 'goodwill credit' : 'platform-fault refund'}`,
          });
          return;
        default:
          // CUSTOMER / NONE — no ledger row (handled in the early-return
          // above for amount<=0, but defensive in case the matrix
          // ever expands).
          return;
      }
    } catch (err) {
      this.logger.error(
        `Failed to write liability ledger for dispute ${dispute.disputeNumber}: ${(err as Error).message}`,
      );
      await this.ledger
        .enqueueAdminTask({
          kind: 'OTHER',
          sourceType: 'DISPUTE',
          sourceId: dispute.id,
          reason: `Liability ledger write failed: ${(err as Error).message}`,
        })
        .catch(() => undefined);
    }
  }

  /**
   * Map the dispute outcome onto the linked return's status. Skips
   * silently if the return doesn't exist or the FSM rejects the move
   * (e.g. return is already DISPUTE_OVERTURNED from a prior decision —
   * shouldn't happen but defensive).
   */
  private async updateLinkedReturnStatus(args: {
    returnId: string;
    outcome: DecisionArgs['outcome'];
    customerRemedy: DecisionArgs['customerRemedy'];
    liabilityParty: DecisionArgs['liabilityParty'];
  }): Promise<void> {
    const { returnId } = args;
    let nextStatus:
      | 'DISPUTE_OVERTURNED'
      | 'DISPUTE_PARTIAL_OVERRIDE'
      | 'DISPUTE_CONFIRMED'
      | 'GOODWILL_CREDITED';

    if (args.customerRemedy === 'GOODWILL_CREDIT') {
      nextStatus = 'GOODWILL_CREDITED';
    } else if (args.outcome === 'RESOLVED_SELLER') {
      nextStatus = 'DISPUTE_CONFIRMED';
    } else if (args.outcome === 'RESOLVED_SPLIT') {
      nextStatus = 'DISPUTE_PARTIAL_OVERRIDE';
    } else {
      nextStatus = 'DISPUTE_OVERTURNED';
    }

    try {
      const ret = await this.prisma.return.findUnique({
        where: { id: returnId },
        select: { id: true, status: true },
      });
      if (!ret) return;
      // Don't bother if the return is already in the same state — a
      // duplicate decision (which the dup-guard above blocks anyway)
      // would otherwise hit the FSM's no-self-transition rule.
      if (ret.status === nextStatus) return;
      await this.prisma.return.update({
        where: { id: returnId },
        data: { status: nextStatus },
      });
      this.logger.log(
        `Return ${returnId} → ${nextStatus} (dispute outcome)`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to update return ${returnId} status to ${nextStatus}: ${(err as Error).message}`,
      );
    }
  }

  // ── Evidence ────────────────────────────────────────────────────

  async attachEvidence(args: {
    disputeId: string;
    fileId: string;
    caption?: string;
    uploader: { type: DisputeActorType; id: string };
  }) {
    return this.prisma.disputeEvidence.create({
      data: {
        disputeId: args.disputeId,
        fileId: args.fileId,
        caption: args.caption ?? null,
        uploadedByType: args.uploader.type,
        uploadedById: args.uploader.id,
      },
    });
  }
}

/**
 * Strip "Order ", "ORDER ", "#", whitespace, etc. from order/return
 * references before lookup. Customers (and admins copy-pasting from a
 * UI label) routinely include the prefix word — making the resolver
 * lenient here saves a round-trip and a confusing error.
 */
export function normalizeOrderRef(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^\s+|\s+$/g, '')
    .replace(/^#+/, '')
    .replace(/^order\s+/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function normalizeReturnRef(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^\s+|\s+$/g, '')
    .replace(/^#+/, '')
    .replace(/^return\s+/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
