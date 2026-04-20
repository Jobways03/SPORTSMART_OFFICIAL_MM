import 'reflect-metadata';
import { RequestLoggingMiddleware } from '../../src/bootstrap/logging/request-logging.middleware';

/**
 * Regression test for request-id correlation in the HTTP middleware.
 *
 * Before: a single API request could fan out to 10+ log lines (guard,
 * use case, repo, integration) with no shared identifier. Tracing "why
 * did order X fail" required greping on substrings and was unreliable
 * once volume picked up.
 *
 * After: the middleware pins a request id onto `req.id`, echoes it in
 * the `x-request-id` response header, and prints it in the HTTP
 * finish log. Upstream ids are honored (one id end-to-end across
 * gateway + API) and truncated to keep log lines bounded if a client
 * sends a pathological value.
 */

describe('RequestLoggingMiddleware — request id correlation', () => {
  const buildHarness = () => {
    const logger: any = {
      log: jest.fn(),
      setContext: jest.fn(),
    };
    const middleware = new RequestLoggingMiddleware(logger);
    const headers: Record<string, string> = {};
    const listeners: Record<string, Array<() => void>> = {};
    const res: any = {
      setHeader: (k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      },
      on: (event: string, cb: () => void) => {
        (listeners[event] ??= []).push(cb);
      },
      statusCode: 200,
    };
    const finish = () => listeners['finish']?.forEach((cb) => cb());
    return { middleware, logger, headers, res, finish };
  };

  const makeReq = (incomingHeader?: string): any => ({
    method: 'GET',
    originalUrl: '/api/v1/ping',
    header: (name: string) =>
      name.toLowerCase() === 'x-request-id' ? incomingHeader : undefined,
  });

  it('generates a UUID when no incoming header is set', () => {
    const { middleware, res, headers } = buildHarness();
    const req = makeReq();
    middleware.use(req, res, () => undefined);

    expect(req.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(headers['x-request-id']).toBe(req.id);
  });

  it('honors an upstream x-request-id so the id is stable end-to-end', () => {
    const { middleware, res, headers } = buildHarness();
    const req = makeReq('gw-abc-123');
    middleware.use(req, res, () => undefined);

    expect(req.id).toBe('gw-abc-123');
    expect(headers['x-request-id']).toBe('gw-abc-123');
  });

  it('truncates pathologically long incoming ids to 128 chars', () => {
    const { middleware, res } = buildHarness();
    const req = makeReq('a'.repeat(5000));
    middleware.use(req, res, () => undefined);

    expect(req.id).toHaveLength(128);
    expect(req.id).toBe('a'.repeat(128));
  });

  it('emits the request id in the finish log line', () => {
    const { middleware, logger, res, finish } = buildHarness();
    const req = makeReq('corr-1');
    middleware.use(req, res, () => undefined);
    finish();

    expect(logger.log).toHaveBeenCalled();
    const line = logger.log.mock.calls[0][0];
    expect(line).toContain('GET /api/v1/ping 200');
    expect(line).toContain('req=corr-1');
  });

  it('calls next() exactly once so it does not short-circuit the stack', () => {
    const { middleware, res } = buildHarness();
    const req = makeReq();
    const next = jest.fn();
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
