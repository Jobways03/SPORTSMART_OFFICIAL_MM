import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { DuplicateCaseException } from '../exceptions/duplicate-case.exception';

/**
 * Phase 1.5 — Business-duplicate prevention.
 *
 * Enforces the four duplicate rules from the redesign brief:
 *
 *   R1. One active return per orderItemId
 *   R2. One active dispute per returnId
 *   R3. One active dispute per (masterOrderId, kind)
 *   R4. One active support ticket per (relatedOrderId, categoryId)
 *       — admin can override with allowDuplicate=true
 *
 * "Active" definitions match the FSMs:
 *   - Return:  status NOT IN (CANCELLED, REJECTED, COMPLETED, REFUNDED)
 *   - Dispute: status NOT IN (CLOSED, RESOLVED_*)
 *   - Ticket:  status NOT IN (CLOSED) — RESOLVED is treated as still
 *              "active" because customers can re-open within the
 *              48-72h window in Phase 5.
 *
 * Behaviour at flag-OFF: every assert* method is a no-op. Service can
 * be wired into call sites without behaviour change; flip the flag in
 * staging once data quality is confirmed.
 *
 * Race semantics: this is a SELECT-then-throw check, so a tight race
 * between two concurrent creates can let two duplicates through. That
 * is acceptable for Phase 1 because:
 *   (a) the existing case-number sequences are still unique,
 *   (b) admin can cancel one of the two later,
 *   (c) the operationally important rejection path (90+% of attempts)
 *       happens human-paced and well outside the race window.
 *
 * If we later need stronger guarantees, the path is a deferrable
 * Postgres unique constraint on a denormalised "active_case_key"
 * column, or a pg_advisory_xact_lock keyed on the natural key. Both
 * are tracked in the runbook.
 */
@Injectable()
export class CaseDuplicateService {
  // Status sets used in the active-case predicates. Hard-coded so the
  // rule definitions are visible in this file rather than scattered;
  // if the FSMs change in Phase 5, update both here AND the runbook.
  private static readonly RETURN_INACTIVE_STATUSES = [
    'CANCELLED',
    'REJECTED',
    'COMPLETED',
    'REFUNDED',
  ] as const;
  private static readonly DISPUTE_INACTIVE_STATUSES = [
    'CLOSED',
    'RESOLVED_BUYER',
    'RESOLVED_SELLER',
    'RESOLVED_SPLIT',
  ] as const;
  private static readonly TICKET_INACTIVE_STATUSES = ['CLOSED'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('CaseDuplicateService');
  }

  // ─── R1 — return-per-orderItem ────────────────────────────────────

  /**
   * Throws if an active return already covers this orderItemId. The
   * caller (ReturnService) should call this BEFORE minting a return
   * number so we don't burn one on a rejected duplicate.
   */
  async assertNoActiveReturnForOrderItem(args: {
    orderItemId: string;
    actor: { type: string; id: string };
  }): Promise<void> {
    if (!this.enabled()) return;

    const existing = await this.prisma.returnItem.findFirst({
      where: {
        orderItemId: args.orderItemId,
        return: {
          status: {
            notIn: [...CaseDuplicateService.RETURN_INACTIVE_STATUSES] as never[],
          },
        },
      },
      select: { return: { select: { id: true, returnNumber: true } } },
    });

    if (existing?.return) {
      const reason = 'ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM';
      await this.recordDuplicate({
        attemptedSourceType: 'RETURN',
        attemptedNaturalKey: { orderItemId: args.orderItemId },
        duplicateOfSourceType: 'RETURN',
        duplicateOfSourceId: existing.return.id,
        reason,
        actor: args.actor,
      });
      throw new DuplicateCaseException(
        `An active return already exists for this item (${existing.return.returnNumber}). Cancel or wait for it to resolve before submitting a new one.`,
        existing.return.returnNumber,
        reason,
      );
    }
  }

  // ─── R2 — dispute-per-return ──────────────────────────────────────

  async assertNoActiveDisputeForReturn(args: {
    returnId: string;
    actor: { type: string; id: string };
  }): Promise<void> {
    if (!this.enabled()) return;

    const existing = await this.prisma.dispute.findFirst({
      where: {
        returnId: args.returnId,
        status: {
          notIn: [...CaseDuplicateService.DISPUTE_INACTIVE_STATUSES] as never[],
        },
      },
      select: { id: true, disputeNumber: true },
    });

    if (existing) {
      const reason = 'ACTIVE_DISPUTE_EXISTS_FOR_RETURN';
      await this.recordDuplicate({
        attemptedSourceType: 'DISPUTE',
        attemptedNaturalKey: { returnId: args.returnId },
        duplicateOfSourceType: 'DISPUTE',
        duplicateOfSourceId: existing.id,
        reason,
        actor: args.actor,
      });
      throw new DuplicateCaseException(
        `A dispute is already open for this return (${existing.disputeNumber}). Reply on the existing dispute instead of opening a new one.`,
        existing.disputeNumber,
        reason,
      );
    }
  }

