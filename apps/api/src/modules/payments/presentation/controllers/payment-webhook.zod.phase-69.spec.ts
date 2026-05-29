// Phase 69 (2026-05-22) — Phase 66 audit Gap #23.
//
// Defence-in-depth Zod validation of the Razorpay webhook payload
// after the HMAC pass. Catches malformed payloads (manual-replay
// tools, payload-shape drift after a Razorpay API update) at the
// boundary instead of letting the downstream `Cannot read property
// of undefined` surface bubble up.

import 'reflect-metadata';
import * as crypto from 'crypto';
import { PaymentWebhookController } from './payment-webhook.controller';

const SECRET = 'whsec_zod_phase_69';

function sign(rawBody: string): string {
  return crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

function buildController() {
  const env = {
    getOptional: jest.fn((key: string) => {
      if (key === 'RAZORPAY_WEBHOOK_SECRET') return SECRET;
      return undefined;
    }),
    getNumber: jest.fn((_key: string, fallback?: number) => fallback ?? 300),
  } as any;
  const redis: any = {
    acquireLock: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const paymentsFacade: any = {
    markOrderPaid: jest.fn().mockResolvedValue(undefined),
    markOrderPaymentFailed: jest.fn().mockResolvedValue(undefined),
  };
  return new PaymentWebhookController(paymentsFacade, env, redis);
}

function makeReq(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  return { rawBody: raw } as any;
}

describe('PaymentWebhookController — Zod payload validation (Phase 69 — Gap #23)', () => {
  it('rejects payload missing top-level `event`', async () => {
    const body = {
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_1', status: 'captured', amount: 100, captured: true } } },
    };
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));
    const ctrl = buildController();
    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringContaining('event'),
    });
  });

  it('rejects payment.entity with negative amount', async () => {
    const body = {
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_1', status: 'captured', amount: -1, captured: true } } },
    };
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));
    const ctrl = buildController();
    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringContaining('amount'),
    });
  });

  it('rejects non-integer amount (defense against gateway drift)', async () => {
    const body = {
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_1', status: 'captured', amount: 99.5, captured: true } } },
    };
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));
    const ctrl = buildController();
    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringContaining('amount'),
    });
  });

  it('accepts a valid payload (sanity check)', async () => {
    const body = {
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: 'pay_ok',
            status: 'captured',
            amount: 5000,
            captured: true,
            order_id: 'order_ok',
            notes: { masterOrderId: 'mo-ok' },
          },
        },
      },
    };
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));
    const ctrl = buildController();
    const out = await ctrl.handleRazorpayWebhook(signature, req, body);
    expect(out.success).toBe(true);
  });

  it('rejects payload with non-string event', async () => {
    const body = {
      event: 123,
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_1', status: 'captured', amount: 100, captured: true } } },
    };
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));
    const ctrl = buildController();
    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringContaining('event'),
    });
  });
});
