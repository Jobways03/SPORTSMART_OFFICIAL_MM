import 'reflect-metadata';
import { RazorpayClient } from './razorpay.client';

/**
 * Phase 4 (PR 4.1) — Razorpay HTTP retry policy.
 *
 * Pre-PR every Razorpay call was a single-shot `fetch`. A 502 from
 * Razorpay's load-balancer, a TCP RST, or a 30-second timeout
 * surfaced as a hard failure to the caller. For READ operations
 * (`fetchPayment`, `fetchRefund`) that's particularly bad: a transient
 * blip during the gateway-amount-verifier flow makes the customer
 * see "verification failed" — they retry checkout from the top, and
 * the original payment that DID complete now gets charged again.
 *
 * PR 4.1 adds retry with exponential backoff + full jitter:
 *
 *   - retryable errors: 5xx, 429, network failure, timeout abort
 *   - non-retryable: 4xx (caller-side bugs — a retry won't fix the
 *     missing field)
 *   - max 3 attempts (1 original + 2 retries)
 *   - backoff: 200ms, 800ms, capped at 5s; full-jitter to avoid
 *     thundering-herd when many sessions retry at once
 *
 * GET endpoints retry by default (idempotent on the server side).
 * POST endpoints do NOT retry by default — without an idempotency
 * key, a retried capture/refund is a duplicate write. PR 4.2 will
 * add idempotency-key plumbing and switch POSTs to retry.
 */

const baseEnv = {
  RAZORPAY_KEY_ID: 'rzp_test_xxx',
  RAZORPAY_KEY_SECRET: 'secret_yyy',
};

function buildClient(): RazorpayClient {
  process.env.RAZORPAY_KEY_ID = baseEnv.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = baseEnv.RAZORPAY_KEY_SECRET;
  const client = new RazorpayClient();
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

describe('RazorpayClient — HTTP retry policy (PR 4.1)', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  async function flushTimers(times = 5) {
    // Each retry awaits a backoff timer; advance + flush microtasks
    // enough times that 2 retries can drain.
    for (let i = 0; i < times; i++) {
      await jest.runAllTimersAsync();
    }
  }

  /**
   * Drive a fetch-mocked promise to settlement under fake timers.
   * Returns `{ resolved?, rejected? }` so callers can use ordinary
   * `expect` assertions instead of the awkward `await expect(p).rejects`
   * pattern that races against the timer flush.
   */
  async function settle<T>(p: Promise<T>): Promise<{ resolved?: T; rejected?: Error }> {
    const captured: { resolved?: T; rejected?: Error } = {};
    const wrapped = p.then(
      (v) => { captured.resolved = v; },
      (e) => { captured.rejected = e; },
    );
    await flushTimers();
    await wrapped;
    return captured;
  }

  describe('GET (read) endpoints', () => {
    it('retries on 502 then succeeds — fetch called multiple times', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(502, { error: 'bad gateway' }))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'pay_test_1', amount: 100 }));

      const client = buildClient();
      const { resolved, rejected } = await settle(client.fetchPayment('pay_test_1'));

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('pay_test_1');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries on 503 then 504 then succeeds (max 3 attempts)', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(504))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'pay_test_2' }));

      const client = buildClient();
      const { resolved, rejected } = await settle(client.fetchPayment('pay_test_2'));

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('pay_test_2');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('gives up after 3 attempts and rethrows the last error', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(502))
        .mockResolvedValueOnce(fakeResponse(502))
        .mockResolvedValueOnce(fakeResponse(502));

      const client = buildClient();
      const { rejected } = await settle(client.fetchPayment('pay_test_3'));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/Razorpay.*502/);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('retries on network error (TypeError from fetch)', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'pay_test_4' }));

      const client = buildClient();
      const { resolved, rejected } = await settle(client.fetchPayment('pay_test_4'));

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('pay_test_4');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on 400 (caller-side bug — retry would just repeat the same mistake)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(400, { error: 'bad request' }));

      const client = buildClient();
      const { rejected } = await settle(client.fetchPayment('pay_test_5'));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/400/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 404 (the payment id is genuinely unknown — retry won\'t make it appear)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(404));

      const client = buildClient();
      const { rejected } = await settle(client.fetchPayment('pay_test_6'));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/404/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 (rate-limited)', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(429))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'pay_test_7' }));

      const client = buildClient();
      const { resolved, rejected } = await settle(client.fetchPayment('pay_test_7'));

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('pay_test_7');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST (write) endpoints — do NOT retry by default', () => {
    // Until PR 4.2 plumbs idempotency keys, retrying a write is unsafe
    // (duplicate captures / refunds). One attempt, hard failure if it
    // doesn't land.
    it('createOrder does not retry on 502', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(502));

      const client = buildClient();
      const { rejected } = await settle(client.createOrder({ amount: 100, receipt: 'r1' }));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/502/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('capturePayment does not retry on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

      const client = buildClient();
      const { rejected } = await settle(client.capturePayment('pay_test_x', 100));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/fetch failed/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('createRefund does not retry on 503', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(503));

      const client = buildClient();
      const { rejected } = await settle(client.createRefund('pay_test_x', { amount: 100 }));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/503/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
