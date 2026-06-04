import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ChargebackStatus,
  ChargebackEvidenceStatus,
  ChargebackFinancialImpact,
  PaymentMismatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';

/**
 * Phase 169 (Payment Ops audit #1/#2/#18) — Razorpay dispute (chargeback)
 * lifecycle. The webhook calls `ingestDisputeEvent`; the admin UI reads via
 * `listChargebacks` / `getChargeback` and contests via `markEvidenceSubmitted`.
 *
 * `LiabilityLedgerPublicFacade` is used to enqueue a CHARGEBACK_EVIDENCE_DUE
 * admin task (the established finance-attention mechanism — there is no
 * settlement-level HOLD primitive yet; that gate is a deeper follow-up).
 */
@Injectable()
export class ChargebackService {
  private readonly logger = new Logger(ChargebackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    @Optional() private readonly ledger?: LiabilityLedgerPublicFacade,
  ) {}

  /**
   * Map a Razorpay dispute event + entity to our internal state transition.
   * `financialImpact: null` is a sentinel meaning "preserve the prior impact"
   * (Phase 169 review L1#4 — a `closed` event with no win/lost split must NOT
   * clobber a HELD→? timeline to NONE; we keep whatever the dispute was last in
   * so compliance can still see money was held during the dispute).
   */
  private mapEvent(eventType: string, entityStatus?: string): {
    status: ChargebackStatus;
    evidenceStatus: ChargebackEvidenceStatus;
    financialImpact: ChargebackFinancialImpact | null;
    terminal: boolean;
  } {
    const t = eventType.toLowerCase();
    if (t.endsWith('won')) {
      return { status: 'WON', evidenceStatus: 'NOT_REQUIRED', financialImpact: 'RECOVERED', terminal: true };
    }
    if (t.endsWith('lost')) {
      return { status: 'LOST', evidenceStatus: 'NOT_REQUIRED', financialImpact: 'LOST', terminal: true };
    }
    if (t.endsWith('closed')) {
      // closed without a win/lost split — infer from the entity status if given.
      const s = (entityStatus ?? '').toLowerCase();
      if (s === 'won') return { status: 'WON', evidenceStatus: 'NOT_REQUIRED', financialImpact: 'RECOVERED', terminal: true };
      if (s === 'lost') return { status: 'LOST', evidenceStatus: 'NOT_REQUIRED', financialImpact: 'LOST', terminal: true };
      // Unknown outcome — preserve the prior financial impact (null sentinel).
      return { status: 'CLOSED', evidenceStatus: 'NOT_REQUIRED', financialImpact: null, terminal: true };
    }
    if (t.endsWith('under_review')) {
      return { status: 'UNDER_REVIEW', evidenceStatus: 'SUBMITTED', financialImpact: 'HELD', terminal: false };
    }
    // created / disputed / anything else contestable
    return { status: 'OPEN', evidenceStatus: 'PENDING', financialImpact: 'HELD', terminal: false };
  }

