import { Injectable, Logger } from '@nestjs/common';
import { RazorpayClient } from '../clients/razorpay.client';
import {
  NormalizedPaymentCaptureResult,
  NormalizedRefundResult,
} from '../types/razorpay.types';

/**
 * RazorpayAdapter — the only place the rest of the codebase talks to
 * Razorpay. Phase 0 (PR 0.5): all money values now flow through as
 * `bigint` paise. The previous `amountInr: number → Math.round(× 100)`
 * conversions are gone, eliminating the JS-float precision risk on
 * outbound gateway calls.
 *
 * Razorpay's HTTP API accepts paise as an integer in the JSON body.
 * The intermediate `RazorpayClient` uses `number` (JS Number is safe
 * up to 2^53 paise ≈ ₹90,071,992,547,409 — beyond any single transaction
 * or settlement total). Conversion `Number(bigint)` is exact in that
 * range; above it, we throw rather than silently truncate.
 */
@Injectable()
export class RazorpayAdapter {
  private readonly logger = new Logger(RazorpayAdapter.name);
  /** Safe upper bound for `Number(bigint)` — beyond this, precision is lost. */
  private static readonly MAX_SAFE_PAISE: bigint = BigInt(Number.MAX_SAFE_INTEGER);

  constructor(private readonly client: RazorpayClient) {}

  /**
   * Convert paise BigInt to a JS Number for the HTTP client, guarding
   * against silent precision loss above 2^53. Throws on out-of-range
   * inputs so the upstream caller surfaces the bug rather than
   * shipping a wrong amount to the gateway.
   */
  private paiseToClientNumber(amountInPaise: bigint, label: string): number {
    if (amountInPaise < 0n) {
      throw new RangeError(`${label}: amountInPaise must be non-negative, got ${amountInPaise}`);
    }
    if (amountInPaise > RazorpayAdapter.MAX_SAFE_PAISE) {
      throw new RangeError(
        `${label}: amountInPaise ${amountInPaise} exceeds JS Number safe range — ` +
          `would lose precision when sent to gateway. Split the transaction or escalate.`,
      );
    }
    return Number(amountInPaise);
  }

  /**
   * Create a Razorpay order for checkout. `amountInPaise` is paise as
   * `bigint`; the adapter sends paise straight to Razorpay with no
   * rupee conversion.
   */
  async createOrder(params: {
    amountInPaise: bigint;
    receipt: string;
    notes?: Record<string, string>;
    /**
     * Phase 4 (PR 4.3) — caller-stable idempotency key.
     *
     * Razorpay dedupes POST /orders attempts that share this header
     * value. A transient 5xx + retry (PR 4.1's policy, enabled here
     * by the presence of the key) would otherwise create two orders
     * with the same receipt — both valid at the gateway, leading to
     * orphan orders in our DB and confused payment-status pollers.
     *
     * Callers derive the key from their domain entity:
     *   - Checkout:        `checkout-order-${masterOrderId}`
     *   - Wallet top-up:   `wallet-topup-${pendingTxId}`
     *   - Exchange-diff:   `exchange-diff-${returnId}`
     *
     * Optional for back-compat; callers without a key keep the
     * pre-PR single-shot behaviour.
     */
    idempotencyKey?: string;
  }): Promise<{
    providerOrderId: string;
    amountInPaise: bigint;
    currency: string;
  }> {
    if (!this.client.isConfigured) {
      throw new Error('Razorpay is not configured');
    }

    const amountForClient = this.paiseToClientNumber(
      params.amountInPaise,
      'createOrder',
    );

    const order = await this.client.createOrder({
      amount: amountForClient,
      receipt: params.receipt,
      notes: params.notes,
      idempotencyKey: params.idempotencyKey,
    });

    this.logger.log(
      `Razorpay order created: ${order.id} for ${params.amountInPaise.toString()} paise`,
    );

    return {
      providerOrderId: order.id,
      amountInPaise: BigInt(order.amount),
      currency: order.currency,
    };
  }

  /**
   * Capture an authorized payment.
   */
  async capturePayment(
    paymentId: string,
    amountInPaise: bigint,
  ): Promise<NormalizedPaymentCaptureResult> {
    const amountForClient = this.paiseToClientNumber(
      amountInPaise,
      'capturePayment',
    );
    const result = await this.client.capturePayment(paymentId, amountForClient);

    return {
      providerPaymentId: result.id,
      orderId: '',
      amountInPaise,
      currency: 'INR',
      status: result.captured ? 'captured' : 'failed',
      capturedAt: new Date(),
    };
  }

