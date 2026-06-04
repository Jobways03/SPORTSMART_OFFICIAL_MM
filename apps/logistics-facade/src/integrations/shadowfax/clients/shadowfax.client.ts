import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import {
  SHADOWFAX_AUTH_HEADER,
  SHADOWFAX_AUTH_SCHEME,
  SHADOWFAX_CONFIG,
  SHADOWFAX_WEBHOOK_SIGNATURE_HEADER,
} from '../shadowfax.constants';
import type { ShadowfaxConfig } from '../config/shadowfax.config';

export type ShadowfaxHttpMethod = 'GET' | 'POST';

export interface ShadowfaxRequestOptions {
  /** Optional query-string params merged into the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Per-request override for the configured timeout. */
  timeoutMs?: number;
  /** Our internal audit key — forwarded as X-Idempotency-Key. */
  idempotencyKey?: string;
  /** Override retry budget for this call (defaults to config.maxRetries). */
  maxRetries?: number;
}

export interface ShadowfaxResponse<TRes> {
  status: number;
  /** Decoded JSON body when content-type is JSON, raw text otherwise. */
  body: TRes;
  headers: Record<string, string>;
}

/**
 * Thin HTTP wrapper around the Shadowfax REST API.
 *
 * Responsibilities:
 *   • Build the absolute URL from `config.apiUrl` + path + query.
 *   • Attach `Authorization: Token <apiToken>` on every call.
 *   • Set `Content-Type: application/json` on POST (Shadowfax rejects
 *     create requests without it).
 *   • Forward `X-Idempotency-Key` (own audit; Shadowfax dedupes on
 *     `client_order_id`, not this header).
 *   • Retry on 5xx + network errors up to `config.maxRetries` with
 *     exponential backoff (500ms, 1000ms, 2000ms).
 *   • Do NOT retry on 4xx — those are caller errors.
 *   • Honour `config.requestTimeoutMs` via AbortController.
 *   • Log every request: method, path, status, latency_ms. Bodies
 *     are NOT logged in production (PII + auth tokens).
 *
 * Pattern mirrors apps/api/src/integrations/ithink/clients/ithink.client.ts.
 */
@Injectable()
export class ShadowfaxClient {
  constructor(
    @Inject(SHADOWFAX_CONFIG) private readonly config: ShadowfaxConfig,
    private readonly logger: AppLoggerService,
  ) {}

  /** GET helper. Use for serviceability + tracking pulls. */
  async get<TRes>(
    path: string,
    query?: Record<string, unknown>,
    options: Omit<ShadowfaxRequestOptions, 'query'> = {},
  ): Promise<ShadowfaxResponse<TRes>> {
    return this.request<unknown, TRes>('GET', path, undefined, {
      ...options,
      query: query as ShadowfaxRequestOptions['query'],
    });
  }

  /** POST helper. Body is serialised as application/json. */
  async post<TReq, TRes>(
    path: string,
    body: TReq,
    options: ShadowfaxRequestOptions = {},
  ): Promise<ShadowfaxResponse<TRes>> {
    return this.request<TReq, TRes>('POST', path, body, options);
  }

  /**
   * Webhook verification entry point — UNIMPLEMENTED (handled in a
   * later sprint). Kept on the surface so the public API doesn't move
   * when the webhook handler lands.
   *
   * TODO: HMAC-SHA256(rawBody, config.webhookToken) compared against
   * the `X-Shadowfax-Signature` header via `crypto.timingSafeEqual`.
   */
  verifyWebhook(_input: { rawBody: Buffer; signatureHeader: string }): boolean {
    void SHADOWFAX_WEBHOOK_SIGNATURE_HEADER;
    void this.config.webhookToken;
    // Sprint-3 deliverable; the webhook ingester isn't wired yet.
    throw new Error(
      '[SHADOWFAX] verifyWebhook is not yet implemented — webhook ' +
        'handler lands in a later sprint.',
    );
  }

  /* ── Private transport ──────────────────────────────────────── */

  private async request<TReq, TRes>(
    method: ShadowfaxHttpMethod,
    path: string,
    body?: TReq,
    options: ShadowfaxRequestOptions = {},
  ): Promise<ShadowfaxResponse<TRes>> {
    const url = this.buildUrl(path, options.query);
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;

    const headers: Record<string, string> = {
      [SHADOWFAX_AUTH_HEADER]: `${SHADOWFAX_AUTH_SCHEME} ${this.config.apiToken}`,
      Accept: 'application/json',
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

    const payload = method === 'POST' && body !== undefined
      ? JSON.stringify(body)
      : undefined;

    let attempt = 0;
    let lastError: unknown;

    // Total attempts = 1 + maxRetries.
    while (attempt <= maxRetries) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
        });

        const latencyMs = Date.now() - startedAt;
        const status = response.status;

        // Read once — parse JSON if content-type matches, otherwise text.
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        const parsed = contentType.includes('application/json') && text.length > 0
          ? safeJsonParse<TRes>(text)
          : (text as unknown as TRes);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        this.logger.log(
          `[SHADOWFAX] ${method} ${path} status=${status} attempt=${attempt + 1} latency_ms=${latencyMs}`,
        );

        // Retry on 5xx; surface 4xx + 2xx straight through.
        if (status >= 500 && attempt < maxRetries) {
          attempt += 1;
          await sleep(backoffMs(attempt));
          continue;
        }

        return { status, body: parsed, headers: responseHeaders };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        lastError = err;
        const isAbort = (err as Error)?.name === 'AbortError';
        this.logger.warn(
          `[SHADOWFAX] ${method} ${path} ERROR attempt=${attempt + 1} latency_ms=${latencyMs} ${isAbort ? 'timeout' : (err as Error).message}`,
        );
        if (attempt >= maxRetries) break;
        attempt += 1;
        await sleep(backoffMs(attempt));
      } finally {
        clearTimeout(timer);
      }
    }

    // All attempts failed at the transport layer — translate to a
    // synthetic 0-status response so the caller's error mapper can
    // surface a PARTNER_DOWN.
    throw new Error(
      `[SHADOWFAX] ${method} ${path} failed after ${attempt + 1} attempts: ${(lastError as Error)?.message ?? 'unknown error'}`,
    );
  }

  private buildUrl(path: string, query?: ShadowfaxRequestOptions['query']): string {
    const base = this.config.apiUrl.endsWith('/')
      ? this.config.apiUrl.slice(0, -1)
      : this.config.apiUrl;
    const normalisedPath = path.startsWith('/') ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : '';
    return `${base}${normalisedPath}${qs}`;
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

function safeJsonParse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function buildQueryString(query: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, String(v));
  return `?${params.toString()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 500ms, 1000ms, 2000ms, … */
function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt - 1);
}
