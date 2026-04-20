import { Injectable, Logger } from '@nestjs/common';
import { RazorpayClient } from '../clients/razorpay.client';
import {
  NormalizedPaymentCaptureResult,
  NormalizedRefundResult,
} from '../types/razorpay.types';

@Injectable()
export class RazorpayAdapter {
  private readonly logger = new Logger(RazorpayAdapter.name);

  constructor(private readonly client: RazorpayClient) {}

  /**
   * Create a Razorpay order for checkout.
   * Amount is in INR (rupees) — adapter converts to paise.
   */
  async createOrder(params: {
    amountInr: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{
    providerOrderId: string;
    amount: number;
    currency: string;
  }> {
    if (!this.client.isConfigured) {
      throw new Error('Razorpay is not configured');
    }

    const amountInPaise = Math.round(params.amountInr * 100);
    const order = await this.client.createOrder({
      amount: amountInPaise,
      receipt: params.receipt,
      notes: params.notes,
    });

    this.logger.log(`Razorpay order created: ${order.id} for ₹${params.amountInr}`);

    return {
      providerOrderId: order.id,
      amount: params.amountInr,
      currency: order.currency,
    };
  }

  /**
   * Capture an authorized payment.
   */
  async capturePayment(
    paymentId: string,
    amountInr: number,
  ): Promise<NormalizedPaymentCaptureResult> {
    const amountInPaise = Math.round(amountInr * 100);
    const result = await this.client.capturePayment(paymentId, amountInPaise);

    return {
      providerPaymentId: result.id,
      orderId: '',
      amount: amountInr,
      currency: 'INR',
      status: result.captured ? 'captured' : 'failed',
      capturedAt: new Date(),
    };
  }

  /**
   * Fetch payment status.
   */
  async getPaymentStatus(paymentId: string): Promise<{
    paymentId: string;
    status: string;
    amount: number;
    captured: boolean;
    method: string;
  }> {
    const payment = await this.client.fetchPayment(paymentId);

    return {
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount / 100, // paise to INR
      captured: payment.captured,
      method: payment.method,
    };
  }

  /**
   * Initiate a refund. Amount is in INR (rupees).
   */
  async initiateRefund(
    paymentId: string,
    amountInr: number,
    notes?: Record<string, string>,
  ): Promise<NormalizedRefundResult> {
    const amountInPaise = Math.round(amountInr * 100);
    const result = await this.client.createRefund(paymentId, {
      amount: amountInPaise,
      speed: 'normal',
      notes,
    });

    this.logger.log(
      `Refund initiated: ${result.id} for payment ${paymentId} amount ₹${amountInr}`,
    );

    return {
      providerRefundId: result.id,
      paymentId: result.payment_id,
      amount: amountInr,
      status: result.status === 'processed' ? 'processed' : 'failed',
      processedAt: new Date(),
    };
  }

  /**
   * Check refund status.
   */
  async getRefundStatus(
    paymentId: string,
    refundId: string,
  ): Promise<{ refundId: string; status: string; amount: number }> {
    const refund = await this.client.fetchRefund(paymentId, refundId);

    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100,
    };
  }
}