  /**
   * Fetch payment status (paise-native).
   */
  async getPaymentStatus(paymentId: string): Promise<{
    paymentId: string;
    status: string;
    amountInPaise: bigint;
    captured: boolean;
    method: string;
  }> {
    const payment = await this.client.fetchPayment(paymentId);

    return {
      paymentId: payment.id,
      status: payment.status,
      amountInPaise: BigInt(payment.amount),
      captured: payment.captured,
      method: payment.method,
    };
  }

  /**
   * Phase 0 (PR 0.1) — fetch the raw gateway snapshot needed by the
   * silent-money-loss guard at verify time. Keeps the amount in paise
   * (no rupee conversion) and preserves the `order_id` field that
   * `getPaymentStatus` strips, so callers can assert the payment was
   * captured against the razorpay_order_id they expect.
   *
   * Use this rather than reaching past the adapter to `RazorpayClient`.
   */
  async getRawPayment(paymentId: string): Promise<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    order_id: string;
    method: string;
    captured: boolean;
  }> {
    return this.client.fetchPayment(paymentId);
  }

  /**
   * Phase 3.1 (2026-05-16) — orphan-payment recovery. Returns every
   * payment Razorpay has on file for the given order id. Empty array
   * means the customer never paid. The poller uses this to detect
   * orders where the customer paid but our verify endpoint never
   * fired (browser closed mid-redirect, webhook dropped, etc.).
   */
  async fetchOrderPayments(orderId: string): Promise<
    Array<{
      paymentId: string;
      status: string;
      amountInPaise: bigint;
      captured: boolean;
      method: string;
      createdAt: Date;
    }>
  > {
    const result = await this.client.fetchOrderPayments(orderId);
    return result.items.map((p) => ({
      paymentId: p.id,
      status: p.status,
      amountInPaise: BigInt(p.amount),
      captured: p.captured,
      method: p.method,
      createdAt: new Date(p.created_at * 1000),
    }));
  }

  /**
   * Initiate a refund. `amountInPaise` is paise as `bigint`.
   *
   * Phase 4 (PR 4.2) — `idempotencyKey` is a caller-stable identifier
   * (typically the RefundInstruction id) that Razorpay uses to dedupe
   * retried POSTs. Without it, a transient 5xx + retry produces a
   * duplicate refund row at the gateway and pays the customer twice.
   * Optional for back-compat; callers without an idempotency key
   * lose the retry-safety but retain the previous one-shot behaviour.
   */
  async initiateRefund(
    paymentId: string,
    amountInPaise: bigint,
    notes?: Record<string, string>,
    opts: { idempotencyKey?: string } = {},
  ): Promise<NormalizedRefundResult> {
    const amountForClient = this.paiseToClientNumber(
      amountInPaise,
      'initiateRefund',
    );
    const result = await this.client.createRefund(paymentId, {
      amount: amountForClient,
      speed: 'normal',
      notes,
      idempotencyKey: opts.idempotencyKey,
    });

    this.logger.log(
      `Refund initiated: ${result.id} for payment ${paymentId} amount ${amountInPaise.toString()} paise`,
    );

    // Phase 96 (2026-05-23) — Phase 98 audit Gap #1 closure. Razorpay
    // returns one of {pending, processed, failed}. Pre-Phase-96 we
    // coerced any non-`processed` (which includes the normal `pending`
    // initial state for the first second) to `failed`, and the gateway
    // service treated `failed` as success — a critical accounting bug.
    // Propagate the real status; callers + webhook handler branch
    // correctly.
    const rawStatus = String(result.status ?? '').toLowerCase();
    const mappedStatus: 'processed' | 'pending' | 'failed' =
      rawStatus === 'processed'
        ? 'processed'
        : rawStatus === 'failed'
          ? 'failed'
          : 'pending';

    return {
      providerRefundId: result.id,
      paymentId: result.payment_id,
      amountInPaise,
      status: mappedStatus,
      processedAt: new Date(),
    };
  }

  /**
   * Check refund status (paise-native).
   */
  async getRefundStatus(
    paymentId: string,
    refundId: string,
  ): Promise<{ refundId: string; status: string; amountInPaise: bigint }> {
    const refund = await this.client.fetchRefund(paymentId, refundId);

    return {
      refundId: refund.id,
      status: refund.status,
      amountInPaise: BigInt(refund.amount),
    };
  }
}
