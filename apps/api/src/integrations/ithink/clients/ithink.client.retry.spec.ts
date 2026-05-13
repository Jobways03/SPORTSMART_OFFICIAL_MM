import 'reflect-metadata';
import { IThinkClient, IThinkApiError, IThinkClientError } from './ithink.client';

/**
 * Phase 4 (PR 4.6) — tighten iThink retry classification.
 *
 * The existing client (pre-PR 4.6) retried on every error that wasn't
 * an `IThinkApiError`, including 4xx HTTP responses. A 401 (bad
 * credentials) or 400 (malformed request) would burn three attempts
 * and the configured backoff windows before failing — same outcome,
 * 3× the latency, 3× the iThink-side load.
 *
 * PR 4.6 mirrors the Razorpay PR 4.1 + WhatsApp PR 4.5 classification:
 *
 *   - 5xx, 429:  transient gateway state → retry
 *   - 4xx:       caller-side bug or auth → fail fast (new
 *                `IThinkClientError`)
 *   - transport (TypeError, AbortError): retry
 *   - non-JSON response (gateway error page): retry once (transient
 *     edge in front of iThink)
 *   - application-level (status='error', status_code != 200):
 *     `IThinkApiError`, no retry (deterministic)
 */

const baseConfig = {
  isConfigured: true,
  trackUrl: 'https://track.example.com',
  baseUrl: 'https://api.example.com',
  httpTimeoutMs: 5000,
  httpMaxRetries: 2,
  getAuthPayload: () => ({ access_token: 'tok', secret_key: 'sec' }),
} as any;

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

describe('IThinkClient — retry classification (PR 4.6)', () => {
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('5xx / 429 — retried', () => {
    it('502 then 200 succeeds on second attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(502))
        .mockResolvedValueOnce(
          fakeResponse(200, { status: 'success', status_code: 200, data: { id: 'ok' } }),
        );

      const client = new IThinkClient(baseConfig);
      const { resolved, rejected } = await settle(
        client.post('GET_AIRWAYBILL', { start_date_time: 'x', end_date_time: 'y' }),
      );

      expect(rejected).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(resolved?.status).toBe('success');
    });

    it('429 then 200 retries (rate-limit transient)', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(429))
        .mockResolvedValueOnce(
          fakeResponse(200, { status: 'success', status_code: 200 }),
        );
      const client = new IThinkClient(baseConfig);
      const { resolved } = await settle(client.post('TRACK_ORDER', { awb_number_list: 'AWB1' }));
      expect(resolved?.status).toBe('success');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('gives up after maxAttempts on persistent 503', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(503))
        .mockResolvedValueOnce(fakeResponse(503));
      const client = new IThinkClient(baseConfig);
      const { rejected } = await settle(client.post('TRACK_ORDER', { awb_number_list: 'X' }));

      expect(rejected).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('4xx — fail fast as IThinkClientError', () => {
    it('401 (bad credentials) is NOT retried', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(401, { error: 'unauthorized' }));

      const client = new IThinkClient(baseConfig);
      const { rejected } = await settle(client.post('TRACK_ORDER', { awb_number_list: 'X' }));

      expect(rejected).toBeDefined();
      expect(rejected).toBeInstanceOf(IThinkClientError);
      expect(rejected!.message).toMatch(/401/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('400 (malformed) is NOT retried', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(400, { error: 'bad input' }));

      const client = new IThinkClient(baseConfig);
      const { rejected } = await settle(client.post('GET_AIRWAYBILL', { x: 'y' }));

      expect(rejected).toBeInstanceOf(IThinkClientError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('404 (unknown endpoint route) is NOT retried', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse(404));

      const client = new IThinkClient(baseConfig);
      const { rejected } = await settle(client.post('TRACK_ORDER', {}));

      expect(rejected).toBeInstanceOf(IThinkClientError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('application-level errors — fail fast as IThinkApiError', () => {
    it('status="error" (status_code 200) is NOT retried — deterministic', async () => {
      fetchSpy.mockResolvedValueOnce(
        fakeResponse(200, {
          status: 'error',
          status_code: 200,
          message: 'Access Token Not Match.',
        }),
      );

      const client = new IThinkClient(baseConfig);
      const { rejected } = await settle(client.post('TRACK_ORDER', {}));

      expect(rejected).toBeInstanceOf(IThinkApiError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('transport errors — retried', () => {
    it('network TypeError retries', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(fakeResponse(200, { status: 'success' }));

      const client = new IThinkClient(baseConfig);
      const { resolved } = await settle(client.post('TRACK_ORDER', {}));

      expect(resolved?.status).toBe('success');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
