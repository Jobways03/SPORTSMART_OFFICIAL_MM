import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Phase 4 (PR 4.5) — retry policy constants. Same shape as the
 * Razorpay PR 4.1 helper: max 3 attempts, full-jitter exponential
 * backoff capped at 5s. WhatsApp Business API doesn't expose an
 * idempotency-key header, so retries on writes can produce duplicate
 * customer-facing messages — that's the documented trade-off vs the
 * pre-PR silent-drop behaviour.
 */
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 5_000;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function jitteredBackoff(attempt: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
   * POST to the Meta Graph messages endpoint with a 30s per-attempt
   * timeout and the Phase 4 (PR 4.5) retry policy:
   *
   *   - 5xx, 429, network errors → retry (up to 3 attempts)
   *   - 4xx → fail fast (auth, malformed template, banned number)
   *   - timeout via AbortSignal → retry
   *
   * Full-jitter exponential backoff between attempts. Notification
   * handlers continue to swallow errors at their level — but for a
   * recoverable transient blip, the message now actually goes out.
   */
  private async postMessage<T>(op: string, body: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
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
          if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
            this.logger.warn(
              `WhatsApp ${op} attempt ${attempt}/${MAX_ATTEMPTS} got ${res.status}, retrying...`,
            );
            await sleep(jitteredBackoff(attempt));
            continue;
          }
          const respBody = await res.text();
          throw new Error(`WhatsApp ${op} failed (${res.status}): ${respBody}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // Synthesised "WhatsApp X failed (NNN)" error from the !res.ok
        // branch — status was already considered for retry inside the
        // loop, so propagate immediately.
        if (err instanceof Error && /WhatsApp .* failed \(\d+\)/.test(err.message)) {
          throw err;
        }
        if (isRetryableError(err) && attempt < MAX_ATTEMPTS) {
          this.logger.warn(
            `WhatsApp ${op} attempt ${attempt}/${MAX_ATTEMPTS} threw ${(err as Error).message}, retrying...`,
          );
          await sleep(jitteredBackoff(attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`WhatsApp ${op} exhausted retries`);
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
