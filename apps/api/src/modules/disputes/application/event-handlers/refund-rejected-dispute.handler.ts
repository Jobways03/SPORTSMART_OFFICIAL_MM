import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DisputesPublicFacade } from '../facades/disputes-public.facade';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';

/**
 * Phase 171 (Refund Approve/Reject audit #1/#10/#11) — when finance REJECTS a
 * dispute-sourced refund, the case must bounce back to the dispute team for
 * re-decision (the headline spec rule). This is event-driven because
 * DisputesModule imports RefundInstructionsModule (so refund-instructions can't
 * import disputes back — circular). The refund reject emits
 * `refunds.instruction.rejected`; this handler (in the disputes module) reopens
 * the dispute + enqueues a re-decision admin task.
 *
 * Idempotent: routeBackFromFinanceRejection no-ops if the dispute is no longer
 * in a resolved state, and the admin task enqueue dedups on
 * (kind, sourceType, sourceId).
 */
@Injectable()
export class RefundRejectedDisputeHandler {
  private readonly logger = new Logger(RefundRejectedDisputeHandler.name);

  constructor(
    private readonly disputes: DisputesPublicFacade,
    private readonly ledger: LiabilityLedgerPublicFacade,
    // Phase 171 review (#3) — outbox-replay dedup so a re-published
    // refunds.instruction.rejected event doesn't re-run the reopen + re-enqueue.
    // @IdempotentHandler resolves this via `this.eventDedup`; it gracefully
    // no-ops in unit tests that construct the handler without DI.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('refunds.instruction.rejected')
  @IdempotentHandler()
  async handle(
    evt: { payload?: Record<string, unknown> } & Record<string, unknown>,
  ): Promise<void> {
    const payload = (evt?.payload ?? evt) as Record<string, unknown>;
    const routedBack = payload['routedBackToDispute'] === true;
    const sourceType = String(payload['sourceType'] ?? '');
    const disputeId = (payload['disputeId'] ?? payload['sourceId']) as
      | string
      | undefined;
    const reason = String(payload['reason'] ?? 'Finance rejected the refund');
    const adminId = String(payload['actorId'] ?? payload['rejectedBy'] ?? 'finance');

    // Only dispute-sourced rejections route back.
    if (!routedBack || sourceType !== 'DISPUTE' || !disputeId) return;

    try {
      const { reopened } = await this.disputes.routeBackFromFinanceRejection({
        disputeId,
        adminId,
        reason,
      });
      // Open an ops task for the re-decision (deduped on kind+source).
      await this.ledger
        .enqueueAdminTask({
          kind: 'DISPUTE_REFUND_REJECTED_NEEDS_REDECISION',
          sourceType: 'DISPUTE',
          sourceId: disputeId,
          reason:
            `Finance rejected the refund for dispute ${disputeId}. ` +
            `The dispute needs re-decision. Reason: ${reason}`,
          slaHours: 48,
        })
        .catch(() => undefined);
      this.logger.log(
        `refunds.instruction.rejected → dispute ${disputeId} route-back reopened=${reopened}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to route dispute ${disputeId} back after finance rejection: ${(err as Error).message}`,
      );
    }
  }
}
