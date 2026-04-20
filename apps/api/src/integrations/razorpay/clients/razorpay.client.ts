import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 30_000;

@Injectable()
export class RazorpayClient implements OnModuleInit {
  private readonly logger = new Logger(RazorpayClient.name);
  private keyId: string;
  private keySecret: string;
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

  private async request<T>(
    op: string,
    path: string,
    init: Omit<RequestInit, 'signal'> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...((init.headers as Record<string, string>) || {}),
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Razorpay ${op} failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async createOrder(params: {
    amount: number; // in paise (INR × 100)
    currency?: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{
    id: string;
    amount: number;
    currency: string;
    receipt: string;
    status: string;
  }> {
    return this.request('createOrder', '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        notes: params.notes || {},
      }),
    });
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

  async capturePayment(paymentId: string, amount: number, currency = 'INR'): Promise<{
    id: string;
    status: string;
    captured: boolean;
  }> {
    return this.request('capturePayment', `/payments/${paymentId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency }),
    });
  }

  async createRefund(paymentId: string, params: {
    amount: number; // in paise
    speed?: 'normal' | 'optimum';
    notes?: Record<string, string>;
  }): Promise<{
    id: string;
    payment_id: string;
    amount: number;
    status: string;
    speed_processed: string;
  }> {
    return this.request('createRefund', `/payments/${paymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: params.amount,
        speed: params.speed || 'normal',
        notes: params.notes || {},
      }),
    });
  }

  async fetchRefund(paymentId: string, refundId: string): Promise<{
    id: string;
    amount: number;
    status: string;
  }> {
    return this.request('fetchRefund', `/payments/${paymentId}/refunds/${refundId}`);
  }
}
