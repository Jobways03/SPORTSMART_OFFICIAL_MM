import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

/**
 * Phase 79 (2026-05-22) — reassignment history audit Gap #18.
 *
 * Pre-Phase-79 admin reassignments were captured ONLY in the
 * `order_reassignment_logs` domain table. Cross-cutting audit
 * queries like "show every admin override action on order X in
 * the last 30 days" had to special-case reassignments by JOINing
 * to that domain table — and an analyst pulling a single
 * `admin_action_audit_logs` extract for compliance review missed
 * reassignments entirely.
 *
 * This handler subscribes to `orders.sub_order.reassigned` and
 * mirrors the event into `admin_action_audit_logs` so the
 * cross-cutting "all admin actions" report includes reassignments.
 * Only writes when `reassignedBy` is set — auto-cascade
 * reassignments (system actor) stay out of the admin-action log
 * because they aren't admin actions.
 *
 * Mirrors the contract that `AdminActionAuditHandler` uses for
 * the `admin.action.**` namespace: same row shape, same dedup
 * semantics (best-effort; a failure here is logged but doesn't
 * roll back the source action which has already committed).
 */
@Injectable()
export class OrderReassignmentAuditHandler {
  private readonly logger = new Logger(OrderReassignmentAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('orders.sub_order.reassigned')
  async handle(event: DomainEvent): Promise<void> {
    const payload = (event.payload ?? {}) as {
      subOrderId?: string;
      masterOrderId?: string;
      orderNumber?: string;
      fromNodeType?: string;
      fromNodeId?: string | null;
      toNodeType?: string;
      toNodeId?: string;
      reason?: string;
      reassignedBy?: string | null;
      reassignmentSequence?: number;
      force?: boolean;
    };
    // System-actor cascades (auto-reassign after seller/franchise
    // rejection) skip the admin-action mirror — they aren't admin
    // actions and we don't want to drown the dashboard in machine
    // events.
    if (!payload.reassignedBy) return;
    try {
      await this.prisma.adminActionAuditLog.create({
        data: {
          adminId: payload.reassignedBy,
          actionType: event.eventName,
          sellerId:
            payload.fromNodeType === 'SELLER' ? payload.fromNodeId ?? null : null,
          reason: payload.reason ?? null,
          metadata: payload as any,
        },
      });
      this.logger.log(
        `Admin reassignment audit row written for order ${payload.masterOrderId} (sub-order ${payload.subOrderId})`,
      );
    } catch (err) {
      // Best-effort — the OrderReassignmentLog is the source of truth.
      // A failure here only loses the cross-cutting mirror, not the
      // primary audit trail.
      this.logger.error(
        `Failed to mirror reassignment event to admin_action_audit_logs: ${
          (err as Error).message
        }`,
      );
    }
  }
}
