import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AuditChainAnchorService } from '../services/audit-chain-anchor.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';

/**
 * Phase 203 (#9) / 204 (#7) — autonomous chain-break detector.
 *
 * Runs every 15 minutes, leader-elected (one replica), instrumented. Walks
 * forward from the latest anchor and persists a verification run. Any break
 * causes `AuditChainAnchorService.finishRun` to emit
 * `audit.chain.break_detected` — consumed by AuditChainBreakHandler, which
 * raises an admin alert (and which surfaces the SIEM/PagerDuty transport as a
 * follow-up; see notes). Without this, tampering is only ever caught when an
 * admin happens to click "Verify chain" in the UI.
 *
 * Env: AUDIT_CHAIN_VERIFY_ENABLED (default true). Read-only over the audit
 * log + a single run row per tick, so default-on is safe.
 */
@Injectable()
export class AuditChainVerifyCron {
  private readonly logger = new Logger(AuditChainVerifyCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly anchor: AuditChainAnchorService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('AUDIT_CHAIN_VERIFY_ENABLED', true);
  }

  limit(): number {
    const n = this.env.getNumber('AUDIT_CHAIN_VERIFY_LIMIT', 20_000);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20_000;
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('audit-chain-verify', 20 * 60, async () => {
      try {
        await this.instr.wrap('audit-chain-verify', async () => {
          // startedBy omitted → run is attributed to the system (actorType
          // SYSTEM at the self-audit boundary).
          const result = await this.anchor.verifyFromLatestAnchor(this.limit());
          if (result.breaks.length > 0) {
            this.logger.error(
              `audit-chain-verify: ${result.breaks.length} break(s) in run ${result.runId}`,
            );
          }
          return {
            runId: result.runId,
            rowsChecked: result.rowsChecked,
            issuesFound: result.breaks.length,
          };
        });
      } catch (err) {
        this.logger.error(`audit-chain-verify failed: ${(err as Error).message}`);
      }
    });
  }
}
