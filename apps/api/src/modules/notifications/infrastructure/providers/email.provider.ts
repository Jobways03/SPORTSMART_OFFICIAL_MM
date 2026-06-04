import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { EmailService } from '../../../../integrations/email/email.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';

@Injectable()
export class EmailNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'EMAIL';
  private readonly logger = new Logger(EmailNotificationProvider.name);

  // EnvService is @Global() — no module import needed.
  constructor(
    private readonly emailService: EmailService,
    private readonly env: EnvService,
  ) {}

  /**
   * Mirror of EmailService's own configured-check (constructor): SMTP is
   * considered configured only when both MAIL_USER and MAIL_PASS are set.
   * When unset, EmailService never builds a transporter and `send()` only
   * logs the message to the console (the "dev-mail" path).
   */
  private smtpConfigured(): boolean {
    return (
      this.env.getString('MAIL_USER', '').length > 0 &&
      this.env.getString('MAIL_PASS', '').length > 0
    );
  }

  async send(args: SendArgs): Promise<SendResult> {
    if (!args.to || !args.to.includes('@')) {
      return {
        success: false,
        failureReason: `Invalid email address: ${args.to}`,
        retryable: false,
        failureCode: 'INVALID_EMAIL',
        provider: 'smtp',
      };
    }

    const configured = this.smtpConfigured();

    // Cluster-D fix — fake-success guard. When SMTP is unconfigured the
    // underlying EmailService just console-logs and returns false. Reporting
    // success:true/'dev-mail' in PRODUCTION silently swallows every customer
    // email (OTP, refund credited, order updates) while the dashboard shows
    // them SENT. In production this is a HARD FAIL; the dev-mail soft-success
    // is kept only for non-production. (Ideal: an assertProductionSecretsSafe-
    // style boot assertion on MAIL_USER/MAIL_PASS — surfaced as a follow-up.)
    if (!configured && this.env.isProduction()) {
      const reason =
        'Email not sent: SMTP is not configured (MAIL_USER/MAIL_PASS unset) ' +
        'in production. Configure SMTP credentials before sending.';
      this.logger.error(reason);
      return {
        success: false,
        failureReason: reason,
        retryable: false,
        failureCode: 'NOT_CONFIGURED',
        provider: 'smtp',
      };
    }

    try {
      const ok = await this.emailService.send({
        to: args.to,
        subject: args.subject ?? args.templateKey ?? '(no subject)',
        html: args.body,
      });
      if (ok) {
        return { success: true, providerMessageId: 'smtp-ok', provider: 'smtp' };
      }
      // ok === false. Two cases:
      if (!configured) {
        // Non-production + unconfigured: the message was console-logged.
        // Keep the dev soft-success so local/test flows aren't blocked.
        return { success: true, providerMessageId: 'dev-mail', provider: 'smtp' };
      }
      // Configured but the send still failed (EmailService caught a thrown
      // SMTP error and returned false). This is a REAL transient failure, not
      // a dev no-op — retry rather than report a fake success.
      const reason = `SMTP send failed for ${args.to} (transport returned false)`;
      this.logger.warn(reason);
      return {
        success: false,
        failureReason: reason,
        retryable: true,
        failureCode: 'PROVIDER_ERROR',
        provider: 'smtp',
      };
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown email error';
      // Most SMTP failures are transient (timeout, throttle, 421 try later).
      // 5xx with "550 mailbox not found" is hard-fail; we can't tell here
      // without parsing the error code, so default to retryable.
      this.logger.warn(`Email send failed for ${args.to}: ${msg}`);
      return { success: false, failureReason: msg, retryable: true, provider: 'smtp' };
    }
  }
}