  /**
   * Idempotently upsert a chargeback from a dispute webhook + advance its
   * lifecycle. Returns the row + whether a state transition actually occurred.
   * Safe to call repeatedly (the webhook layer also dedups via the durable
   * ledger; this is the data-layer idempotency).
   */
  async ingestDisputeEvent(args: {
    eventType: string;
    providerDisputeId: string;
    providerPaymentId?: string | null;
    masterOrderId?: string | null;
    orderNumber?: string | null;
    customerId?: string | null;
    reasonCode?: string | null;
    amountInPaise: bigint;
    currency?: string | null;
    dueDate?: Date | null;
    entityStatus?: string | null;
    rawPayload?: unknown;
  }): Promise<{ chargeback: any; transitioned: boolean; opened: boolean }> {
    const mapped = this.mapEvent(args.eventType, args.entityStatus ?? undefined);
    const existing = await this.prisma.chargeback.findUnique({
      where: { providerDisputeId: args.providerDisputeId },
    });

    let chargeback: any;
    let opened = false;
    let transitioned = false;

    if (!existing) {
      chargeback = await this.prisma.chargeback.create({
        data: {
          providerDisputeId: args.providerDisputeId,
          providerPaymentId: args.providerPaymentId ?? null,
          masterOrderId: args.masterOrderId ?? null,
          orderNumber: args.orderNumber ?? null,
          customerId: args.customerId ?? null,
          reasonCode: args.reasonCode ?? null,
          status: mapped.status,
          amountInPaise: args.amountInPaise,
          currency: args.currency ?? 'INR',
          dueDate: args.dueDate ?? null,
          evidenceStatus: mapped.evidenceStatus,
          // null sentinel only occurs on a `closed`-without-resolution arriving
          // as the FIRST event (no prior to preserve) → default HELD→NONE.
          financialImpact: mapped.financialImpact ?? 'NONE',
          resolvedAt: mapped.terminal ? new Date() : null,
          rawPayload: (args.rawPayload ?? undefined) as Prisma.InputJsonValue,
        },
      });
      opened = true;
      transitioned = true;
    } else {
      // Do not regress a terminal dispute (a late duplicate of an earlier event).
      const wasTerminal =
        existing.status === 'WON' || existing.status === 'LOST' || existing.status === 'CLOSED';
      if (wasTerminal) {
        return { chargeback: existing, transitioned: false, opened: false };
      }
      transitioned = existing.status !== mapped.status;
      chargeback = await this.prisma.chargeback.update({
        where: { id: existing.id },
        data: {
          status: mapped.status,
          // never downgrade evidence already SUBMITTED back to PENDING
          evidenceStatus:
            existing.evidenceStatus === 'SUBMITTED' && mapped.evidenceStatus === 'PENDING'
              ? existing.evidenceStatus
              : mapped.evidenceStatus,
          // L1#4 — preserve the prior impact on a `closed`-without-resolution
          // (null sentinel) so the HELD timeline isn't clobbered to NONE.
          financialImpact: mapped.financialImpact ?? existing.financialImpact,
          reasonCode: args.reasonCode ?? existing.reasonCode,
          dueDate: args.dueDate ?? existing.dueDate,
          resolvedAt: mapped.terminal ? new Date() : existing.resolvedAt,
          rawPayload: (args.rawPayload ?? existing.rawPayload ?? undefined) as Prisma.InputJsonValue,
        },
      });
    }

    // Side effects only on a genuine transition.
    if (transitioned) {
      // #18 — when contestable, enqueue an SLA-bound evidence task; the gateway's
      // respond_by drives the deadline.
      if (!mapped.terminal && this.ledger) {
        const slaHours = args.dueDate
          ? Math.max(1, Math.round((args.dueDate.getTime() - Date.now()) / 3_600_000))
          : 168; // 7d default
        await this.ledger
          .enqueueAdminTask({
            kind: 'CHARGEBACK_EVIDENCE_DUE',
            sourceType: 'MANUAL',
            sourceId: chargeback.id,
            reason:
              `Razorpay dispute ${args.providerDisputeId} on payment ` +
              `${args.providerPaymentId ?? 'n/a'} (order ${args.orderNumber ?? 'n/a'}) — ` +
              `₹${(Number(args.amountInPaise) / 100).toFixed(2)} held. Submit contest ` +
              `evidence before ${args.dueDate ? args.dueDate.toISOString() : 'the deadline'}.`,
            slaHours,
          })
          .catch((err) =>
            this.logger.error(
              `chargeback ${chargeback.id}: failed to enqueue evidence task: ${(err as Error)?.message ?? err}`,
            ),
          );
      }

      await this.events
        .publish({
          eventName: opened ? 'payment.dispute.opened' : 'payment.dispute.updated',
          aggregate: 'Chargeback',
          aggregateId: chargeback.id,
          occurredAt: new Date(),
          payload: {
            chargebackId: chargeback.id,
            providerDisputeId: args.providerDisputeId,
            providerPaymentId: args.providerPaymentId ?? null,
            masterOrderId: args.masterOrderId ?? null,
            status: mapped.status,
            financialImpact: mapped.financialImpact,
            amountInPaise: args.amountInPaise.toString(),
          },
        })
        .catch(() => undefined);

      this.logger.warn(
        `Chargeback ${opened ? 'OPENED' : 'updated'}: dispute=${args.providerDisputeId} ` +
          `status=${mapped.status} impact=${mapped.financialImpact} order=${args.orderNumber ?? 'n/a'}`,
      );
    }

    return { chargeback, transitioned, opened };
  }

  async listChargebacks(filter: {
    page: number;
    limit: number;
    status?: ChargebackStatus;
    evidenceDueWithinHours?: number;
    search?: string;
  }) {
    const skip = (filter.page - 1) * filter.limit;
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.evidenceDueWithinHours) {
      where.evidenceStatus = 'PENDING';
      where.dueDate = { lte: new Date(Date.now() + filter.evidenceDueWithinHours * 3_600_000) };
    }
    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { providerPaymentId: { contains: q, mode: 'insensitive' } },
        { providerDisputeId: { contains: q, mode: 'insensitive' } },
        { reasonCode: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.chargeback.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: filter.limit,
      }),
      this.prisma.chargeback.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  async getChargeback(id: string) {
    const cb = await this.prisma.chargeback.findUnique({ where: { id } });
    if (!cb) throw new NotFoundAppException('Chargeback not found');
    const attempts = cb.masterOrderId
      ? await this.prisma.paymentAttempt.findMany({
          where: { masterOrderId: cb.masterOrderId },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return { chargeback: cb, attempts };
  }

  /**
   * Record that contest evidence was submitted to the gateway. CAS-guarded so
   * two admins can't both claim submission; only an OPEN/UNDER_REVIEW dispute
   * with PENDING evidence can be marked.
   */
  async markEvidenceSubmitted(args: {
    id: string;
    adminId?: string;
    notes?: string | null;
  }) {
    const res = await this.prisma.chargeback.updateMany({
      where: {
        id: args.id,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
        evidenceStatus: 'PENDING',
      },
      data: {
        evidenceStatus: 'SUBMITTED',
        evidenceSubmittedAt: new Date(),
        evidenceSubmittedBy: args.adminId ?? null,
        evidenceNotes: args.notes ?? null,
      },
    });
    if (res.count === 0) {
      const cb = await this.prisma.chargeback.findUnique({ where: { id: args.id } });
      if (!cb) throw new NotFoundAppException('Chargeback not found');
      return { updated: false, chargeback: cb };
    }
    const cb = await this.prisma.chargeback.findUnique({ where: { id: args.id } });
    return { updated: true, chargeback: cb };
  }
}
