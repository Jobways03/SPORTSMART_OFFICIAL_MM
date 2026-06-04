import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../facades/audit-public.facade';
import { AUDIT_SELF_ACTIONS } from '../services/audit-event-types';

interface ChainBreakPayload {
  runId: string;
  runType: string;
  issuesFound: number;
  byType: Record<string, number>;
  firstBreaks?: Array<{ id: string | null; issueType: string; severity: string; reason: string }>;
}

/**
 * Phase 203 (#9) / 204 (#7) — chain-break alert consumer.
 *
 * Fires when the verifier (cron or admin button) detects tampering. Today it:
 *   • logs at ERROR (so it lands in the platform log aggregator), and
 *   • writes a SYSTEM-actor audit row recording the break, so the breach is
 *     itself part of the immutable trail and shows up in the audit viewer.
 *
 * SURFACED (HONEST-CALL): the external page-out — PagerDuty / SIEM / Slack —
 * is not buildable offline. The seam is here (one well-typed event with the
 * break summary); wire a transport handler in the notifications/ops module to
 * forward it. A durable in-DB backstop already exists three ways: the
 * AuditChainVerificationRun row, the EventLog row (DomainEventLogHandler
 * persists every event), and this audit row.
 *
 * Note we do NOT raise an AdminTask row directly: AdminTaskKind is a closed
 * enum owned by the liability-ledger module and has no audit-integrity value;
 * adding one is surfaced for the central reconcile rather than reaching across
 * module ownership here.
 */
@Injectable()
export class AuditChainBreakHandler {
  private readonly logger = new Logger(AuditChainBreakHandler.name);

  constructor(private readonly audit: AuditPublicFacade) {}

  @OnEvent(AUDIT_SELF_ACTIONS.CHAIN_BREAK_DETECTED)
  async onBreak(event: DomainEvent<ChainBreakPayload>): Promise<void> {
    const p = event.payload;
    this.logger.error(
      `AUDIT CHAIN BREAK DETECTED — run ${p.runId} (${p.runType}): ` +
        `${p.issuesFound} issue(s) ${JSON.stringify(p.byType)}`,
    );
    try {
      await this.audit.writeAuditLog({
        actorType: 'SYSTEM',
        action: AUDIT_SELF_ACTIONS.CHAIN_BREAK_DETECTED,
        module: 'audit',
        resource: 'AuditChainVerificationRun',
        resourceId: p.runId,
        metadata: {
          runType: p.runType,
          issuesFound: p.issuesFound,
          byType: p.byType,
          firstBreaks: p.firstBreaks ?? [],
        },
      });
    } catch (err) {
      // Never let the alert path throw — the run + EventLog already persisted.
      this.logger.error(`failed to write chain-break audit row: ${(err as Error).message}`);
    }
  }
}
