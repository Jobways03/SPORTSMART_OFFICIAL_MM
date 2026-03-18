import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsPublicFacade {
  async createPaymentRecord(orderId: string, amount: number): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async markPaymentSuccess(paymentId: string, providerData: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async markPaymentFailed(paymentId: string, reason: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getPaymentByOrderId(orderId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async requestRefund(paymentId: string, amount: number, reason: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getRefundStatus(refundId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async validatePaymentStatus(paymentId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }
}
