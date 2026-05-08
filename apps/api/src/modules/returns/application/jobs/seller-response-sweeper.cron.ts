import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { ReturnService } from '../services/return.service';

/**
 * Phase 13 (P1.8) — seller-response-window sweeper.
 *
 * Every 5 minutes, flips returns with sellerResponseStatus=PENDING
 * whose sellerResponseDueAt has elapsed to EXPIRED. The QC step then
 * defaults to seller liability when the admin confirms — same as if
 * the seller had ACCEPTED, but the audit trail records that the
 * window expired without a response.
 *
 * Wrapped with CronInstrumentationService so each run produces a
 * cron_runs row (jobName + duration + status + processedCount). Flag-
 * gated on RETURN_SELLER_RESPONSE_SWEEPER_ENABLED so it can be turned
 * off in dev without forcing every developer to keep wall-clock returns
 * fresh.
 */
@Injectable()
export class SellerResponseSweeperCron {
  private readonly logger = new Logger(SellerResponseSweeperCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly instrumentation: CronInstrumentationService,
    private readonly returns: ReturnService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean(
      'RETURN_SELLER_RESPONSE_SWEEPER_ENABLED' as any,
      true,
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.instrumentation.wrap(
      'returns.seller_response_sweeper',
      async () => {
        const result = await this.returns.sweepExpiredSellerResponses();
        if (result.expiredCount > 0) {
          this.logger.log(
            `Seller-response sweeper expired ${result.expiredCount} return(s)`,
          );
        }
        return result;
      },
    );
  }
}
