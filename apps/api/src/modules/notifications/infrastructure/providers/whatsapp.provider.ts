import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';

/**
 * Stub WhatsApp provider. Logs to console + reports success. Replace
 * with the WhatsApp Business Cloud API adapter once the WABA account
 * is provisioned (env: `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN`).
 */
@Injectable()
export class WhatsAppNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'WHATSAPP';
  private readonly logger = new Logger(WhatsAppNotificationProvider.name);

  async send(args: SendArgs): Promise<SendResult> {
    const phone = args.to.replace(/\D/g, '');
    if (phone.length < 10) {
      return {
        success: false,
        failureReason: `Invalid WhatsApp number: ${args.to}`,
        retryable: false,
      };
    }
    this.logger.log(
      `[STUB-WHATSAPP] +${phone} | ${args.templateKey ?? '(no template)'} | ${args.body.slice(0, 80)}…`,
    );
    return { success: true, providerMessageId: `stub-wa-${Date.now()}` };
  }
}
