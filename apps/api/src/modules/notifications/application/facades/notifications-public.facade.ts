import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsPublicFacade {
  async sendNotification(params: {
    recipientId: string;
    channel: string;
    templateKey: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendTemplatedCommunication(templateId: string, recipientId: string, variables: Record<string, unknown>): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendOperationalReminder(params: unknown): Promise<void> {
    throw new Error('Not implemented');
  }
}
