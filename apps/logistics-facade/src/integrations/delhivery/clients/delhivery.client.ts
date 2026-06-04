import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import {
  DELHIVERY_AUTH_HEADER,
  DELHIVERY_AUTH_SCHEME,
  DELHIVERY_CONFIG,
  DELHIVERY_WEBHOOK_SIGNATURE_HEADER,
} from '../delhivery.constants';
import type { DelhiveryConfig } from '../config/delhivery.config';

/** HTTP verbs Delhivery exposes across the surfaces we use. */
export type DelhiveryHttpMethod = 'GET' | 'POST' | 'PUT';

/**
 * Delhivery has two body conventions across their B2C surface:
 *   • `json`  — standard `application/json` (most newer endpoints).
 *   • `form`  — legacy form-style POST used by `create.json` and a
 *               few cousins. Body is URL-encoded as
 *               `format=json&data=<urlencoded JSON>`.
 *
 * Callers pass `contentType: 'form'` when hitting the form-style
 * surfaces (Shipment Manifestation). Defaults to `json`.
 */
export type DelhiveryContentType = 'json' | 'form';

export interface DelhiveryRequestOptions {
  /** Optional query-string params merged into the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Per-request override for the configured timeout. */
  timeoutMs?: number;
  /** Our internal audit key — forwarded as X-Idempotency-Key. */
  idempotencyKey?: string;
  /** Override retry budget for this call (defaults to config.maxRetries). */
  maxRetries?: number;
  /** Body serialisation mode for POST / PUT. Defaults to `json`. */
  contentType?: DelhiveryContentType;
}

export interface DelhiveryResponse<TRes> {
  status: number;
  /** Decoded JSON body when content-type is JSON, raw text otherwise. */
  body: TRes;
  headers: Record<string, string>;
}

/**
 * Thin HTTP wrapper around the Delhivery REST API.
 *
 * Responsibilities:
 *   • Build the absolute URL from `config.apiUrl` + path + query.
 *   • Attach `Authorization: Token <apiToken>` on every call.
 *   • Set `Content-Type` based on `options.contentType`:
 *       - `json` (default) -> `application/json`, body = JSON.stringify.
 *       - `form`           -> `application/x-www-form-urlencoded`,
 *                              body = `format=json&data=<encoded JSON>`.
 *   • Forward `X-Idempotency-Key` (own audit; Delhivery dedupes on
 *     `order_id` / waybill, not this header).
 *   • Retry on 5xx + network errors up to `config.maxRetries` with
 *     exponential backoff (500ms, 1000ms, 2000ms).
 *   • Do NOT retry on 4xx — those are caller errors.
 *   • Honour `config.requestTimeoutMs` via AbortController.
 *   • Log every request: method, path, status, latency_ms. Bodies
 *     are NEVER logged (PII + auth tokens).
 *
 * Pattern mirrors apps/logistics-facade/src/integrations/shadowfax/clients/shadowfax.client.ts.
 */
@Injectable()
export class DelhiveryClient {
  constructor(
    @Inject(DELHIVERY_CONFIG) private readonly config: DelhiveryConfig,
    private readonly logger: AppLoggerService,
  ) {}

  /** GET helper. Use for serviceability, tracking, waybill-fetch. */
  async get<TRes>(
    path: string,
    query?: Record<string, unknown>,
    options: Omit<DelhiveryRequestOptions, 'query' | 'contentType'> = {},
  ): Promise<DelhiveryResponse<TRes>> {
    return this.request<unknown, TRes>('GET', path, undefined, {
      ...options,
      query: query as DelhiveryRequestOptions['query'],
    });
  }

  /**
   * POST helper. Body serialisation is controlled by
   * `options.contentType`:
   *   • `json` (default) — `application/json` body.
   *   • `form`           — `application/x-www-form-urlencoded` body
   *                         wrapped as `format=json&data=<encoded JSON>`.
   *                         Required for Delhivery's Shipment
   *                         Manifestation endpoint.
   */
  async post<TReq, TRes>(
    path: string,
    body: TReq,
    options: DelhiveryRequestOptions = {},
  ): Promise<DelhiveryResponse<TRes>> {
    return this.request<TReq, TRes>('POST', path, body, options);
  }

  /**
   * PUT helper. Used for Ewaybill update (`PUT /api/rest/ewaybill/{waybill}/`).
   * Body is JSON-encoded by default — `contentType: 'form'` is rarely
   * needed for PUT surfaces.
   */
  async put<TReq, TRes>(
    path: string,
    body: TReq,
    options: DelhiveryRequestOptions = {},
  ): Promise<DelhiveryResponse<TRes>> {
    return this.request<TReq, TRes>('PUT', path, body, options);
  }

  /**
   * Webhook verification entry point — UNIMPLEMENTED (handled in a
   * later sprint). Kept on the surface so the public API doesn't move
   * when the webhook handler lands.
   *
   * TODO: HMAC-SHA256(rawBody, config.webhookToken) compared against
   * the `X-Delhivery-Signature` header via `crypto.timingSafeEqual`.
   */
  verifyWebhook(_input: { rawBody: Buffer; signatureHeader: string }): boolean {
    void DELHIVERY_WEBHOOK_SIGNATURE_HEADER;
    void this.config.webhookToken;
    throw new Error(
      '[DELHIVERY] verifyWebhook is not yet implemented — webhook ' +
        'handler lands in a later sprint.',
    );
  }

  /* ── Private transport ──────────────────────────────────────── */

  private async request<TReq, TRes>(
    method: DelhiveryHttpMethod,
    path: string,
    body?: TReq,
    options: DelhiveryRequestOptions = {},
  ): Promise<DelhiveryResponse<TRes>> {
    const url = this.buildUrl(path, options.query);
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;
    const contentType: DelhiveryContentType = options.contentType ?? 'json';

    const headers: Record<string, string> = {
      [DELHIVERY_AUTH_HEADER]: `${DELHIVERY_AUTH_SCHEME} ${this.config.apiToken}`,
      Accept: 'application/json',
    };
    if (method === 'POST' || method === 'PUT') {
      headers['Content-Type'] =
        contentType === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'application/json';
    }
    if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

    const payload =
      (method === 'POST' || method === 'PUT') && body !== undefined
        ? contentType === 'form'
          ? `format=json&data=${encodeURIComponent(JSON.stringify(body))}`
          : JSON.stringify(body)
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
        const respContentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        const parsed =
          respContentType.includes('application/json') && text.length > 0
            ? safeJsonParse<TRes>(text)
            : (text as unknown as TRes);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        this.logger.log(
          `[DELHIVERY] ${method} ${path} status=${status} attempt=${attempt + 1} latency_ms=${latencyMs}`,
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
          `[DELHIVERY] ${method} ${path} ERROR attempt=${attempt + 1} latency_ms=${latencyMs} ${isAbort ? 'timeout' : (err as Error).message}`,
        );
        if (attempt >= maxRetries) break;
        attempt += 1;
        await sleep(backoffMs(attempt));
      } finally {
        clearTimeout(timer);
      }
    }

    // All attempts failed at the transport layer — translate to a
    // synthetic error so the caller's error mapper can surface a
    // PARTNER_DOWN.
    throw new Error(
      `[DELHIVERY] ${method} ${path} failed after ${attempt + 1} attempts: ${(lastError as Error)?.message ?? 'unknown error'}`,
    );
  }

  private buildUrl(path: string, query?: DelhiveryRequestOptions['query']): string {
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
