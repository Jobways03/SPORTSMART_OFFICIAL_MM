import 'reflect-metadata';
import { ShiprocketClient } from './shiprocket.client';

/**
 * Phase 4 (PR 4.8) — Shiprocket HTTP retry policy.
 *
 * Pre-PR the Shiprocket client only retried on 401 (token refresh).
 * Any 5xx, 429, or transport-layer error during outbound calls
 * (createOrder, generate AWB, request pickup, etc.) was a hard
 * failure. Same fix pattern as Razorpay (PR 4.1), WhatsApp (PR 4.5),
 * iThink (PR 4.6):
 *
 *   - 5xx, 429 → retry with backoff
 *   - 401 → existing token-refresh retry (one extra attempt)
 *   - 4xx (other) → fail fast
 *   - network errors → retry
 *
 * The 401 path is orthogonal to the new retry: a 401 first triggers
 * token refresh + re-fetch (the existing behaviour). If the refresh
 * succeeds but the subsequent call gets a 5xx, the new retry kicks
 * in. They compose.
 */

function authResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ token: 'tok-test' }),
    text: async () => '{"token":"tok-test"}',
  } as unknown as Response;
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

function buildClient(): ShiprocketClient {
  process.env.SHIPROCKET_EMAIL = 'test@example.com';
  process.env.SHIPROCKET_PASSWORD = 'pw_test_xxx';
  const client = new ShiprocketClient();
  client.onModuleInit();
  return client;
}

describe('ShiprocketClient — HTTP retry policy (PR 4.8)', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('5xx / 429 retry — applied via request()', () => {
    it('502 then 200 on createOrder succeeds with two API attempts (plus initial auth)', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse()) // auth login
        .mockResolvedValueOnce(fakeResponse(502)) // first createOrder
        .mockResolvedValueOnce(
          fakeResponse(200, { order_id: 'so-1', shipment_id: 'sh-1', awb_code: 'AWB1', courier_company_id: 1, courier_name: 'X' }),
        );

      const client = buildClient();
      const { resolved, rejected } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '2026-05-12', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );

      expect(rejected).toBeUndefined();
      expect(resolved?.order_id).toBe('so-1');
      // Auth + 2 createOrder attempts
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('persistent 503 exhausts the retry budget and throws', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse())
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(503));

      const client = buildClient();
      const { rejected } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '2026-05-12', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/Shiprocket.*503/);
      // Auth + 3 createOrder attempts
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('retries on 429 (rate-limited)', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse())
        .mockResolvedValueOnce(fakeResponse(429))
        .mockResolvedValueOnce(fakeResponse(200, { order_id: 'so-1' }));

      const client = buildClient();
      const { resolved } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );
      expect(resolved?.order_id).toBe('so-1');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('4xx fail-fast (other than 401 + 429)', () => {
    it('400 fails on first attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse())
        .mockResolvedValueOnce(fakeResponse(400, { error: 'bad input' }));

      const client = buildClient();
      const { rejected } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );

      expect(rejected).toBeDefined();
      expect(rejected!.message).toMatch(/400/);
      // Auth + 1 (no retry)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('403 fails on first attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse())
        .mockResolvedValueOnce(fakeResponse(403));

      const client = buildClient();
      const { rejected } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );

      expect(rejected).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('401 token-refresh path — composes with the new retry', () => {
    it('401 triggers token refresh + retry-once (existing behaviour preserved)', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse()) // initial auth
        .mockResolvedValueOnce(fakeResponse(401)) // first call gets 401
        .mockResolvedValueOnce(authResponse()) // forced refresh
        .mockResolvedValueOnce(
          fakeResponse(200, { order_id: 'so-1' }),
        ); // retry succeeds

      const client = buildClient();
      const { resolved } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );

      expect(resolved?.order_id).toBe('so-1');
      // initial auth + 401 + refresh + retry
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('transport errors retry', () => {
    it('TypeError (network) is retried', async () => {
      fetchSpy
        .mockResolvedValueOnce(authResponse())
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(fakeResponse(200, { order_id: 'so-1' }));

      const client = buildClient();
      const { resolved } = await settle(
        client.createOrder({
          order_id: 'o1', order_date: '', pickup_location: 'P',
          billing_customer_name: 'C', billing_address: 'A', billing_city: 'X',
          billing_pincode: '110001', billing_state: 'X', billing_country: 'India',
          billing_phone: '+919', shipping_is_billing: true, order_items: [],
          payment_method: 'Prepaid', sub_total: 100, length: 10, breadth: 10, height: 10, weight: 1,
        } as any),
      );
      expect(resolved?.order_id).toBe('so-1');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});
