import * as crypto from 'crypto';
import { PaymentWebhookController } from './payment-webhook.controller';

// Direct construction (no NestJS test module) to avoid pulling
// `OrdersPublicFacade` -> `orders.service.ts` into compilation, which
// has separate pre-existing Prisma client drift tracked under Phase 2.

const WEBHOOK_SECRET = 'whsec_test_min32chars_for_phase0_test_run';

function signRawBody(rawBody: Buffer): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

function makeCapturedPayload(opts: {
  paymentId?: string;
  masterOrderId?: string;
  amount?: number;
  status?: string;
  captured?: boolean;
  orderId?: string;
} = {}) {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: opts.paymentId ?? 'pay_test1',
          order_id: opts.orderId ?? 'rzp_order_test1',
          notes: { masterOrderId: opts.masterOrderId ?? 'order-1' },
          status: opts.status ?? 'captured',
          amount: opts.amount ?? 100_000,
          captured: opts.captured ?? true,
        },
      },
    },
  };
}

describe('PaymentWebhookController — Phase 0 amount-mismatch routing', () => {
  let controller: PaymentWebhookController;
  let markOrderPaidMock: jest.Mock;
  let envServiceMock: { getOptional: jest.Mock };
  let redisMock: { acquireLock: jest.Mock; del: jest.Mock };

  beforeEach(() => {
    markOrderPaidMock = jest.fn();
    envServiceMock = { getOptional: jest.fn().mockReturnValue(WEBHOOK_SECRET) };
    redisMock = {
      acquireLock: jest.fn().mockResolvedValue(true),
      // Phase 0 (PR 0.13) — release primitive used by the transient
      // error branch to free the Redis claim for retry.
      del: jest.fn().mockResolvedValue(undefined),
    };

    controller = new PaymentWebhookController(
      { markOrderPaid: markOrderPaidMock } as any,
      envServiceMock as any,
      redisMock as any,
    );
  });

  it('threads gatewaySnapshot through to markOrderPaid on payment.captured', async () => {
    const payload = makeCapturedPayload({ amount: 100_000 });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signRawBody(rawBody);

    markOrderPaidMock.mockResolvedValue({ ok: true });

    const res = await controller.handleRazorpayWebhook(
      signature,
      { rawBody } as any,
      payload as any,
    );

    expect(markOrderPaidMock).toHaveBeenCalledWith(
      expect.objectContaining({
        masterOrderId: 'order-1',
        actorType: 'WEBHOOK',
        gatewaySnapshot: {
          amount: 100_000,
          status: 'captured',
          captured: true,
          order_id: 'rzp_order_test1',
        },
      }),
    );
    expect(res).toEqual({ success: true, message: 'Payment processed' });
  });

  it('does NOT flip the order when markOrderPaid throws amount mismatch (and surfaces the stable code)', async () => {
    const payload = makeCapturedPayload({ amount: 100 }); // under-payment
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signRawBody(rawBody);

    const err: any = new Error('Payment amount mismatch: gateway=100 paise, expected=100000 paise');
    err.code = 'GATEWAY_AMOUNT_MISMATCH';
    markOrderPaidMock.mockRejectedValue(err);

    const res = await controller.handleRazorpayWebhook(
      signature,
      { rawBody } as any,
      payload as any,
    );

    // markOrderPaid received the snapshot; it threw because the facade
    // rejected the amount. Controller surfaces the stable code in the
    // body so PR 0.13 can later branch on it for retry policy.
    expect(markOrderPaidMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual(
      expect.objectContaining({
        success: false,
        code: 'GATEWAY_AMOUNT_MISMATCH',
      }),
    );
  });

  it('passes captured=false through to the facade (which rejects)', async () => {
    const payload = makeCapturedPayload({ captured: false, status: 'authorized' });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signRawBody(rawBody);

    markOrderPaidMock.mockResolvedValue({ ok: true });

    await controller.handleRazorpayWebhook(
      signature,
      { rawBody } as any,
      payload as any,
    );

    expect(markOrderPaidMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewaySnapshot: expect.objectContaining({
          captured: false,
          status: 'authorized',
        }),
      }),
    );
  });

  it('rejects unsigned / mis-signed webhooks BEFORE any facade call', async () => {
    const payload = makeCapturedPayload();
    const rawBody = Buffer.from(JSON.stringify(payload));
    // Signed with the WRONG secret — same shape, wrong key.
    const badSignature = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(rawBody)
      .digest('hex');

    await expect(
      controller.handleRazorpayWebhook(
        badSignature,
        { rawBody } as any,
        payload as any,
      ),
    ).rejects.toThrow(/Invalid webhook signature/);

    expect(markOrderPaidMock).not.toHaveBeenCalled();
  });

  it('idempotency: second delivery of the same captured event is silently dropped', async () => {
    const payload = makeCapturedPayload();
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signRawBody(rawBody);

    // First delivery wins the Redis claim; second loses.
    redisMock.acquireLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    markOrderPaidMock.mockResolvedValue({ ok: true });

    await controller.handleRazorpayWebhook(signature, { rawBody } as any, payload as any);
    const res2 = await controller.handleRazorpayWebhook(signature, { rawBody } as any, payload as any);

    expect(markOrderPaidMock).toHaveBeenCalledTimes(1);
    expect(res2).toEqual({ success: true, message: 'Duplicate event ignored' });
  });

  // ── PR 0.13: permanent vs transient error split ────────────────────

  describe('Phase 0 (PR 0.13) — error-class routing', () => {
    it('PERMANENT (GATEWAY_AMOUNT_MISMATCH): keeps the claim, returns 200 with code', async () => {
      const payload = makeCapturedPayload({ amount: 100 });
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = signRawBody(rawBody);

      const err: any = new Error('Payment amount mismatch');
      err.code = 'GATEWAY_AMOUNT_MISMATCH';
      markOrderPaidMock.mockRejectedValue(err);

      const res = await controller.handleRazorpayWebhook(
        signature,
        { rawBody } as any,
        payload as any,
      );

      // 200-shape body — Razorpay should not retry, the mismatch is final.
      expect(res).toEqual(
        expect.objectContaining({
          success: false,
          code: 'GATEWAY_AMOUNT_MISMATCH',
        }),
      );
      // Crucially: Redis claim is NOT released; the next delivery is
      // deduplicated, not re-processed.
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('PERMANENT (NOT_FOUND): keeps the claim, returns 200', async () => {
      const payload = makeCapturedPayload();
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = signRawBody(rawBody);

      const err: any = new Error('Order not found');
      err.code = 'NOT_FOUND';
      markOrderPaidMock.mockRejectedValue(err);

      const res = await controller.handleRazorpayWebhook(
        signature,
        { rawBody } as any,
        payload as any,
      );

      expect(res).toMatchObject({ success: false, code: 'NOT_FOUND' });
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('TRANSIENT (no recognised code): releases the claim and throws 500 (the headline split)', async () => {
      const payload = makeCapturedPayload();
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = signRawBody(rawBody);

      // Plain Error with no `code` — represents DB outage, network
      // failure, P2002 from a parallel partner, etc.
      const err = new Error('connect ECONNREFUSED 5432');
      markOrderPaidMock.mockRejectedValue(err);

      await expect(
        controller.handleRazorpayWebhook(
          signature,
          { rawBody } as any,
          payload as any,
        ),
      ).rejects.toThrow(/transient/i);

      // CRITICAL: Redis claim is released so a Razorpay retry can
      // re-run. Before PR 0.13 the claim was held + 200 was returned,
      // permanently losing the event.
      expect(redisMock.del).toHaveBeenCalledWith(
        'webhook:razorpay:payment.captured:pay_test1',
      );
    });

    it('TRANSIENT with a non-permanent custom code: still routed as transient', async () => {
      const payload = makeCapturedPayload();
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = signRawBody(rawBody);

      const err: any = new Error('event-bus publish failed');
      err.code = 'INTERNAL_BUS_ERROR'; // not in PERMANENT_ERROR_CODES
      markOrderPaidMock.mockRejectedValue(err);

      await expect(
        controller.handleRazorpayWebhook(
          signature,
          { rawBody } as any,
          payload as any,
        ),
      ).rejects.toThrow(/transient/i);

      expect(redisMock.del).toHaveBeenCalled();
    });

    it('A subsequent retry after a transient failure can re-claim and succeed', async () => {
      const payload = makeCapturedPayload();
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = signRawBody(rawBody);

      // First call: transient failure → claim released → 500.
      markOrderPaidMock
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ ok: true });

      await expect(
        controller.handleRazorpayWebhook(
          signature,
          { rawBody } as any,
          payload as any,
        ),
      ).rejects.toThrow();
      expect(redisMock.del).toHaveBeenCalled();

      // Second call: claim re-acquired (mock returns true again),
      // handler succeeds.
      const res = await controller.handleRazorpayWebhook(
        signature,
        { rawBody } as any,
        payload as any,
      );
      expect(res).toEqual({ success: true, message: 'Payment processed' });
      expect(markOrderPaidMock).toHaveBeenCalledTimes(2);
    });
  });
});
