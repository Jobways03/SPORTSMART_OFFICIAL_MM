import 'reflect-metadata';
import { WhatsAppClient } from './whatsapp.client';

/**
 * Phase 4 (PR 4.5) — WhatsApp HTTP retry policy.
 *
 * Pre-PR every WhatsApp call (sendTextMessage / sendTemplateMessage)
 * was a single-shot `fetch` to Meta's Graph API. The notification
 * handlers wrap their calls in try/catch (per the file header) and
 * swallow errors silently, so a transient 502 / TCP RST / DNS blip
 * meant the customer simply doesn't receive their order-update.
 *
 * Same retry shape as Razorpay (PR 4.1): retryable on 5xx, 429,
 * network errors, and timeouts. Max 3 attempts with full-jitter
 * exponential backoff. 4xx (auth, malformed template, banned number)
 * fails fast — no retry will turn a 403 into a 200.
 *
 * Idempotency note: WhatsApp Business API doesn't expose an
 * `Idempotency-Key`-style header. A retry of `sendTextMessage` can
 * produce a duplicate message at the customer. The pragmatic
 * trade-off: rare duplicate over silent drop. Customer-facing
 * notification handlers can later add per-message dedup if needed.
 */

function buildClient(): WhatsAppClient {
  process.env.WHATSAPP_API_URL = 'https://graph.example.com/v18.0';
  process.env.WHATSAPP_API_TOKEN = 'tok_test_xxx';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone_999';
  const client = new WhatsAppClient();
  client.onModuleInit();
  return client;
}

function fakeResponse(status: number, body: any = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function settle<T>(p: Promise<T>): Promise<{ resolved?: T; rejected?: Error }> {
  const captured: { resolved?: T; rejected?: Error } = {};
  const wrapped = p.then(
    (v) => { captured.resolved = v; },
    (e) => { captured.rejected = e; },
  );
  for (let i = 0; i < 5; i++) {
    await jest.runAllTimersAsync();
  }
  await wrapped;
  return captured;
}

describe('WhatsAppClient — HTTP retry policy (PR 4.5)', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it('retries on 502 then succeeds — fetch called multiple times', async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(502))
      .mockResolvedValueOnce(
        fakeResponse(200, { messages: [{ id: 'wamid.1' }] }),
      );

    const client = buildClient();
    const { resolved, rejected } = await settle(
      client.sendTextMessage('+9199xxx', 'Order placed'),
    );

    expect(rejected).toBeUndefined();
    expect(resolved?.messageId).toBe('wamid.1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 then 504 then succeeds (max 3 attempts)', async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(504))
      .mockResolvedValueOnce(
        fakeResponse(200, { messages: [{ id: 'wamid.2' }] }),
      );

    const client = buildClient();
    const { resolved, rejected } = await settle(
      client.sendTextMessage('+9199xxx', 'hi'),
    );
    expect(rejected).toBeUndefined();
    expect(resolved?.messageId).toBe('wamid.2');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 attempts and rethrows the last error', async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(502))
      .mockResolvedValueOnce(fakeResponse(502))
      .mockResolvedValueOnce(fakeResponse(502));

    const client = buildClient();
    const { rejected } = await settle(client.sendTextMessage('+9199xxx', 'hi'));

    expect(rejected).toBeDefined();
    expect(rejected!.message).toMatch(/WhatsApp.*502/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('retries on network error (TypeError from fetch)', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        fakeResponse(200, { messages: [{ id: 'wamid.3' }] }),
      );

    const client = buildClient();
    const { resolved, rejected } = await settle(
      client.sendTextMessage('+9199xxx', 'hi'),
    );
    expect(rejected).toBeUndefined();
    expect(resolved?.messageId).toBe('wamid.3');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 401 (auth error — token is invalid, retry won\'t help)', async () => {
    fetchSpy.mockResolvedValueOnce(fakeResponse(401, { error: 'invalid token' }));

    const client = buildClient();
    const { rejected } = await settle(client.sendTextMessage('+9199xxx', 'hi'));

    expect(rejected).toBeDefined();
    expect(rejected!.message).toMatch(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400 (malformed template / banned number)', async () => {
    fetchSpy.mockResolvedValueOnce(fakeResponse(400, { error: 'invalid template' }));

    const client = buildClient();
    const { rejected } = await settle(
      client.sendTemplateMessage('+9199xxx', 'tpl', 'en', []),
    );

    expect(rejected).toBeDefined();
    expect(rejected!.message).toMatch(/400/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 (rate-limited)', async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(
        fakeResponse(200, { messages: [{ id: 'wamid.4' }] }),
      );

    const client = buildClient();
    const { resolved } = await settle(client.sendTextMessage('+9199xxx', 'hi'));
    expect(resolved?.messageId).toBe('wamid.4');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('sendTemplateMessage gets the same retry policy as sendTextMessage', async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(502))
      .mockResolvedValueOnce(
        fakeResponse(200, { messages: [{ id: 'wamid.5' }] }),
      );

    const client = buildClient();
    const { resolved } = await settle(
      client.sendTemplateMessage('+9199xxx', 'order_shipped', 'en', [
        { type: 'text', text: 'SO-123' },
      ]),
    );
    expect(resolved?.messageId).toBe('wamid.5');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('unconfigured: short-circuits without hitting fetch (preserves pre-PR behaviour)', async () => {
    delete process.env.WHATSAPP_API_TOKEN;
    const client = new WhatsAppClient();
    client.onModuleInit();
    const result = await client.sendTextMessage('+9199xxx', 'hi');
    expect(result.messageId).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
