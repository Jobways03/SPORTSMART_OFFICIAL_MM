import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AuditChainAnchorService } from '../services/audit-chain-anchor.service';

/**
 * Phase 8 (PR 8.1) — Periodic Merkle anchor pin.
 *
 * Runs hourly, takes one anchor of the current head of the audit
 * chain. Idempotent — when nothing's been added since the last
 * anchor, returns `pinned: false` and exits.
 *
 * Cadence: hourly is dense enough that the verifier's "walk forward
 * from the latest anchor" stays under 5 minutes worth of audit rows
 * even at peak traffic, and sparse enough that the
 * audit_chain_anchors table doesn't blow up.
 */
@Injectable()
export class AuditChainAnchorCron {
  private readonly logger = new Logger(AuditChainAnchorCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly anchor: AuditChainAnchorService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('AUDIT_CHAIN_ANCHOR_ENABLED', false);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    try {
      const result = await this.anchor.pinNext();
      if (result.pinned) {
        this.logger.log(
          `audit-chain-anchor: pinned sequence=${result.sequence} covering ${result.rowsCovered} new rows`,
        );
      }
    } catch (err) {
      this.logger.error(
        `audit-chain-anchor pin failed: ${(err as Error).message}`,
      );
    }
  }
}
