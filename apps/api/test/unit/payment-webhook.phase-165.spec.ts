import 'reflect-metadata';
import * as crypto from 'crypto';
import { PaymentWebhookController } from '../../src/modules/payments/presentation/controllers/payment-webhook.controller';

// Phase 165 — Razorpay webhook hardening coverage.
//   #3  durable ledger drops a replay even when Redis says "first" (flush).
//   #5/#6 payment.failed threads error_code / error_description / payment.id.
//   #10 payment.authorized is explicitly handled (no silent drop).

const SECRET = 'whsec_test';

function makeController(prismaOver: any = {}) {
  const paymentsFacade: any = {
    markOrderPaid: jest.fn().mockResolvedValue(undefined),
    markOrderPaymentFailed: jest.fn().mockResolvedValue(undefined),
  };
  const env: any = {
    getOptional: (k: string) => (k === 'RAZORPAY_WEBHOOK_SECRET' ? SECRET : undefined),
    getNumber: (_k: string, fb: number) => fb,
  };
  const redis: any = {
    acquireLock: jest.fn().mockResolvedValue(true), // Redis says "first delivery"
    del: jest.fn().mockResolvedValue(undefined),
  };
  const prisma: any = {
    paymentWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      ...(prismaOver.paymentWebhookEvent ?? {}),
    },
    masterOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const ctrl = new PaymentWebhookController(paymentsFacade, env, redis, prisma, audit);
  return { ctrl, paymentsFacade, prisma, redis };
}

function signed(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const req: any = { rawBody: raw };
  return { req, signature, body };
}

const capturedEvent = {
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_1',
        order_id: 'rzp_1',
        notes: { masterOrderId: 'mo-1' },
        status: 'captured',
        amount: 100_000,
        captured: true,
      },
    },
  },
};

describe('PaymentWebhookController (Phase 165)', () => {
  it('#3 — drops a replay via the durable ledger even when Redis says "first"', async () => {
    const { ctrl, paymentsFacade } = makeController({
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue({ processingStatus: 'PROCESSED' }),
      },
    });
    const { req, signature, body } = signed(capturedEvent);
    const res = await ctrl.handleRazorpayWebhook(signature, req, body, undefined);
    expect(res.message).toMatch(/durable/i);
    expect(paymentsFacade.markOrderPaid).not.toHaveBeenCalled();
  });

  it('#3 — processes + finalizes the durable row on a first delivery', async () => {
    const { ctrl, paymentsFacade, prisma } = makeController();
    const { req, signature, body } = signed(capturedEvent);
    await ctrl.handleRazorpayWebhook(signature, req, body, 'evt_123');
    expect(prisma.paymentWebhookEvent.create).toHaveBeenCalled();
    expect(paymentsFacade.markOrderPaid).toHaveBeenCalled();
    expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'PROCESSED' }) }),
    );
  });

  it('#5/#6 — payment.failed threads error_code / description / payment.id', async () => {
    const { ctrl, paymentsFacade } = makeController();
    const failedEvent = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_f',
            order_id: 'rzp_f',
            notes: { masterOrderId: 'mo-9' },
            status: 'failed',
            amount: 100_000,
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'card declined by issuing bank',
          },
        },
      },
    };
    const { req, signature, body } = signed(failedEvent);
    await ctrl.handleRazorpayWebhook(signature, req, body, undefined);
    expect(paymentsFacade.markOrderPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        masterOrderId: 'mo-9',
        failedPaymentId: 'pay_f',
        failureCode: 'BAD_REQUEST_ERROR',
        failureReason: 'card declined by issuing bank',
      }),
    );
  });

  it('#10 — payment.authorized is explicitly handled (durable IGNORED, not a silent drop)', async () => {
    const { ctrl, paymentsFacade, prisma } = makeController();
    const authEvent = {
      event: 'payment.authorized',
      payload: {
        payment: {
          entity: {
            id: 'pay_a',
            order_id: 'rzp_a',
            notes: { masterOrderId: 'mo-2' },
            status: 'authorized',
            amount: 100_000,
          },
        },
      },
    };
    const { req, signature, body } = signed(authEvent);
    const res = await ctrl.handleRazorpayWebhook(signature, req, body, undefined);
    expect(res.message).toMatch(/authorization recorded/i);
    expect(paymentsFacade.markOrderPaid).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'IGNORED' }) }),
    );
  });
});
