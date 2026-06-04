import 'reflect-metadata';
import * as crypto from 'crypto';
import { PaymentWebhookController } from './payment-webhook.controller';

/**
 * Phase 4 (PR 4.7) — Razorpay webhook timestamp replay window.
 *
 * Pre-PR the only replay defence was a 24-hour Redis idempotency
 * claim keyed on payment.id. After 24h the claim expires, and a
 * captured legitimate payload (from leaked logs, a misconfigured
 * proxy, or a TLS-strip-pass intermediary) could be replayed to
 * trigger event side-effects again — even though the downstream
 * `markOrderPaid` has its own TOCTOU close, the audit trail and
 * event-emission paths would fire a second time.
 *
 * Stripe's webhook design includes a signed timestamp + a window
 * check; Razorpay's signed payload doesn't have a signed-header
 * timestamp, but every event body carries `created_at` (Unix
 * seconds). PR 4.7 tightens the replay window from 24h to ±5min
 * by validating that payload.created_at is within
 * `RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS` (default 300) of the
 * server clock.
 *
 * Clock-skew tolerance is symmetric: events too far in the past
 * (replay attack) and too far in the future (forged clock) are
 * both rejected.
 */

const SECRET = 'whsec_test_replay_window_phase_4_7';

function sign(rawBody: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function buildController(opts: {
  windowSeconds?: number;
  markOrderPaid?: jest.Mock;
} = {}) {
  const env = {
    getOptional: jest.fn((key: string) => {
      if (key === 'RAZORPAY_WEBHOOK_SECRET') return SECRET;
      return undefined;
    }),
    getNumber: jest.fn((key: string, fallback?: number) => {
      if (key === 'RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS') {
        return opts.windowSeconds ?? 300;
      }
      return fallback ?? 0;
    }),
  } as any;
  const redis: any = {
    acquireLock: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const paymentsFacade: any = {
    markOrderPaid: opts.markOrderPaid ?? jest.fn().mockResolvedValue(undefined),
    markOrderFailed: jest.fn().mockResolvedValue(undefined),
  };
  const prisma: any = {
    paymentWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    masterOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return new PaymentWebhookController(paymentsFacade, env, redis, prisma);
}

function buildPayload(opts: {
  paymentId?: string;
  createdAt?: number; // Unix seconds; omit for missing-timestamp case
  masterOrderId?: string;
}): any {
  const body: any = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: opts.paymentId ?? 'pay_test_1',
          status: 'captured',
          amount: 10000,
          captured: true,
          order_id: 'order_test_1',
          notes: { masterOrderId: opts.masterOrderId ?? 'mo-1' },
        },
      },
    },
  };
  if (opts.createdAt !== undefined) body.created_at = opts.createdAt;
  return body;
}

function makeReq(body: any) {
  const raw = Buffer.from(JSON.stringify(body));
  return { rawBody: raw } as any;
}

describe('PaymentWebhookController — replay-window check (PR 4.7)', () => {
  it('accepts an event within the 5-minute window', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now - 30 });
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const markOrderPaid = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({ markOrderPaid });

    const result = await ctrl.handleRazorpayWebhook(signature, req, body);

    expect(result.success).toBe(true);
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
  });

  it('rejects an event older than the 5-minute window (replay attack)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now - 10 * 60 }); // 10 min ago
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const markOrderPaid = jest.fn();
    const ctrl = buildController({ markOrderPaid });

    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/replay window|timestamp/i),
    });

    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it('rejects an event too far in the future (forged clock)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now + 10 * 60 }); // 10 min ahead
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const ctrl = buildController({});

    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/replay window|timestamp/i),
    });
  });

  it('accepts events at the boundary (exactly 5 min in past)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now - 300 }); // exactly 5 min
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const markOrderPaid = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({ markOrderPaid });

    const result = await ctrl.handleRazorpayWebhook(signature, req, body);
    expect(result.success).toBe(true);
  });

  it('accepts events without a created_at field (graceful — logs warn, proceeds)', async () => {
    // Some Razorpay payloads (older API versions, manual replay tools)
    // may omit `created_at`. Don't break legitimate webhooks if the
    // field is missing — fall through to the other defences (Redis
    // claim, downstream TOCTOU).
    const body = buildPayload({}); // no createdAt
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const markOrderPaid = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({ markOrderPaid });

    const result = await ctrl.handleRazorpayWebhook(signature, req, body);
    expect(result.success).toBe(true);
    expect(markOrderPaid).toHaveBeenCalled();
  });

  it('honours the RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS override', async () => {
    // Tighter 60-second window — used in high-security environments
    // where 5 minutes feels permissive.
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now - 120 }); // 2 min ago — outside 60s window
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const ctrl = buildController({ windowSeconds: 60 });

    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/replay window|timestamp/i),
    });
  });

  it('rejects BEFORE the Redis idempotency claim — saves a Redis round-trip on replay', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = buildPayload({ createdAt: now - 10 * 60 });
    const req = makeReq(body);
    const signature = sign(req.rawBody.toString('utf8'));

    const ctrl = buildController({});
    // Spy on Redis claim — should NEVER be called on a stale event.
    const acquireSpy = jest.spyOn(
      (ctrl as any).redis,
      'acquireLock',
    );

    await expect(
      ctrl.handleRazorpayWebhook(signature, req, body),
    ).rejects.toThrow();

    expect(acquireSpy).not.toHaveBeenCalled();
  });
});
