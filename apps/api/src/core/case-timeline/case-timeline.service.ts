import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../exceptions';

/**
 * Phase 9 (PR 9.3) — Unified case timeline.
 *
 * Pulls events from across the involved tables and renders them as a
 * single chronological feed. Used by both the customer "what's
 * happening with my case?" UI and the admin "case detail" page; the
 * difference is which fields appear (admin sees internal notes,
 * customer doesn't).
 *
 * Sources joined:
 *   Return: status_history + linked dispute messages + refund txns
 *   Dispute: messages (filter internal-notes for non-admin viewers)
 *            + status changes (derived from updated_at + decision_at)
 *   Ticket: messages (same internal-note filter)
 *
 * Result shape: { kind, at, summary, actor?, payload? } per row.
 * Caller renders this against the i18n catalogue using the `kind`
 * as the message key.
 */

export type CaseKind = 'return' | 'dispute' | 'ticket';
export type ViewerKind = 'CUSTOMER' | 'ADMIN' | 'SELLER';

export interface TimelineEvent {
  kind: string;
  at: Date;
  summary: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

export interface TimelineInput {
  caseKind: CaseKind;
  caseId: string;
  viewerKind: ViewerKind;
  viewerId: string;
}

@Injectable()
export class CaseTimelineService {
  private readonly logger = new Logger(CaseTimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(input: TimelineInput): Promise<TimelineEvent[]> {
    switch (input.caseKind) {
      case 'return':
        return this.returnTimeline(input);
      case 'dispute':
        return this.disputeTimeline(input);
      case 'ticket':
        return this.ticketTimeline(input);
    }
  }

  // ── Return timeline ───────────────────────────────────────────

  private async returnTimeline(input: TimelineInput): Promise<TimelineEvent[]> {
    const ret = await this.prisma.return.findUnique({
      where: { id: input.caseId },
      select: { id: true, customerId: true, returnNumber: true, createdAt: true },
    });
    if (!ret) throw new NotFoundAppException('Return not found');
    this.assertViewerAccess(input, { customerId: ret.customerId });

    const [history, refundTxns] = await Promise.all([
      this.prisma.returnStatusHistory.findMany({
        where: { returnId: ret.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.refundTransaction.findMany({
        where: { returnId: ret.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const events: TimelineEvent[] = [];
    events.push({
      kind: 'returns.timeline.requested',
      at: ret.createdAt,
      summary: `Return ${ret.returnNumber} opened`,
    });
    for (const h of history) {
      events.push({
        kind: `returns.timeline.${(h.toStatus as string).toLowerCase()}`,
        at: h.createdAt,
        summary: `Status changed to ${h.toStatus}`,
        actor: h.changedBy ?? undefined,
        payload: this.redact(input.viewerKind, {
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          notes: h.notes,
        }),
      });
    }
    for (const tx of refundTxns) {
      events.push({
        kind: `returns.timeline.refund_${(tx.status as string).toLowerCase()}`,
        at: tx.createdAt,
        summary: `Refund ${tx.status}`,
        payload: this.redact(input.viewerKind, {
          gatewayRefundId: tx.gatewayRefundId,
          attemptNumber: tx.attemptNumber,
          failureReason: tx.failureReason,
        }),
      });
    }
    return sortEvents(events);
  }

  // ── Dispute timeline ──────────────────────────────────────────

  private async disputeTimeline(
    input: TimelineInput,
  ): Promise<TimelineEvent[]> {
    const d = await this.prisma.dispute.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        filedById: true,
        filedByType: true,
        disputeNumber: true,
        createdAt: true,
        decisionAt: true,
        status: true,
        decisionRationale: true,
      },
    });
    if (!d) throw new NotFoundAppException('Dispute not found');
    this.assertViewerAccess(input, {
      customerId: d.filedByType === 'CUSTOMER' ? d.filedById : null,
    });

    const messages = await this.prisma.disputeMessage.findMany({
      where: { disputeId: d.id },
      orderBy: { createdAt: 'asc' },
    });

    const events: TimelineEvent[] = [];
    events.push({
      kind: 'disputes.timeline.opened',
      at: d.createdAt,
      summary: `Dispute ${d.disputeNumber} opened`,
    });
    for (const m of messages) {
      const isInternal = (m as any).isInternalNote === true;
      if (isInternal && input.viewerKind !== 'ADMIN') continue;
      events.push({
        kind: isInternal
          ? 'disputes.timeline.internal_note'
          : 'disputes.timeline.message',
        at: m.createdAt,
        summary: 'Message added',
        actor: m.senderName,
        payload: this.redact(input.viewerKind, {
          senderType: m.senderType,
          body: m.body,
          isInternalNote: isInternal,
        }),
      });
    }
    if (d.decisionAt) {
      events.push({
        kind: `disputes.timeline.${(d.status as string).toLowerCase()}`,
        at: d.decisionAt,
        summary: `Decision: ${d.status}`,
        payload: this.redact(input.viewerKind, {
          rationale: d.decisionRationale,
        }),
      });
    }
    return sortEvents(events);
  }

  // ── Ticket timeline ──────────────────────────────────────────

  private async ticketTimeline(input: TimelineInput): Promise<TimelineEvent[]> {
    const t = await this.prisma.ticket.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        creatorId: true,
        creatorType: true,
        ticketNumber: true,
        createdAt: true,
        resolvedAt: true,
        closedAt: true,
        status: true,
      },
    });
    if (!t) throw new NotFoundAppException('Ticket not found');
    this.assertViewerAccess(input, {
      customerId: t.creatorType === 'CUSTOMER' ? t.creatorId : null,
    });

    const messages = await this.prisma.ticketMessage.findMany({
      where: { ticketId: t.id },
      orderBy: { createdAt: 'asc' },
    });

    const events: TimelineEvent[] = [];
    events.push({
      kind: 'support.timeline.opened',
      at: t.createdAt,
      summary: `Ticket ${t.ticketNumber} opened`,
    });
    for (const m of messages) {
      const isInternal = (m as any).isInternalNote === true;
      if (isInternal && input.viewerKind !== 'ADMIN') continue;
      events.push({
        kind: isInternal
          ? 'support.timeline.internal_note'
          : 'support.timeline.message',
        at: m.createdAt,
        summary: 'Reply',
        actor: m.senderName,
        payload: this.redact(input.viewerKind, {
          senderType: m.senderType,
          body: m.body,
          isInternalNote: isInternal,
        }),
      });
    }
    if (t.resolvedAt) {
      events.push({
        kind: 'support.timeline.resolved',
        at: t.resolvedAt,
        summary: 'Resolved',
      });
    }
    if (t.closedAt) {
      events.push({
        kind: 'support.timeline.closed',
        at: t.closedAt,
        summary: 'Closed',
      });
    }
    return sortEvents(events);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private assertViewerAccess(
    input: TimelineInput,
    case_: { customerId: string | null },
  ): void {
    if (input.viewerKind === 'ADMIN') return;
    if (input.viewerKind === 'CUSTOMER') {
      if (case_.customerId !== input.viewerId) {
        throw new ForbiddenAppException(
          'Cannot view timeline of a case not belonging to this customer',
        );
      }
      return;
    }
    // Seller / others: out of scope for the customer timeline today.
    throw new ForbiddenAppException(
      `Viewer kind ${input.viewerKind} not yet supported for case timeline`,
    );
  }

  /**
   * Internal-only payload fields stripped for every non-ADMIN viewer.
   * These carry gateway error codes, internal status-change notes, and the
   * admin's decision wording — none of which a customer/seller should read
   * off the timeline (the public signal is the status + conversation body).
   */
  private static readonly INTERNAL_PAYLOAD_FIELDS = [
    'gatewayRefundId',
    'failureReason',
    'notes',
    'rationale',
    'decisionRationale',
    'internalReason',
    'reviewNote',
    'gatewayResponse',
  ];

  private redact(
    viewerKind: ViewerKind,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (viewerKind === 'ADMIN') return payload;
    const out: Record<string, unknown> = { ...payload };
    for (const field of CaseTimelineService.INTERNAL_PAYLOAD_FIELDS) {
      delete out[field];
    }
    return out;
  }
}

function sortEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort((a, b) => a.at.getTime() - b.at.getTime());
}
