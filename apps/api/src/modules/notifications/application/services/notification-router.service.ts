import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { EmailNotificationProvider } from '../../infrastructure/providers/email.provider';
import { SmsNotificationProvider } from '../../infrastructure/providers/sms.provider';
import { WhatsAppNotificationProvider } from '../../infrastructure/providers/whatsapp.provider';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../ports/notification-provider.port';

/**
 * Channel → provider lookup. Centralises the only place the system
 * needs to know which adapter handles which channel; lets us add new
 * channels (push, in-app) by wiring one more provider here.
 */
@Injectable()
export class NotificationRouter {
  private readonly logger = new Logger(NotificationRouter.name);
  private readonly providers: Map<NotificationChannel, INotificationProvider>;

  constructor(
    email: EmailNotificationProvider,
    sms: SmsNotificationProvider,
    whatsapp: WhatsAppNotificationProvider,
  ) {
    this.providers = new Map<NotificationChannel, INotificationProvider>([
      [email.channel, email],
      [sms.channel, sms],
      [whatsapp.channel, whatsapp],
    ]);
  }

  async dispatch(channel: NotificationChannel, args: SendArgs): Promise<SendResult> {
    const provider = this.providers.get(channel);
    if (!provider) {
      const msg = `No provider registered for channel ${channel}`;
      this.logger.error(msg);
      return { success: false, failureReason: msg, retryable: false };
    }
    return provider.send(args);
  }
}
