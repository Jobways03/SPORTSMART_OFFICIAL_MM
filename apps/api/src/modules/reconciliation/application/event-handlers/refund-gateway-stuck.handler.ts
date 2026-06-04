import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';

/**
 * Phase 167 (Refund Execution audit #10) — consumer for `refund.gateway.stuck`.
 *
 * The refund-gateway recon cron emits this when a refund instruction has been
 * PROCESSING for 24h+ and the gateway still reports it pending (or we can't
 * reach the gateway). Previously the event had NO subscriber, so a genuinely
 * stuck refund was surfaced to no one. This handler opens a high-severity
 * PaymentMismatchAlert (the admin payment-ops queue) + an audit row so finance
 * investigates the stuck refund instead of the customer discovering it.
 */
@Injectable()
export class RefundGatewayStuckHandler {
  private readonly logger = new Logger(RefundGatewayStuckHandler.name);

  constructor(
    private readonly paymentOps: PaymentOpsFacade,
    private readonly audit: AuditPublicFacade,
  ) {}

  @OnEvent('refund.gateway.stuck')
  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as {
      instructionId: string;
      customerId: string | null;
      gatewayRefundId: string | null;
      stuckSinceMs: number;
    };
    const stuckHours = Math.round((p.stuckSinceMs ?? 0) / 3_600_000);

    await this.paymentOps
      .flagMismatch({
        kind: 'ORPHAN_PAYMENT',
        providerPaymentId: p.gatewayRefundId,
        severity: 95,
        description:
          `[refund-recon] RefundInstruction ${p.instructionId} (refund ` +
          `${p.gatewayRefundId ?? 'n/a'}, customer ${p.customerId ?? 'n/a'}) has been ` +
          `PROCESSING for ~${stuckHours}h and the gateway still can't confirm it. ` +
          `Finance: reconcile with Razorpay (refund may be stuck or failed silently).`,
      })
      .catch((err) =>
        this.logger.error(
          `failed to open stuck-refund alert for ${p.instructionId}: ${(err as Error).message}`,
        ),
      );

    await this.audit
      .writeAuditLog({
        actorId: 'SYSTEM_REFUND_RECON',
        actorRole: 'SYSTEM',
        action: 'refund.gateway.stuck',
        module: 'reconciliation',
        resource: 'refund_instruction',
        resourceId: p.instructionId,
        metadata: {
          gatewayRefundId: p.gatewayRefundId,
          customerId: p.customerId,
          stuckHours,
        },
      })
      .catch(() => undefined);

    this.logger.warn(
      `[refund-recon] stuck-refund alert opened for instruction ${p.instructionId} (~${stuckHours}h)`,
    );
  }
}
