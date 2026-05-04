import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';

/**
 * Stub SMS provider. Logs to console + reports success so the queue
 * pipeline is exercised end-to-end. Swap with MSG91 / Twilio adapter
 * in a follow-up phase; the provider contract stays the same.
 */
@Injectable()
export class SmsNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'SMS';
  private readonly logger = new Logger(SmsNotificationProvider.name);

  async send(args: SendArgs): Promise<SendResult> {
    const phone = args.to.replace(/\D/g, '');
    if (phone.length < 10) {
      return {
        success: false,
        failureReason: `Invalid phone number: ${args.to}`,
        retryable: false,
      };
    }
    this.logger.log(
      `[STUB-SMS] +${phone} | ${args.templateKey ?? '(no template)'} | ${args.body.slice(0, 80)}…`,
    );
    return { success: true, providerMessageId: `stub-sms-${Date.now()}` };
  }
}
