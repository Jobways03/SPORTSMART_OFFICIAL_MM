import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AuditChainAnchorService } from '../services/audit-chain-anchor.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';

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
    // Phase 1 (PR 1.2) — N replicas pinning the same chain head
    // would double-write the anchor table.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.2) — cron-run observability. Each pin records
    // `{ pinned, sequence?, rowsCovered? }` in cron_runs.
    private readonly instr: CronInstrumentationService,
  ) {}

  enabled(): boolean {
    // Default flipped to true 2026-05-16. The anchor is read-only over
    // the audit log + writes a single pinned (sequence, hash) row per
    // hour — virtually zero overhead, but without it tamper-evidence
    // verification has no checkpoint to compare against.
    return this.env.getBoolean('AUDIT_CHAIN_ANCHOR_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    await this.leader.run('audit-chain-anchor', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('audit-chain-anchor', async () => {
          const result = await this.anchor.pinNext();
          if (result.pinned) {
            this.logger.log(
              `audit-chain-anchor: pinned sequence=${result.sequence} covering ${result.rowsCovered} new rows`,
            );
          }
          return result.pinned
            ? { pinned: true, sequence: result.sequence, rowsCovered: result.rowsCovered }
            : { pinned: false };
        });
      } catch (err) {
        this.logger.error(
          `audit-chain-anchor pin failed: ${(err as Error).message}`,
        );
      }
    });
  }
}
