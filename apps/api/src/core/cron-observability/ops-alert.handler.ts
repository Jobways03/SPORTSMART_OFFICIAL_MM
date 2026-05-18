import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EnvService } from '../../bootstrap/env/env.service';
import { EmailService } from '../../integrations/email/email.service';
import { safeHtml } from '../util/escape-html';
import type { DomainEvent } from '../../bootstrap/events/domain-event.interface';

/**
 * Phase 10 (2026-05-16) — Ops alert escalation.
 *
 * The global `@OnEvent('**')` audit logger already catches every
 * published event for the audit trail. That covers forensics — "did
 * this happen?" — but it doesn't wake anyone up when an invariant
 * breaks. This handler subscribes to the small set of events that
 * SHOULD page the platform team and emails them to
 * `ADMIN_ESCALATION_EMAIL` (or the fallback in the same env block).
 *
 * Events covered:
 *   • `cron.silent`              — heartbeat cron flagged a job past
 *                                  its silence tolerance.
 *   • `accounts.imbalance_detected` — double-entry validator caught a
 *                                  ledger imbalance. Hard money bug.
 *   • `http.error_rate.elevated` — rolling 5xx rate breached the
 *                                  configured threshold.
 *   • `file.integrity.violation` — file integrity verifier found a
 *                                  hash mismatch or missing file.
 *   • `payments.saga.stuck_auto_escalated` — refund saga past its
 *                                  retry budget.
 *
 * Throttling: each event has a per-minute floor so a spike doesn't
 * mail-bomb the inbox. Cooldowns are in-memory — fine for a
 * notification, not for state. Restart resets the cooldown which is
 * intentional: a process restart is a signal worth re-alerting on.
 */
@Injectable()
export class OpsAlertHandler {
  private readonly logger = new Logger(OpsAlertHandler.name);

  /** Per-event-name minimum interval between escalation emails (ms). */
  private static readonly COOLDOWN_MS = 5 * 60 * 1000;
  private readonly lastSentAt = new Map<string, number>();

  constructor(
    private readonly env: EnvService,
    private readonly email: EmailService,
  ) {}

  @OnEvent('cron.silent')
  async onCronSilent(event: DomainEvent): Promise<void> {
    await this.escalate(event, 'Cron job is silent past tolerance');
  }

  @OnEvent('accounts.imbalance_detected')
  async onLedgerImbalance(event: DomainEvent): Promise<void> {
    await this.escalate(event, 'Ledger imbalance detected');
  }

  @OnEvent('http.error_rate.elevated')
  async onHttpErrorRate(event: DomainEvent): Promise<void> {
    await this.escalate(event, 'HTTP error rate elevated');
  }

  @OnEvent('file.integrity.violation')
  async onFileIntegrity(event: DomainEvent): Promise<void> {
    await this.escalate(event, 'File integrity violation');
  }

  @OnEvent('payments.saga.stuck_auto_escalated')
  async onStuckSaga(event: DomainEvent): Promise<void> {
    await this.escalate(event, 'Payments saga stuck — auto-escalated');
  }

  @OnEvent('ops.stuck_job_detected')
  async onStuckJobCohort(event: DomainEvent): Promise<void> {
    // Cooldown key is per-event-name, so all cohorts share one
    // throttle window. That's intentional — if the PDF cohort and
    // the e-invoice cohort are both stuck, one email covers it.
    const cohort = (event.payload as { cohort?: string } | null)?.cohort ?? 'unknown';
    await this.escalate(event, `Stuck job cohort: ${cohort}`);
  }

  @OnEvent('webhook.dlq_growing')
  async onWebhookDlqGrowing(event: DomainEvent): Promise<void> {
    const endpoint =
      (event.payload as { endpointId?: string } | null)?.endpointId ?? 'unknown';
    await this.escalate(event, `Webhook DLQ growing on endpoint ${endpoint}`);
  }

  // ── Internal ───────────────────────────────────────────────────

  private resolveRecipient(): string | null {
    const explicit = this.env.getString('ADMIN_ESCALATION_EMAIL', '');
    if (explicit && explicit.includes('@')) return explicit;
    // No fallback inbox — the audit log still has the row, and we'd
    // rather log a warning than silently mail an unrelated address.
    return null;
  }

  private async escalate(event: DomainEvent, title: string): Promise<void> {
    const key = event.eventName;
    const now = Date.now();
    const last = this.lastSentAt.get(key) ?? 0;
    if (now - last < OpsAlertHandler.COOLDOWN_MS) {
      // Audit log already captured this — we just suppress the email
      // to avoid mail-bombing during a spike. Cooldown is per event
      // name so a `cron.silent` storm doesn't suppress a concurrent
      // ledger imbalance.
      return;
    }
    this.lastSentAt.set(key, now);

    const recipient = this.resolveRecipient();
    if (!recipient) {
      this.logger.warn(
        `Ops alert "${title}" fired but ADMIN_ESCALATION_EMAIL is not configured — skipping email`,
      );
      return;
    }

    try {
      const payloadJson = JSON.stringify(event.payload ?? {}, null, 2);
      await this.email.send({
        to: recipient,
        subject: `[SPORTSMART OPS ALERT] ${title}`,
        html: safeHtml`
          <h2>${title}</h2>
          <p>Event <strong>${event.eventName}</strong> fired at
             <strong>${new Date(event.occurredAt ?? new Date()).toISOString()}</strong>.</p>
          <p>Aggregate: <code>${event.aggregate}</code> / <code>${event.aggregateId}</code></p>
          <h3>Payload</h3>
          <pre style="background:#f3f4f6;padding:12px;border-radius:6px;white-space:pre-wrap;">${payloadJson}</pre>
          <p style="color:#6b7280;font-size:13px;">
            Cooldown: re-alerts for this event suppressed for the next
            ${Math.round(OpsAlertHandler.COOLDOWN_MS / 60_000)} minutes.
            See the domain_event_log table for the full audit trail.
          </p>
        `,
      });
      this.logger.warn(`Ops alert emailed to ${recipient}: ${title}`);
    } catch (err) {
      // Email failure must NOT crash the source handler — the audit
      // row already exists and operators can find the event there.
      this.logger.error(
        `Failed to email ops alert (${event.eventName}): ${(err as Error).message}`,
      );
    }
  }
}
