import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;

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
   * POST to the Meta Graph messages endpoint with a 30s timeout. The
   * notification handlers wrap their calls in try/catch already, but
   * without the timeout a hung connection to Meta could slow the
   * event-bus worker that dispatched the notification. Aligned with
   * the request-helper pattern we use for Razorpay and Shiprocket.
   */
  private async postMessage<T>(op: string, body: unknown): Promise<T> {
    const res = await fetch(
      `${this.apiUrl}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const respBody = await res.text();
      throw new Error(`WhatsApp ${op} failed (${res.status}): ${respBody}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Send a text message to a phone number.
   */
  async sendTextMessage(to: string, body: string): Promise<{ messageId: string }> {
    if (!this.isConfigured) {
      this.logger.warn('WhatsApp not configured — message not sent');
      return { messageId: '' };
    }

    const data = await this.postMessage<{
      messages?: Array<{ id: string }>;
    }>('sendTextMessage', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
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

    const data = await this.postMessage<{
      messages?: Array<{ id: string }>;
    }>('sendTemplateMessage', {
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
    });
    return { messageId: data.messages?.[0]?.id || '' };
  }
}
