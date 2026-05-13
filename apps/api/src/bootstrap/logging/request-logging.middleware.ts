import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppLoggerService } from './app-logger.service';
import {
  HistogramHandle,
  MetricsRegistry,
} from '../../core/metrics/metrics.registry';
import { HttpErrorRateMonitor } from './http-error-rate-monitor';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Phase 5 (PR 5.7) — collapse high-cardinality URL fragments so the
 * Prometheus histogram doesn't get one label per UUID / order number /
 * customer id. Three rules:
 *
 *   1. Strip the query string entirely.
 *   2. Replace UUIDs (8-4-4-4-12 hex) with `:id`.
 *   3. Replace pure-numeric segments and platform code segments
 *      (`RET-YYYY-NNNNNN`, `SO-YYYY-NNNNNN`, etc.) with `:id`.
 *
 * The route template from `req.route?.path` is preferred and used
 * verbatim when available; this sanitizer is the fallback for
 * unmatched routes (404s) and for express middlewares that fire
 * before NestJS populates `req.route`.
 *
 * Exported for unit testing of the sanitization rules.
 */
export function sanitizeRoute(rawUrl: string): string {
  // Already a route template? (Contains a `:placeholder` segment.)
  if (rawUrl.includes('/:')) return rawUrl.split('?')[0];

  const noQuery = rawUrl.split('?')[0];
  const segments = noQuery.split('/');
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const NUMERIC_RE = /^\d+$/;
  // Platform-wide ID-like patterns: 2-4 letter prefix + dash + digits.
  // E.g. RET-2026-000001, SO-2026-000123, INV-12345. Tight enough to
  // miss CUSTOMER-NAME-style slugs.
  const CODE_RE = /^[A-Z]{2,4}-\d+(-\d+)*$/;
  const sanitized = segments.map((seg) => {
    if (!seg) return seg;
    if (UUID_RE.test(seg)) return ':id';
    if (NUMERIC_RE.test(seg)) return ':id';
    if (CODE_RE.test(seg)) return ':id';
    return seg;
  });
  return sanitized.join('/');
}

function statusClass(status: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly durationHistogram: HistogramHandle;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly metrics: MetricsRegistry,
    // Phase 5 (PR 5.8) — optional so the middleware can be
    // constructed in test harnesses without the full DI tree. In
    // production the monitor is always provided by
    // LoggingModule and fires alerts on 5xx bursts.
    @Optional() private readonly errorMonitor?: HttpErrorRateMonitor,
  ) {
    // Register at construct time so the /metrics endpoint exposes
    // HELP / TYPE descriptors even before the first request lands.
    // Grafana panels pinned to the metric name don't go "no data"
    // during cold-start scrape windows.
    this.durationHistogram = this.metrics.histogram(
      'http_request_duration_ms',
      'HTTP request wall-clock duration in milliseconds, by method/route/status_class.',
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Trust an upstream request id when present (load balancer, API
    // gateway, or chained service) so one id flows end-to-end. If the
    // client sends a nonsense long value, truncate — we don't want a
    // 4KB id showing up in every downstream log line. Generate a fresh
    // UUID if nothing usable was supplied.
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && typeof incoming === 'string' && incoming.length > 0
        ? incoming.slice(0, 128)
        : randomUUID();

    (req as Request & { id?: string }).id = requestId;
    // Echo in the response so clients can correlate their retries /
    // support requests with our server logs.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;

      // Phase 5 (PR 5.7) — emit duration histogram. Prefer the route
      // template (req.route?.path) when NestJS matched a handler;
      // fall back to sanitized originalUrl for unmatched 404s.
      const routeTemplate =
        (req as Request & { route?: { path?: string } }).route?.path;
      const route = routeTemplate
        ? routeTemplate
        : sanitizeRoute(req.originalUrl ?? req.url ?? '/');
      this.durationHistogram.observe(duration, {
        method: req.method,
        route,
        status_class: statusClass(res.statusCode),
      });

      // Phase 5 (PR 5.8) — feed the burst monitor. Fire-and-forget:
      // the monitor swallows publish errors internally, so this can't
      // reject. Awaiting would push event-bus latency into the
      // response-finish hot path on a healthy system for no gain.
      this.errorMonitor?.recordStatus(res.statusCode).catch(() => {
        // Defensive: the monitor's contract is "never throws". This
        // catch is a belt-and-braces guard in case a future refactor
        // breaks that.
      });

      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms req=${requestId}`,
        'HTTP',
      );
    });

    next();
  }
}
