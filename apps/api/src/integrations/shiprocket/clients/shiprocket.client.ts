import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;

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
   * 30s timeout (so a hung Shiprocket call can't pin an order-shipping
   * request indefinitely), and retries once on 401 after forcing a
   * token refresh. Without the 401 retry, any admin-side credential
   * rotation or Shiprocket-initiated revoke would break every in-flight
   * request until the next process restart.
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

    let token = await this.authenticate();
    let res = await doFetch(token);

    if (res.status === 401) {
      // Stale token — force refresh and retry once.
      this.token = null;
      this.tokenExpiresAt = null;
      token = await this.authenticate(true);
      res = await doFetch(token);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket ${op} failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<T>;
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
