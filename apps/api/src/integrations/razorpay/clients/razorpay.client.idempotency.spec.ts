import 'reflect-metadata';
import { RazorpayClient } from './razorpay.client';

/**
 * Phase 4 (PR 4.2) — Razorpay idempotency-key plumbing on writes.
 *
 * PR 4.1 left POST endpoints (createOrder / capturePayment /
 * createRefund) single-shot because a retry without an idempotency
 * key risks double-write at the gateway. PR 4.2 adds the missing
 * piece: when the caller passes a stable `idempotencyKey`, the
 * client sends `X-Razorpay-Idempotency-Key: <key>` and enables the
 * same retry policy used for GETs. Retries of the same key are
 * deduplicated by Razorpay → no duplicate refund, no duplicate
 * captured payment, no duplicate order.
 *
 * The header name is the one Razorpay's v1 API documents.
 *
 * The key is REQUIRED to be caller-stable across retries — the
 * caller derives it from the domain entity (refund-instruction id,
 * master-order id, etc.). Generating a fresh UUID per attempt would
 * defeat the dedup.
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

async function settle<T>(p: Promise<T>): Promise<{ resolved?: T; rejected?: Error }> {
  const captured: { resolved?: T; rejected?: Error } = {};
  const wrapped = p.then(
    (v) => { captured.resolved = v; },
    (e) => { captured.rejected = e; },
  );
  // Drain backoff timers under fake timers; multiple flushes so two
  // sleeps + their microtask continuations complete.
  for (let i = 0; i < 5; i++) {
    await jest.runAllTimersAsync();
  }
  await wrapped;
  return captured;
}

describe('RazorpayClient — idempotency-key plumbing on writes (PR 4.2)', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('X-Razorpay-Idempotency-Key header', () => {
    it('createRefund WITH idempotencyKey sends the header verbatim', async () => {
      fetchSpy.mockResolvedValueOnce(
        fakeResponse(200, { id: 'rfnd_1', payment_id: 'pay_1', amount: 100, status: 'processed', speed_processed: 'normal' }),
      );

      const client = buildClient();
      await settle(
        client.createRefund('pay_1', {
          amount: 100,
          idempotencyKey: 'refund-instruction-42',
        }),
      );

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Razorpay-Idempotency-Key']).toBe('refund-instruction-42');
    });

    it('createOrder WITH idempotencyKey sends the header', async () => {
      fetchSpy.mockResolvedValueOnce(
        fakeResponse(200, { id: 'order_1', amount: 1000, currency: 'INR', receipt: 'r1', status: 'created' }),
      );

      const client = buildClient();
      await settle(
        client.createOrder({
          amount: 1000,
          receipt: 'r1',
          idempotencyKey: 'checkout-order-master-99',
        }),
      );

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Razorpay-Idempotency-Key']).toBe('checkout-order-master-99');
    });

    it('capturePayment WITH idempotencyKey sends the header', async () => {
      fetchSpy.mockResolvedValueOnce(
        fakeResponse(200, { id: 'pay_1', status: 'captured', captured: true }),
      );

      const client = buildClient();
      await settle(
        client.capturePayment('pay_1', 1000, 'INR', { idempotencyKey: 'capture-pay-1' }),
      );

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Razorpay-Idempotency-Key']).toBe('capture-pay-1');
    });

    it('createRefund WITHOUT idempotencyKey does NOT send the header (back-compat)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(200, {}));

      const client = buildClient();
      await settle(client.createRefund('pay_1', { amount: 100 }));

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Razorpay-Idempotency-Key']).toBeUndefined();
    });
  });

  describe('retry-on-write when idempotencyKey is present', () => {
    it('createRefund WITH key retries on 502 and succeeds — same idempotency key on every retry', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(502))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'rfnd_1', payment_id: 'pay_1', amount: 100, status: 'processed', speed_processed: 'normal' }));

      const client = buildClient();
      const { resolved, rejected } = await settle(
        client.createRefund('pay_1', {
          amount: 100,
          idempotencyKey: 'refund-instruction-42',
        }),
      );

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('rfnd_1');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Critical: BOTH attempts use the same idempotency key, so
      // Razorpay can dedup if the first attempt actually landed.
      const keysSent = fetchSpy.mock.calls.map(
        ([, init]) => (init?.headers as Record<string, string>)['X-Razorpay-Idempotency-Key'],
      );
      expect(new Set(keysSent).size).toBe(1);
      expect(keysSent[0]).toBe('refund-instruction-42');
    });

    it('createRefund WITHOUT key does NOT retry on 502 (preserves PR 4.1 default)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(502));

      const client = buildClient();
      const { rejected } = await settle(client.createRefund('pay_1', { amount: 100 }));

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/502/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('createOrder WITH key retries on 503 and succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(200, { id: 'order_1', amount: 1000, currency: 'INR', receipt: 'r1', status: 'created' }));

      const client = buildClient();
      const { resolved, rejected } = await settle(
        client.createOrder({ amount: 1000, receipt: 'r1', idempotencyKey: 'k1' }),
      );

      expect(rejected).toBeUndefined();
      expect(resolved?.id).toBe('order_1');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('idempotencyKey-driven retries STILL stop on 400 (caller bug, never retryable)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(400, { error: 'amount missing' }));

      const client = buildClient();
      const { rejected } = await settle(
        client.createRefund('pay_1', { amount: 100, idempotencyKey: 'k1' }),
      );

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/400/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
