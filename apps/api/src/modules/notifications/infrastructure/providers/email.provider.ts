import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { EmailService } from '../../../../integrations/email/email.service';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';

@Injectable()
export class EmailNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'EMAIL';
  private readonly logger = new Logger(EmailNotificationProvider.name);

  constructor(private readonly emailService: EmailService) {}

  async send(args: SendArgs): Promise<SendResult> {
    if (!args.to || !args.to.includes('@')) {
      return {
        success: false,
        failureReason: `Invalid email address: ${args.to}`,
        retryable: false,
      };
    }

    try {
      const ok = await this.emailService.send({
        to: args.to,
        subject: args.subject ?? args.templateKey ?? '(no subject)',
        html: args.body,
      });
      if (!ok) {
        // EmailService returns false when SMTP isn't configured (dev mode).
        // Treat as a soft success — the message is logged to console.
        return { success: true, providerMessageId: 'dev-mail' };
      }
      return { success: true, providerMessageId: 'smtp-ok' };
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown email error';
      // Most SMTP failures are transient (timeout, throttle, 421 try later).
      // 5xx with "550 mailbox not found" is hard-fail; we can't tell here
      // without parsing the error code, so default to retryable.
      this.logger.warn(`Email send failed for ${args.to}: ${msg}`);
      return { success: false, failureReason: msg, retryable: true };
    }
  }
}
