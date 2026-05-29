import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Phase 4 (PR 4.1) — retry policy constants. GET endpoints retry
 * automatically; POSTs do NOT (PR 4.2 will plumb idempotency keys and
 * flip POSTs to retry safely). Backoff is exponential with full
 * jitter — Random(0, base*2^attempt) capped at maxMs. Full jitter
 * avoids the thundering-herd that fixed exponential backoff produces
 * when many sessions all retry at the same canonical times.
 */
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 5_000;

/**
 * HTTP status codes that warrant a retry. 5xx and 429 are transient
 * by definition; 4xx (other than 429) indicates a caller-side bug
 * (missing field, wrong amount) that no retry will fix.
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Network-layer errors that warrant a retry. `TypeError` is what
 * Node's fetch throws on DNS / connect / TLS failure. `AbortError`
 * is the AbortSignal.timeout firing.
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class RazorpayClient implements OnModuleInit {
  private readonly logger = new Logger(RazorpayClient.name);
  private keyId!: string;
  private keySecret!: string;
  private baseUrl = 'https://api.razorpay.com/v1';

  onModuleInit() {
    this.keyId = process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    if (!this.keyId || !this.keySecret) {
      this.logger.warn('Razorpay credentials not configured — payment operations will fail');
    }
  }

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  get isConfigured(): boolean {
    return !!(this.keyId && this.keySecret);
  }

  /**
   * Phase 69 (2026-05-22) — Phase 66 audit Gap #9 fix. The checkout
   * service previously read `process.env.RAZORPAY_KEY_*` directly in
   * its verify-payment and place-order paths. Now exposed through
   * the same client the adapter already uses, so every Razorpay
   * config access flows through one boundary (single test seam,
   * single source of truth for what "configured" means).
   *
   * Both getters return empty string when unset rather than throwing
   * — the caller already has a fail-closed branch keyed on empty
   * string (`if (!keySecret) throw` in verifyPayment) and we want to
   * preserve the exact failure mode.
   */
  getKeyId(): string {
    return this.keyId;
  }

  getKeySecret(): string {
    return this.keySecret;
  }

  /**
   * Internal HTTP call. `retryable` defaults to true for GETs and false
   * for everything else — a POST/PATCH/DELETE retry without an
   * idempotency key risks double-writes.
   *
   * Phase 4 (PR 4.2) — callers can opt INTO retry on a write by
   * passing an `idempotencyKey`. The key is sent as
   * `X-Razorpay-Idempotency-Key`; Razorpay dedupes by it, so retries
   * of the same key produce one effect at the gateway.
   *
   * The fetch is wrapped in `AbortSignal.timeout(...)` so a hung
   * connection doesn't pin the event loop past REQUEST_TIMEOUT_MS.
   */
  private async request<T>(
    op: string,
    path: string,
    init: Omit<RequestInit, 'signal'> = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<T> {
    const method = ((init as RequestInit).method ?? 'GET').toUpperCase();
    const headers = { ...((init.headers as Record<string, string>) || {}) };
    if (opts.idempotencyKey) {
      // Spelled per Razorpay v1 docs. Sent on every retry so the
      // gateway can dedupe across attempts.
      headers['X-Razorpay-Idempotency-Key'] = opts.idempotencyKey;
    }
    // Writes retry only when we have an idempotency key; reads always retry.
    const retryable = method === 'GET' || !!opts.idempotencyKey;
    return this.requestWithRetry<T>(op, path, { ...init, headers }, retryable);
  }

  private async requestWithRetry<T>(
    op: string,
    path: string,
    init: Omit<RequestInit, 'signal'>,
    retryable: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...((init.headers as Record<string, string>) || {}),
    };

    let lastError: unknown;
    const maxAttempts = retryable ? MAX_ATTEMPTS : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          if (retryable && isRetryableStatus(res.status) && attempt < maxAttempts) {
            this.logger.warn(
              `Razorpay ${op} attempt ${attempt}/${maxAttempts} got ${res.status}, retrying...`,
            );
            await sleep(this.jitteredBackoff(attempt));
            continue;
          }
          const body = await res.text();
          throw new Error(`Razorpay ${op} failed (${res.status}): ${body}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // If it's the synthesised "Razorpay X failed (NNN)" Error from
        // the !res.ok branch above, propagate immediately — the
        // status was already considered for retry inside the loop.
        if (err instanceof Error && /Razorpay .* failed \(\d+\)/.test(err.message)) {
          throw err;
        }
        if (retryable && isRetryableError(err) && attempt < maxAttempts) {
          this.logger.warn(
            `Razorpay ${op} attempt ${attempt}/${maxAttempts} threw ${(err as Error).message}, retrying...`,
          );
          await sleep(this.jitteredBackoff(attempt));
          continue;
        }
        throw err;
      }
    }
    // Unreachable if maxAttempts >= 1; satisfies TS exhaustiveness.
    throw lastError instanceof Error ? lastError : new Error(`Razorpay ${op} exhausted retries`);
  }

  /**
   * Full-jitter exponential backoff: random sample from
   * [0, min(MAX, BASE * 2^(attempt-1))]. Spreads retry-wave arrivals
   * so many clients failing at once don't all retry in lockstep.
   */
  private jitteredBackoff(attempt: number): number {
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
    return Math.floor(Math.random() * ceiling);
  }

  async createOrder(params: {
    amount: number; // in paise (INR × 100)
    currency?: string;
    receipt: string;
    notes?: Record<string, string>;
    /**
     * Phase 4 (PR 4.2) — when set, the call is retried on transient
     * failures and Razorpay dedupes attempts that share this key.
     * Caller derives a stable per-aggregate value (master-order id,
     * wallet-topup receipt, etc.).
     */
    idempotencyKey?: string;
  }): Promise<{
    id: string;
    amount: number;
    currency: string;
    receipt: string;
    status: string;
  }> {
    return this.request(
      'createOrder',
      '/orders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency || 'INR',
          receipt: params.receipt,
          notes: params.notes || {},
        }),
      },
      { idempotencyKey: params.idempotencyKey },
    );
  }

  async fetchPayment(paymentId: string): Promise<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    order_id: string;
    method: string;
    captured: boolean;
  }> {
    return this.request('fetchPayment', `/payments/${paymentId}`);
  }

  /**
   * Phase 3.1 (2026-05-16) — orphan-payment recovery.
   *
   * Razorpay endpoint: GET /orders/:orderId/payments → list of every
   * payment attempt made against the order. We use this when our
   * MasterOrder has a `razorpayOrderId` but no `razorpayPaymentId` —
   * which means the customer paid but their browser closed before our
   * verify endpoint fired AND the webhook never arrived. The poller
   * picks up these orphans and confirms via the API.
   *
   * Returns the array of payments wrapped in `items` (the same shape
   * the Razorpay REST API returns). Empty array if no payments yet —
   * legitimate when the customer abandoned without paying.
   */
  async fetchOrderPayments(orderId: string): Promise<{
    count: number;
    items: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      order_id: string;
      method: string;
      captured: boolean;
      created_at: number;
    }>;
  }> {
    return this.request('fetchOrderPayments', `/orders/${orderId}/payments`);
  }

  async capturePayment(
    paymentId: string,
    amount: number,
    currency = 'INR',
    opts: { idempotencyKey?: string } = {},
  ): Promise<{
    id: string;
    status: string;
    captured: boolean;
  }> {
    return this.request(
      'capturePayment',
      `/payments/${paymentId}/capture`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency }),
      },
      { idempotencyKey: opts.idempotencyKey },
    );
  }

  async createRefund(paymentId: string, params: {
    amount: number; // in paise
    speed?: 'normal' | 'optimum';
    notes?: Record<string, string>;
    /**
     * Phase 4 (PR 4.2) — caller-stable id (typically the
     * `RefundInstruction.id`) so Razorpay dedupes attempts. Without
     * this, a retried POST creates a duplicate refund.
     */
    idempotencyKey?: string;
  }): Promise<{
    id: string;
    payment_id: string;
    amount: number;
    status: string;
    speed_processed: string;
  }> {
    return this.request(
      'createRefund',
      `/payments/${paymentId}/refunds`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amount,
          speed: params.speed || 'normal',
          notes: params.notes || {},
        }),
      },
      { idempotencyKey: params.idempotencyKey },
    );
  }

  async fetchRefund(paymentId: string, refundId: string): Promise<{
    id: string;
    amount: number;
    status: string;
  }> {
    return this.request('fetchRefund', `/payments/${paymentId}/refunds/${refundId}`);
  }
}
