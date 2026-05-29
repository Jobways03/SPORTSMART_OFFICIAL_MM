import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { RiskScoringService } from '../services/risk-scoring.service';

/**
 * Phase 71 (2026-05-22) — Phase 70 risk-scoring audit Gap #3.
 *
 * Pre-Phase-71 the only triggers for `RiskScoringService.scoreOrder`
 * were lazy — at first claim-next, or at first detail-view of the
 * verifier UI. Orders placed but never claimed never got scored;
 * the bulk-approve-green sweep (which filters on
 * `verification_risk_band = 'GREEN'`) silently returned empty
 * because most orders had a null band.
 *
 * The handler subscribes to `orders.master.created` and runs
 * `scoreOrder` best-effort. A scoring failure is logged but does
 * NOT bubble up (the order's already committed; the recovery
 * cron + the lazy fallback paths re-score on next interaction).
 *
 * Audit-Gap #18 is also addressed: orders flow through here so
 * the first deployment of a wired risk-scoring system doesn't
 * need a manual backfill — every NEW order is scored at
 * placement, while `backfillUnscored` handles the legacy tail.
 */
@Injectable()
export class OrderRiskScoringHandler {
  private readonly logger = new Logger(OrderRiskScoringHandler.name);

  constructor(private readonly riskScoring: RiskScoringService) {}

  @OnEvent('orders.master.created')
  async handleOrderCreated(event: DomainEvent): Promise<void> {
    const orderId = event.aggregateId;
    if (!orderId) {
      this.logger.warn(
        'orders.master.created event without aggregateId — skipping risk score',
      );
      return;
    }
    try {
      const result = await this.riskScoring.scoreOrder(orderId);
      this.logger.log(
        `Risk scored at placement: order ${orderId} → ${result.band} (${result.score})`,
      );
    } catch (err) {
      // Best-effort: a scoring failure must NEVER bubble up and
      // affect the customer's order placement response. The lazy
      // fallback paths (claim-next ensureScored, getRiskInfo) will
      // re-attempt on next interaction; the backfill endpoint can
      // sweep stragglers.
      this.logger.error(
        `Risk scoring failed at placement for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }
}
