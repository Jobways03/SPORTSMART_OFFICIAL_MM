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

export interface FileDisputeArgs {
  filer: { type: DisputeActorType; id: string; name: string };
  kind: DisputeKind;
  summary: string;
  masterOrderId?: string;
  subOrderId?: string;
  returnId?: string;
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
   * Refund amount in paise. Required for RESOLVED_BUYER + RESOLVED_SPLIT,
   * forbidden for RESOLVED_SELLER (validated in service).
   */
  amountInPaise?: number;
}

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
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

    // Notify the other side on non-internal messages.
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
            senderType: args.sender.type,
            senderId: args.sender.id,
            senderName: args.sender.name,
            messagePreview: body.length > 240 ? body.slice(0, 237) + '…' : body,
            // Recipients computed by the handler from filer + assigned admin
            // + affected seller — we don't enumerate them here.
            filedByType: dispute.filedByType,
            filedById: dispute.filedById,
            subOrderId: dispute.subOrderId,
            assignedAdminId: dispute.assignedAdminId,
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
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { assignedAdminId: adminId, status: dispute.status === 'OPEN' ? 'UNDER_REVIEW' : dispute.status },
    });
  }

  async setStatus(disputeId: string, status: DisputeStatus) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    return this.prisma.dispute.update({ where: { id: disputeId }, data: { status } });
  }

  async setSeverity(disputeId: string, severity: number) {
    if (severity < 1 || severity > 100) {
      throw new BadRequestAppException('severity must be 1-100');
    }
    return this.prisma.dispute.update({ where: { id: disputeId }, data: { severity } });
  }

  async decide(args: DecisionArgs) {
    const rationale = args.rationale?.trim();
    if (!rationale) throw new BadRequestAppException('rationale is required');
    const dispute = await this.prisma.dispute.findUnique({ where: { id: args.disputeId } });
    if (!dispute) throw new NotFoundAppException('Dispute not found');
    if (dispute.status.startsWith('RESOLVED_') || dispute.status === 'CLOSED') {
      throw new BadRequestAppException(`Dispute already ${dispute.status}`);
    }

    // Amount validation: BUYER + SPLIT need a positive integer amount;
    // SELLER must NOT carry one (enforced so the field's meaning stays clean).
    let amountInPaise: number | null = null;
    if (args.outcome === 'RESOLVED_SELLER') {
      if (args.amountInPaise && args.amountInPaise > 0) {
        throw new BadRequestAppException(
          'amountInPaise must be omitted for RESOLVED_SELLER',
        );
      }
    } else {
      if (!args.amountInPaise || !Number.isInteger(args.amountInPaise) || args.amountInPaise <= 0) {
        throw new BadRequestAppException(
          'amountInPaise (positive integer paise) is required for buyer/split outcomes',
        );
      }
      amountInPaise = args.amountInPaise;
    }

    const updated = await this.prisma.dispute.update({
      where: { id: args.disputeId },
      data: {
        status: args.outcome,
        decisionByAdminId: args.adminId,
        decisionAt: new Date(),
        decisionRationale: rationale,
        decisionAmountInPaise: amountInPaise,
      },
    });

    // Audit the decision so it's discoverable from the audit console
    // alongside other admin actions. Best-effort.
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
        },
      })
      .catch(() => undefined);

    // Fire the decision event. Refund handler subscribes to mint a
    // wallet credit / gateway refund when the outcome favours the
    // buyer. Best-effort — the dispute itself is already persisted.
    this.eventBus
      .publish({
        eventName: 'disputes.decided',
        aggregate: 'Dispute',
        aggregateId: updated.id,
        occurredAt: new Date(),
        payload: {
          disputeId: updated.id,
          disputeNumber: updated.disputeNumber,
          outcome: updated.status,
          amountInPaise,
          rationale,
          decidedByAdminId: args.adminId,
          filedByType: updated.filedByType,
          filedById: updated.filedById,
          masterOrderId: updated.masterOrderId,
          subOrderId: updated.subOrderId,
          returnId: updated.returnId,
        },
      })
      .catch(() => undefined);

    return updated;
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
