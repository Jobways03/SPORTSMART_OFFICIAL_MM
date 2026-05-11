import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ITHINK_PATHS, ITHINK_SENSITIVE_KEYS } from '../ithink.constants';
import { IThinkConfig } from '../config/ithink.config';

/**
 * Endpoint identifier — keys of ITHINK_PATHS. Using a string-literal
 * union (rather than a free-form path) means the call site cannot
 * accidentally hit an unsupported route, and lets us route Track Order
 * to its different host without per-call configuration.
 */
export type IThinkEndpoint = keyof typeof ITHINK_PATHS;

/** Request body shape iThink expects — always `{ data: { ... } }`. */
export type IThinkRequestEnvelope<T> = { data: T };

/**
 * Loose response envelope. iThink is inconsistent: some endpoints
 * return `status: "success"`, some omit `status_code`, the `data`
 * shape varies between object-keyed-by-index and arrays. Concrete
 * shapes live in the per-endpoint response DTOs; this is the lowest
 * common denominator the client always sees.
 */
export interface IThinkResponseEnvelope<T = unknown> {
  status?: string;
  status_code?: number;
  html_message?: string;
  message?: string;
  data?: T;
  /** Get Airwaybill uses this key (note the capital A and space). */
  ['Awb list']?: unknown;
  /** Add Warehouse returns warehouse_id at top level, not under data. */
  warehouse_id?: number;
  /** Print Label / Manifest / Invoice all return a top-level file_name. */
  file_name?: string;
}

/** Raised when iThink returns a non-success body (status_code !== 200). */
export class IThinkApiError extends Error {
  constructor(
    public readonly endpoint: IThinkEndpoint,
    public readonly statusCode: number | undefined,
    public readonly htmlMessage: string | undefined,
    public readonly responseBody: unknown,
  ) {
    super(
      `iThink ${endpoint} failed: status_code=${statusCode ?? 'unknown'} ${htmlMessage ?? ''}`.trim(),
    );
    this.name = 'IThinkApiError';
  }
}

/**
 * Thin POST-only HTTP wrapper for iThink. Responsibilities:
 *
 *  1. Inject `access_token` + `secret_key` into the request body.
 *  2. Pick the right host (Track Order uses a different one in prod).
 *  3. Enforce a hard timeout via AbortController.
 *  4. Retry on transient network failures with exponential backoff.
 *  5. Scrub credentials from logs even at debug level.
 *  6. Translate non-200 bodies into `IThinkApiError` so callers can
 *     branch on `IThinkApiError` vs `ServiceUnavailableException`.
 *
 * No global axios/got — we use `fetch` (Node 18+, available in 24)
 * so there's no extra dependency and the surface stays small.
 */
@Injectable()
export class IThinkClient {
  private readonly logger = new Logger(IThinkClient.name);

  constructor(private readonly config: IThinkConfig) {}

