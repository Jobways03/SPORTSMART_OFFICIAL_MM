import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class WhatsAppClient implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppClient.name);
  private apiUrl: string = '';
  private apiToken: string = '';
  private phoneNumberId: string = '';

  onModuleInit() {
    this.apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0';
    this.apiToken = process.env.WHATSAPP_API_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!this.apiToken || !this.phoneNumberId) {
      this.logger.warn('WhatsApp credentials not configured — messaging will be skipped');
    }
  }

  get isConfigured(): boolean {
    return !!(this.apiToken && this.phoneNumberId);
  }

  /**
   * Send a text message to a phone number.
   */
  async sendTextMessage(to: string, body: string): Promise<{ messageId: string }> {
    if (!this.isConfigured) {
      this.logger.warn('WhatsApp not configured — message not sent');
      return { messageId: '' };
    }

    const res = await fetch(
      `${this.apiUrl}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    if (!res.ok) {
      const respBody = await res.text();
      throw new Error(`WhatsApp sendTextMessage failed (${res.status}): ${respBody}`);
    }

    const data = await res.json();
    return { messageId: data.messages?.[0]?.id || '' };
  }

  /**
   * Send a template message (pre-approved by Meta).
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    parameters: Array<{ type: string; text: string }>,
  ): Promise<{ messageId: string }> {
    if (!this.isConfigured) {
      this.logger.warn('WhatsApp not configured — template message not sent');
      return { messageId: '' };
    }

    const res = await fetch(
      `${this.apiUrl}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: 'body',
                parameters: parameters.map((p) => ({
                  type: p.type,
                  text: p.text,
                })),
              },
            ],
          },
        }),
      },
    );

    if (!res.ok) {
      const respBody = await res.text();
      throw new Error(`WhatsApp sendTemplateMessage failed (${res.status}): ${respBody}`);
    }

    const data = await res.json();
    return { messageId: data.messages?.[0]?.id || '' };
  }
}
