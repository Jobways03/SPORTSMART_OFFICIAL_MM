import 'reflect-metadata';
import { RequestLoggingMiddleware, sanitizeRoute } from './request-logging.middleware';
import { MetricsRegistry } from '../../core/metrics/metrics.registry';

/**
 * Phase 5 (PR 5.7) — HTTP request-duration histogram.
 *
 * Every HTTP response emits one observation to `http_request_duration_ms`
 * with labels:
 *
 *   - `method` (GET / POST / PATCH / DELETE / OPTIONS)
 *   - `route`  (route template like `/api/v1/orders/:id`, NOT the raw
 *               URL — raw URLs include UUIDs that would explode label
 *               cardinality and OOM Prometheus)
 *   - `status_class` (2xx / 3xx / 4xx / 5xx)
 *
 * Bucketed against the registry default (10ms…30s).
 *
 * The `sanitizeRoute` helper is the cardinality-control gate: when
 * `req.route?.path` isn't available (rare — happens when a 404 lands
 * before any route matches), we fold UUIDs and pure-numeric path
 * segments into `:id` to keep the label space bounded.
 */

function fakeReq(opts: {
  method?: string;
  originalUrl?: string;
  routePath?: string;
  requestId?: string;
} = {}): any {
  const headers: Record<string, string> = {};
  if (opts.requestId) headers['x-request-id'] = opts.requestId;
  return {
    method: opts.method ?? 'GET',
    originalUrl: opts.originalUrl ?? '/api/v1/orders/abc-123',
    route: opts.routePath ? { path: opts.routePath } : undefined,
    header: (k: string) => headers[k.toLowerCase()],
    headers,
  };
}

function fakeRes(status: number): any {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    statusCode: status,
    setHeader: jest.fn(),
    on: (event: string, cb: () => void) => {
      listeners[event] = (listeners[event] ?? []).concat(cb);
    },
    /** Test-only helper to fire the finish handler. */
    _fireFinish: () => {
      for (const cb of listeners['finish'] ?? []) cb();
    },
  };
}

const noopLogger = { log: jest.fn() } as any;

describe('sanitizeRoute (PR 5.7)', () => {
  it('returns the route template verbatim when given one', () => {
    expect(sanitizeRoute('/api/v1/orders/:id')).toBe('/api/v1/orders/:id');
  });

  it('folds UUID segments into :id', () => {
    expect(
      sanitizeRoute('/api/v1/orders/550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('/api/v1/orders/:id');
  });

  it('folds pure-numeric segments into :id', () => {
    expect(sanitizeRoute('/api/v1/customers/12345/orders')).toBe(
      '/api/v1/customers/:id/orders',
    );
  });

  it('handles multiple replacements in one path', () => {
    expect(
      sanitizeRoute(
        '/api/v1/customers/550e8400-e29b-41d4-a716-446655440000/orders/SO-2026-000123',
      ),
    ).toBe('/api/v1/customers/:id/orders/:id');
  });

  it('strips query strings (cardinality control)', () => {
    expect(sanitizeRoute('/api/v1/products?category=shoes&page=2')).toBe(
      '/api/v1/products',
    );
  });

  it('leaves slug-style segments alone (no false positives on words)', () => {
    expect(sanitizeRoute('/api/v1/products/featured/list')).toBe(
      '/api/v1/products/featured/list',
    );
  });

  it('folds returnNumber-style codes (RET-YYYY-NNNNNN)', () => {
    expect(sanitizeRoute('/api/v1/returns/RET-2026-000001/items')).toBe(
      '/api/v1/returns/:id/items',
    );
  });
});

describe('RequestLoggingMiddleware — request duration metric (PR 5.7)', () => {
  it('emits an http_request_duration_ms observation on response finish', () => {
    const metrics = new MetricsRegistry();
    const mw = new RequestLoggingMiddleware(noopLogger, metrics);
    const req = fakeReq({ method: 'GET', routePath: '/api/v1/orders/:id' });
    const res = fakeRes(200);

    mw.use(req, res, () => undefined);
    res._fireFinish();

    const exposition = metrics.render();
    expect(exposition).toMatch(/http_request_duration_ms_count\{[^}]+\}\s+1\b/);
    expect(exposition).toMatch(/method="GET"/);
    expect(exposition).toMatch(/route="\/api\/v1\/orders\/:id"/);
    expect(exposition).toMatch(/status_class="2xx"/);
  });

  it('labels status_class correctly for 4xx / 5xx', () => {
    const metrics = new MetricsRegistry();
    const mw = new RequestLoggingMiddleware(noopLogger, metrics);

    for (const status of [404, 500, 503]) {
      const req = fakeReq({ method: 'POST', routePath: '/api/v1/checkout' });
      const res = fakeRes(status);
      mw.use(req, res, () => undefined);
      res._fireFinish();
    }

    const exposition = metrics.render();
    expect(exposition).toMatch(/status_class="4xx"/);
    expect(exposition).toMatch(/status_class="5xx"/);
  });

  it('uses sanitized fallback when req.route is undefined (e.g. 404 unmatched)', () => {
    const metrics = new MetricsRegistry();
    const mw = new RequestLoggingMiddleware(noopLogger, metrics);
    const req = fakeReq({
      method: 'GET',
      originalUrl: '/api/v1/orders/550e8400-e29b-41d4-a716-446655440000',
      routePath: undefined, // unmatched
    });
    const res = fakeRes(404);

    mw.use(req, res, () => undefined);
    res._fireFinish();

    // The raw URL's UUID segment gets folded to `:id` — the literal
    // UUID must never reach the metric label or cardinality explodes.
    const exposition = metrics.render();
    expect(exposition).not.toMatch(/550e8400-e29b-41d4-a716-446655440000/);
    expect(exposition).toMatch(/route="\/api\/v1\/orders\/:id"/);
  });

  it('still mints / honours request-id (existing behaviour preserved)', () => {
    const metrics = new MetricsRegistry();
    const mw = new RequestLoggingMiddleware(noopLogger, metrics);
    const req = fakeReq({ requestId: 'caller-supplied-rid' });
    const res = fakeRes(200);

    mw.use(req, res, () => undefined);
    expect(req.id).toBe('caller-supplied-rid');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'caller-supplied-rid');
  });

  it('still logs the request line on finish (existing log preserved)', () => {
    const metrics = new MetricsRegistry();
    const logger = { log: jest.fn() } as any;
    const mw = new RequestLoggingMiddleware(logger, metrics);
    const req = fakeReq({ method: 'GET', routePath: '/health' });
    const res = fakeRes(200);

    mw.use(req, res, () => undefined);
    res._fireFinish();

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toMatch(/GET.*200.*\d+ms.*req=/);
  });

  it('registers HELP and TYPE for the histogram at construct time', () => {
    const metrics = new MetricsRegistry();
    new RequestLoggingMiddleware(noopLogger, metrics);
    const exposition = metrics.render();
    expect(exposition).toMatch(/# HELP http_request_duration_ms /);
    expect(exposition).toMatch(/# TYPE http_request_duration_ms histogram/);
  });
});