  /**
   * POST a `data`-wrapped body to an iThink endpoint and return the
   * parsed envelope. Credentials are injected here; callers must not
   * pass them in `body`.
   */
  async post<TResponse = unknown>(
    endpoint: IThinkEndpoint,
    body: Record<string, unknown>,
  ): Promise<IThinkResponseEnvelope<TResponse>> {
    if (!this.config.isConfigured) {
      throw new ServiceUnavailableException(
        'iThink Logistics is not configured (missing access_token / secret_key)',
      );
    }

    const url = this.resolveUrl(endpoint);
    const envelope: IThinkRequestEnvelope<Record<string, unknown>> = {
      data: {
        ...body,
        ...this.config.getAuthPayload(),
      },
    };

    const maxAttempts = this.config.httpMaxRetries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.attempt<TResponse>(endpoint, url, envelope, attempt);
      } catch (error) {
        lastError = error;
        // Don't retry application-level failures — those are deterministic
        // (bad waybill, missing warehouse, etc.). Only retry transport
        // errors and 5xx-ish failures we surfaced as ServiceUnavailable.
        if (error instanceof IThinkApiError) throw error;
        if (attempt >= maxAttempts) break;
        const backoffMs = this.computeBackoff(attempt);
        this.logger.warn(
          `iThink ${endpoint} attempt ${attempt}/${maxAttempts} failed (${this.describeError(error)}); retrying in ${backoffMs}ms`,
        );
        await this.sleep(backoffMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new InternalServerErrorException(
          `iThink ${endpoint} failed after ${maxAttempts} attempts`,
        );
  }

  /** Execute one attempt with timeout + envelope handling. */
  private async attempt<TResponse>(
    endpoint: IThinkEndpoint,
    url: string,
    envelope: IThinkRequestEnvelope<Record<string, unknown>>,
    attempt: number,
  ): Promise<IThinkResponseEnvelope<TResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.httpTimeoutMs,
    );

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } catch (error) {
      // AbortError, ECONNREFUSED, DNS, TLS — all transport-layer.
      throw new ServiceUnavailableException(
        `iThink ${endpoint} transport error: ${this.describeError(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = Date.now() - startedAt;
    const rawText = await response.text();

    let parsed: IThinkResponseEnvelope<TResponse>;
    try {
      // iThink sometimes returns JSON with HTML embedded in `html_message`
      // when an error occurs — JSON.parse still succeeds because the HTML
      // is inside a string field.
      parsed = rawText ? (JSON.parse(rawText) as IThinkResponseEnvelope<TResponse>) : {};
    } catch (error) {
      this.logger.error(
        `iThink ${endpoint} non-JSON response (attempt ${attempt}, ${elapsedMs}ms, http ${response.status}): ${rawText.slice(0, 500)}`,
      );
      throw new InternalServerErrorException(
        `iThink ${endpoint} returned non-JSON (http ${response.status})`,
      );
    }

    this.logger.debug(
      `iThink ${endpoint} http=${response.status} status=${parsed.status ?? '-'} code=${parsed.status_code ?? '-'} elapsed=${elapsedMs}ms attempt=${attempt}`,
    );

    // iThink's error convention is unusual: it returns `status_code: 200`
    // on application failures too, with the actual outcome encoded in
    // `status: "error"` and `message: "..."`. So we MUST check `status`
    // first — `status_code` alone is not enough to distinguish success.
    //
    //   { "status": "error", "status_code": 200, "message": "Access Token Not Match." }
    //
    // would silently pass as success if we only branched on status_code.
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `iThink ${endpoint} http ${response.status}`,
      );
    }

    if (parsed.status && parsed.status !== 'success') {
      throw new IThinkApiError(
        endpoint,
        parsed.status_code,
        parsed.html_message ?? parsed.message,
        parsed,
      );
    }

    if (parsed.status_code !== undefined && parsed.status_code !== 200) {
      throw new IThinkApiError(
        endpoint,
        parsed.status_code,
        parsed.html_message ?? parsed.message,
        parsed,
      );
    }

    return parsed;
  }

  /**
   * Pick the host based on which endpoint we're calling. Only Track
   * Order uses a different host in production — in sandbox both
   * env vars point at the pre-alpha host so this collapses naturally.
   */
  private resolveUrl(endpoint: IThinkEndpoint): string {
    const host = endpoint === 'TRACK_ORDER' ? this.config.trackUrl : this.config.baseUrl;
    return `${host.replace(/\/$/, '')}${ITHINK_PATHS[endpoint]}`;
  }

  /** 250ms → 500ms → 1s with jitter. Capped by ITHINK_HTTP_MAX_RETRIES. */
  private computeBackoff(attempt: number): number {
    const base = 250 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 100);
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Best-effort error description for logs without leaking stack details. */
  private describeError(error: unknown): string {
    if (error instanceof Error) {
      const name = error.name ?? 'Error';
      return `${name}: ${error.message}`;
    }
    return String(error);
  }

  /**
   * Public helper exposed for unit tests and the body-scrub logger
   * filter elsewhere. Returns a deep-cloned object with sensitive
   * keys replaced by '***'. Safe to call on any depth of nested object.
   */
  static scrubForLog<T>(value: T): T {
    const sensitive = new Set<string>(ITHINK_SENSITIVE_KEYS);
    const walk = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(walk);
      if (input && typeof input === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
          out[k] = sensitive.has(k) ? '***' : walk(v);
        }
        return out;
      }
      return input;
    };
    return walk(value) as T;
  }
}