  // ─── R3 — dispute-per-order-and-kind ─────────────────────────────

  async assertNoActiveDisputeForOrderAndKind(args: {
    masterOrderId: string;
    kind: string;
    actor: { type: string; id: string };
  }): Promise<void> {
    if (!this.enabled()) return;

    const existing = await this.prisma.dispute.findFirst({
      where: {
        masterOrderId: args.masterOrderId,
        kind: args.kind as never,
        status: {
          notIn: [...CaseDuplicateService.DISPUTE_INACTIVE_STATUSES] as never[],
        },
      },
      select: { id: true, disputeNumber: true },
    });

    if (existing) {
      const reason = 'ACTIVE_DISPUTE_EXISTS_FOR_ORDER_AND_KIND';
      await this.recordDuplicate({
        attemptedSourceType: 'DISPUTE',
        attemptedNaturalKey: {
          masterOrderId: args.masterOrderId,
          kind: args.kind,
        },
        duplicateOfSourceType: 'DISPUTE',
        duplicateOfSourceId: existing.id,
        reason,
        actor: args.actor,
      });
      throw new DuplicateCaseException(
        `An active "${args.kind}" dispute (${existing.disputeNumber}) already exists for this order. Use the existing thread.`,
        existing.disputeNumber,
        reason,
      );
    }
  }

  // ─── R4 — ticket-per-order-and-category ─────────────────────────

  /**
   * Tickets allow an admin override (`allowDuplicate=true`) — sometimes
   * the rule fires too aggressively (e.g. a customer escalates the
   * same complaint a month later, after the original was resolved but
   * not closed). Customer-side controllers should never set this.
   */
  async assertNoActiveTicketForOrderAndCategory(args: {
    relatedOrderId: string;
    categoryId: string | null | undefined;
    actor: { type: string; id: string };
    allowDuplicate?: boolean;
  }): Promise<void> {
    if (!this.enabled()) return;
    if (args.allowDuplicate) return;
    // No category → caller can't be deduped on this rule (rule is
    // "(orderId + categoryId)" so a missing categoryId opts out).
    if (!args.categoryId) return;

    const existing = await this.prisma.ticket.findFirst({
      where: {
        relatedOrderId: args.relatedOrderId,
        categoryId: args.categoryId,
        status: {
          notIn: [...CaseDuplicateService.TICKET_INACTIVE_STATUSES] as never[],
        },
      },
      select: { id: true, ticketNumber: true },
    });

    if (existing) {
      const reason = 'ACTIVE_TICKET_EXISTS_FOR_ORDER_AND_CATEGORY';
      await this.recordDuplicate({
        attemptedSourceType: 'TICKET',
        attemptedNaturalKey: {
          relatedOrderId: args.relatedOrderId,
          categoryId: args.categoryId,
        },
        duplicateOfSourceType: 'TICKET',
        duplicateOfSourceId: existing.id,
        reason,
        actor: args.actor,
      });
      throw new DuplicateCaseException(
        `A support ticket (${existing.ticketNumber}) is already open for this order in the same category. Reply on it instead of opening a new one.`,
        existing.ticketNumber,
        reason,
      );
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private enabled(): boolean {
    return this.env.getBoolean('CASE_DUPLICATE_PREVENTION_ENABLED', false);
  }

  /**
   * Persist the rejection. Best-effort: we never let an audit-write
   * failure prevent the user-visible 409 — the rejection has already
   * happened in-memory.
   */
  private async recordDuplicate(args: {
    attemptedSourceType: 'RETURN' | 'DISPUTE' | 'TICKET';
    attemptedNaturalKey: Record<string, unknown>;
    duplicateOfSourceType: 'RETURN' | 'DISPUTE' | 'TICKET';
    duplicateOfSourceId: string;
    reason: string;
    actor: { type: string; id: string };
  }): Promise<void> {
    try {
      await this.prisma.caseDuplicate.create({
        data: {
          attemptedSourceType: args.attemptedSourceType,
          attemptedNaturalKey:
            args.attemptedNaturalKey as Prisma.InputJsonValue,
          duplicateOfSourceType: args.duplicateOfSourceType,
          duplicateOfSourceId: args.duplicateOfSourceId,
          reason: args.reason,
          actorType: args.actor.type,
          actorId: args.actor.id,
        },
      });
    } catch (err) {
      this.logger.error(
        `case-duplicate audit write failed (rule=${args.reason}): ${
          (err as Error).message
        }`,
      );
    }
  }
}
