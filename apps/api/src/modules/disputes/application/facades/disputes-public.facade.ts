import { Injectable } from '@nestjs/common';
import type { Dispute, DisputeActorType } from '@prisma/client';
import {
  DisputeService,
  PromoteFromTicketArgs,
} from '../services/dispute.service';

/**
 * Public facade for the Disputes module. Other modules call this
 * instead of importing DisputeService directly so the surface stays
 * minimal and intentional.
 */
@Injectable()
export class DisputesPublicFacade {
  constructor(private readonly disputeService: DisputeService) {}

  /**
   * Promote a support ticket to a dispute. Used by the support
   * module's admin endpoint when a ticket needs the formal
   * resolution track. Customer is unaware — they keep talking on the
   * ticket; admin handles the dispute; mirroring keeps both sides
   * synced.
   */
  async promoteFromTicket(args: PromoteFromTicketArgs): Promise<Dispute> {
    return this.disputeService.promoteFromTicket(args);
  }

  /**
   * Append a customer reply (originally posted on a ticket) to the
   * linked dispute thread. Silently no-ops if the dispute is already
   * resolved/closed — the ticket reply still succeeds independently.
   * Idempotent on `sourceTicketMessageId`.
   */
  async mirrorTicketMessageToDispute(args: {
    disputeId: string;
    sender: { type: DisputeActorType; id: string; name: string };
    body: string;
    sourceTicketMessageId: string;
  }): Promise<void> {
    return this.disputeService.mirrorTicketMessageToDispute(args);
  }

  /**
   * Phase 171 (Refund Approve/Reject audit #1) — re-open a decided dispute when
   * finance rejects its refund. Consumed by the disputes module's own
   * refund-rejected event handler (the refund-instructions module can't import
   * DisputesModule — that's the circular-dep direction — so the routing is
   * event-driven, and this is the facade the handler calls).
   */
  async routeBackFromFinanceRejection(args: {
    disputeId: string;
    adminId: string;
    reason: string;
    rerouteSlaHours?: number;
  }): Promise<{ reopened: boolean }> {
    return this.disputeService.routeBackFromFinanceRejection(args);
  }
}
