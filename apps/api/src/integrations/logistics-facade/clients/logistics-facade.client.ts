import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LOGISTICS_FACADE_CONFIG,
  LOGISTICS_FACADE_REQUEST_TIMEOUT_MS,
  LOGISTICS_FACADE_RETRY_BASE_DELAY_MS,
  LOGISTICS_FACADE_RETRY_MAX_ATTEMPTS,
} from '../logistics-facade.constants';
import type { LogisticsFacadeConfig } from '../config/logistics-facade.config';

export interface FacadeHttpResponse<T> {
  status: number;
  body: T;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin HTTP transport for the logistics-facade. Mirrors RazorpayClient
 * in shape:
 *   • timeout via AbortSignal.timeout
 *   • full-jitter exponential backoff on transient errors
 *   • GETs retry automatically; POSTs only retry when called with an
 *     idempotencyKey (the facade's PartnersController uses request
 *     bodies that include the `name` field as natural dedupe key).
 *
 * Authentication is the facade's `ApiKeyAuthGuard` shape:
 * `Authorization: ApiKey <token>`.
 */
@Injectable()
export class LogisticsFacadeClient {
  private readonly logger = new Logger(LogisticsFacadeClient.name);

  constructor(
    @Inject(LOGISTICS_FACADE_CONFIG)
    private readonly config: LogisticsFacadeConfig,
  ) {}

  get baseUrl(): string {
    return this.requireConfigured().apiUrl.replace(/\/$/, '');
  }

  private get authHeader(): string {
    return `ApiKey ${this.requireConfigured().apiKey}`;
  }

  /**
   * `apiUrl`/`apiKey` are optional at boot (unset = facade disabled, so
   * apps/api still starts). Any real request needs them — surface a clear,
   * actionable error here rather than a cryptic "cannot read 'replace' of
   * undefined" deeper in the fetch path. Only reached on an actual request.
   */
  private requireConfigured(): { apiUrl: string; apiKey: string } {
    const { apiUrl, apiKey } = this.config;
    if (!apiUrl || !apiKey) {
      throw new Error(
        'Logistics facade is not configured: set LOGISTICS_FACADE_URL and ' +
          'LOGISTICS_FACADE_API_KEY to use logistics-partner features.',
      );
    }
    return { apiUrl, apiKey };
  }

  async get<T>(path: string): Promise<FacadeHttpResponse<T>> {
    return this.requestWithRetry<T>('GET', path, undefined, true);
  }

  async post<TBody, TResponse>(
    path: string,
    body: TBody,
    opts: { idempotencyKey?: string } = {},
  ): Promise<FacadeHttpResponse<TResponse>> {
    const retryable = !!opts.idempotencyKey;
    return this.requestWithRetry<TResponse>('POST', path, body, retryable);
  }

  private async requestWithRetry<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    retryable: boolean,
  ): Promise<FacadeHttpResponse<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const maxAttempts = retryable ? LOGISTICS_FACADE_RETRY_MAX_ATTEMPTS : 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const init: RequestInit = {
          method,
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
            ...(method === 'POST'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          signal: AbortSignal.timeout(
            this.config.timeoutMs ?? LOGISTICS_FACADE_REQUEST_TIMEOUT_MS,
          ),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        };
        const response = await fetch(url, init);
        const text = await response.text();
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        if (retryable && isRetryableStatus(response.status) && attempt < maxAttempts - 1) {
          const delay = this.backoffDelay(attempt);
          this.logger.warn(
            `Facade ${method} ${path} → ${response.status}; retry in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        return {
          status: response.status,
          body: parsed as T,
        };
      } catch (err) {
        lastErr = err;
        if (retryable && isRetryableError(err) && attempt < maxAttempts - 1) {
          const delay = this.backoffDelay(attempt);
          this.logger.warn(
            `Facade ${method} ${path} threw ${(err as Error)?.message}; retry in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    // Should not be reachable; throw to satisfy TS.
    throw lastErr ?? new Error('LogisticsFacadeClient retry loop exhausted');
  }

  private backoffDelay(attempt: number): number {
    const cap = 5_000;
    const base = LOGISTICS_FACADE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    return Math.min(Math.floor(Math.random() * base), cap);
  }
}
