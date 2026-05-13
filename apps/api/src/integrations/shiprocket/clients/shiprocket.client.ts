import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Phase 4 (PR 4.8) — retry policy constants. Same shape as Razorpay
 * (PR 4.1), WhatsApp (PR 4.5), iThink (PR 4.6): max 3 attempts,
 * full-jitter exponential backoff capped at 5s. Composes with the
 * pre-existing 401-refresh path — a 401 triggers token refresh + one
 * retry; a subsequent 5xx then triggers this retry loop.
 *
 * Shiprocket's outbound write API doesn't expose an idempotency-key
 * header. A retry that lands AFTER the first call partially
 * succeeded can produce a duplicate shipment — documented as the
 * lesser evil vs silent drop. The application layer (sub-order
 * stamps shiprocket_order_id after success) detects duplicates on
 * the next reconciliation pass.
 */
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 5_000;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function jitteredBackoff(attempt: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ShiprocketClient implements OnModuleInit {
  private readonly logger = new Logger(ShiprocketClient.name);
  private baseUrl = 'https://apiv2.shiprocket.in/v1/external';
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;

  onModuleInit() {
    if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
      this.logger.warn('Shiprocket credentials not configured — shipping operations will fail');
    }
  }

  get isConfigured(): boolean {
    return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
  }

  private async authenticate(forceRefresh = false): Promise<string> {
    // Reuse token if still valid (tokens last 10 days). forceRefresh is
    // set by the 401-retry path in `request()` — Shiprocket can
    // invalidate a token before our 9-day grace window (user rotates
    // credentials, admin revokes, etc.), so we need to be able to drop
    // the cached token and re-login on demand.
    if (
      !forceRefresh &&
      this.token &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt > new Date()
    ) {
      return this.token;
    }

    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket auth failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    this.token = data.token;
    // Token valid for ~10 days, refresh after 9
    this.tokenExpiresAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);

    return this.token!;
  }

  /**
   * Authenticated fetch wrapper. Adds the Bearer token, enforces a
   * 30s per-attempt timeout, retries once on 401 after forcing a
   * token refresh, and (Phase 4, PR 4.8) retries on 5xx / 429 /
   * transport-error with full-jitter exponential backoff up to
   * MAX_ATTEMPTS.
   *
   * Layered semantics:
   *   - 401 → token refresh + immediate single retry (existing).
   *     If THAT retry also fails on 5xx, the outer retry loop picks
   *     up — this is the "credential rotation racing with a gateway
   *     blip" case.
   *   - 5xx / 429 / network → exponential backoff retry (up to 3).
   *   - 4xx (other than 401, 429) → fail fast — same as Razorpay /
   *     WhatsApp / iThink classification.
   */
  private async request<T>(
    op: string,
    path: string,
    init: Omit<RequestInit, 'signal'> = {},
  ): Promise<T> {
    const doFetch = async (token: string): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string>) || {}),
      };
      return fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let token = await this.authenticate();
        let res = await doFetch(token);

        // 401 → existing one-shot token refresh. If the refreshed
        // request still 401s (genuinely bad credentials), fall
        // through to the !res.ok branch which throws.
        if (res.status === 401) {
          this.token = null;
          this.tokenExpiresAt = null;
          token = await this.authenticate(true);
          res = await doFetch(token);
        }

        if (!res.ok) {
          if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
            this.logger.warn(
              `Shiprocket ${op} attempt ${attempt}/${MAX_ATTEMPTS} got ${res.status}, retrying...`,
            );
            await sleep(jitteredBackoff(attempt));
            continue;
          }
          const body = await res.text();
          throw new Error(`Shiprocket ${op} failed (${res.status}): ${body}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // Synthesised "Shiprocket X failed (NNN)" error from the
        // !res.ok branch — status was already considered for retry
        // inside the loop, so propagate immediately.
        if (err instanceof Error && /Shiprocket .* failed \(\d+\)/.test(err.message)) {
          throw err;
        }
        if (isRetryableError(err) && attempt < MAX_ATTEMPTS) {
          this.logger.warn(
            `Shiprocket ${op} attempt ${attempt}/${MAX_ATTEMPTS} threw ${(err as Error).message}, retrying...`,
          );
          await sleep(jitteredBackoff(attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Shiprocket ${op} exhausted retries`);
  }

  async createOrder(params: {
    order_id: string;
    order_date: string;
    pickup_location: string;
    billing_customer_name: string;
    billing_address: string;
    billing_city: string;
    billing_pincode: string;
    billing_state: string;
    billing_country: string;
    billing_phone: string;
    shipping_is_billing: boolean;
    order_items: Array<{
      name: string;
      sku: string;
      units: number;
      selling_price: number;
    }>;
    payment_method: string;
    sub_total: number;
    length: number;
    breadth: number;
    height: number;
    weight: number;
  }): Promise<{
    order_id: string;
    shipment_id: string;
    status: string;
  }> {
    return this.request('createOrder', '/orders/create/adhoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async generateAWB(shipmentId: string, courierId?: number): Promise<{
    awb_assign_status: number;
    response: {
      data: {
        awb_code: string;
        courier_name: string;
      };
    };
  }> {
    const body: any = { shipment_id: shipmentId };
    if (courierId) body.courier_id = courierId;

    return this.request('generateAWB', '/courier/assign/awb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async trackShipment(awb: string): Promise<{
    tracking_data: {
      track_status: number;
      shipment_status: number;
      shipment_track: Array<{
        current_status: string;
        delivered_date: string;
        origin: string;
        destination: string;
      }>;
      shipment_track_activities: Array<{
        date: string;
        status: string;
        activity: string;
        location: string;
      }>;
    };
  }> {
    return this.request('tracking', `/courier/track/awb/${awb}`);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request<void>('cancelOrder', '/orders/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [orderId] }),
    });
  }

  async schedulePickup(shipmentId: string): Promise<{
    pickup_status: number;
    response: { pickup_scheduled_date: string };
  }> {
    return this.request('schedulePickup', '/courier/generate/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    });
  }
}
