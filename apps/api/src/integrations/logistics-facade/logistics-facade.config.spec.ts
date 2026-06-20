import {
  loadLogisticsFacadeConfig,
  type LogisticsFacadeConfig,
} from './config/logistics-facade.config';
import { LogisticsFacadeClient } from './clients/logistics-facade.client';

/**
 * Regression for the AWS boot crash: the LOGISTICS_FACADE_CONFIG provider
 * factory parses this config eagerly at DI bootstrap. It used to require
 * LOGISTICS_FACADE_URL (z.string().url() with no .optional()), so anywhere
 * the facade isn't deployed (AWS staging) the parse threw during module
 * resolution and the WHOLE API crash-looped. The fields are now optional —
 * apps/api boots cleanly when the facade is unwired, and the client throws a
 * clear error only if a caller actually makes a request.
 */
describe('loadLogisticsFacadeConfig', () => {
  it('does NOT throw and disables the integration when the facade env is unset (boot-safety)', () => {
    const cfg = loadLogisticsFacadeConfig({} as NodeJS.ProcessEnv);
    expect(cfg.apiUrl).toBeUndefined();
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.timeoutMs).toBe(30_000);
  });

  it('returns the values when the facade IS configured', () => {
    const cfg = loadLogisticsFacadeConfig({
      LOGISTICS_FACADE_URL: 'https://facade.internal',
      LOGISTICS_FACADE_API_KEY: 'supersecretkey',
      LOGISTICS_FACADE_TIMEOUT_MS: '5000',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.apiUrl).toBe('https://facade.internal');
    expect(cfg.apiKey).toBe('supersecretkey');
    expect(cfg.timeoutMs).toBe(5000);
  });

  it('still fails fast on a malformed URL when one IS provided', () => {
    expect(() =>
      loadLogisticsFacadeConfig({
        LOGISTICS_FACADE_URL: 'not-a-url',
        LOGISTICS_FACADE_API_KEY: 'supersecretkey',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('still fails fast on a too-short api key when one IS provided', () => {
    expect(() =>
      loadLogisticsFacadeConfig({
        LOGISTICS_FACADE_URL: 'https://facade.internal',
        LOGISTICS_FACADE_API_KEY: 'short',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('LogisticsFacadeClient when the facade is unconfigured', () => {
  const unconfigured: LogisticsFacadeConfig = { timeoutMs: 30_000 };

  it('constructs without throwing (mirrors the boot path)', () => {
    expect(() => new LogisticsFacadeClient(unconfigured)).not.toThrow();
  });

  it('rejects a request with a clear, actionable error', async () => {
    const client = new LogisticsFacadeClient(unconfigured);
    await expect(client.get('/v1/partners')).rejects.toThrow(/not configured/i);
  });

  it('baseUrl getter throws the clear error naming the env vars', () => {
    const client = new LogisticsFacadeClient(unconfigured);
    expect(() => client.baseUrl).toThrow(/LOGISTICS_FACADE_URL/);
  });

  it('baseUrl returns the trimmed URL once configured', () => {
    const client = new LogisticsFacadeClient({
      apiUrl: 'https://facade.internal/',
      apiKey: 'supersecretkey',
      timeoutMs: 30_000,
    });
    expect(client.baseUrl).toBe('https://facade.internal');
  });
});
