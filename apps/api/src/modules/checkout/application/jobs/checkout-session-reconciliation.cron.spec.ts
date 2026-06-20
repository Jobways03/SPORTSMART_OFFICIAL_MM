// Option B (Phase 5) — CheckoutSessionReconciliationCron unit specs.
//
// Pure-logic regression guards over mocks for the three money-sensitive sweeps:
//  B. re-link a stuck PAID session whose order IS valid (never refund it) vs
//     fail one whose materialize crashed.
//  C. refund FAILED sessions idempotently (deterministic key, gateway amount),
//     and alert — not stamp — on a gateway-rejected refund.
//  A. expire abandoned sessions, but materialize (not strand) a late capture.

import { CheckoutSessionReconciliationCron } from './checkout-session-reconciliation.cron';

function makeCron(
  over: {
    deferredOn?: boolean;
    reconOn?: boolean;
    stuck?: Array<{ id: string; razorpayOrderId: string | null }>;
    order?: {
      id: string;
      orderStatus: string;
      paymentStatus: string;
    } | null;
    failed?: Array<{
      id: string;
      razorpayPaymentId: string | null;
      gatewayAmountInPaise: bigint;
    }>;
    refundResult?: { providerRefundId: string; status: string };
    refundThrows?: boolean;
    markRefundedClaimed?: boolean;
    gwStatus?: string;
    gwAmount?: number;
    abandoned?: Array<{ id: string; razorpayOrderId: string | null }>;
    payments?: Array<{
      paymentId: string;
      status: string;
      captured: boolean;
      createdAt: Date;
    }>;
  } = {},
) {
  const findMany = jest.fn(async (args: any) => {
    const status = args?.where?.status;
    if (status === 'PAID') return over.stuck ?? [];
    if (status === 'FAILED') return over.failed ?? [];
    if (status === 'CREATED') return over.abandoned ?? [];
    return [];
  });
  const masterOrderFindFirst = jest
    .fn()
    .mockResolvedValue(over.order ?? null);
  const prisma: any = {
    checkoutSession: { findMany },
    masterOrder: { findFirst: masterOrderFindFirst },
  };
  const env: any = {
    getBoolean: (k: string, fb: boolean) => {
      if (k === 'CHECKOUT_DEFERRED_ORDER_CREATION') return over.deferredOn ?? true;
      if (k === 'CHECKOUT_SESSION_RECONCILIATION_ENABLED')
        return over.reconOn ?? true;
      return fb;
    },
    getNumber: (_k: string, fb: number) => fb,
  };
  const leader: any = {
    run: jest.fn(
      async (_l: string, _t: number, fn: () => Promise<void>) => fn(),
    ),
  };
  const initiateRefund = over.refundThrows
    ? jest.fn().mockRejectedValue(new Error('gateway down'))
    : jest.fn().mockResolvedValue(
        over.refundResult ?? { providerRefundId: 'rfnd_1', status: 'processed' },
      );
  const fetchOrderPayments = jest.fn().mockResolvedValue(over.payments ?? []);
  const getRawPayment = jest.fn().mockResolvedValue({
    id: 'pay_1',
    status: over.gwStatus ?? 'captured',
    amount: over.gwAmount ?? 1000,
    order_id: 'order_rp1',
  });
  const razorpayAdapter: any = {
    initiateRefund,
    fetchOrderPayments,
    getRawPayment,
  };
  const materializeFromGateway = jest
    .fn()
    .mockResolvedValue({ masterOrderId: 'mo', orderNumber: 'SM' });
  const checkoutService: any = { materializeFromGateway };
  const markOrderCreated = jest.fn().mockResolvedValue({ claimed: true });
  const failStuckPaid = jest.fn().mockResolvedValue({ claimed: true });
  const markExpired = jest.fn().mockResolvedValue({ claimed: true });
  const markRefunded = jest
    .fn()
    .mockResolvedValue({ claimed: over.markRefundedClaimed ?? true });
  const deferredOrderService: any = {
    markOrderCreated,
    failStuckPaid,
    markExpired,
    markRefunded,
  };
  const flagMismatch = jest.fn().mockResolvedValue(undefined);
  const paymentOps: any = { flagMismatch };
  const cron = new CheckoutSessionReconciliationCron(
    prisma,
    env,
    leader,
    razorpayAdapter,
    checkoutService,
    deferredOrderService,
    paymentOps,
  );
  return {
    cron,
    leader,
    findMany,
    initiateRefund,
    fetchOrderPayments,
    getRawPayment,
    materializeFromGateway,
    markOrderCreated,
    failStuckPaid,
    markExpired,
    markRefunded,
    flagMismatch,
  };
}

describe('CheckoutSessionReconciliationCron — enabled() gate', () => {
  it('no-ops when the deferred flag is off', async () => {
    const { cron, leader } = makeCron({ deferredOn: false });
    await cron.run();
    expect(leader.run).not.toHaveBeenCalled();
  });
  it('no-ops when reconciliation is paused', async () => {
    const { cron, leader } = makeCron({ deferredOn: true, reconOn: false });
    await cron.run();
    expect(leader.run).not.toHaveBeenCalled();
  });
});

describe('CheckoutSessionReconciliationCron — Sweep B (stuck PAID)', () => {
  it('RE-LINKS a stuck session whose order is valid PAID (never refunds it)', async () => {
    const { cron, markOrderCreated, failStuckPaid } = makeCron({
      stuck: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      order: { id: 'mo-1', orderStatus: 'PLACED', paymentStatus: 'PAID' },
    });
    const res = await cron.tick();
    expect(markOrderCreated).toHaveBeenCalledWith('sess-1', 'mo-1');
    expect(failStuckPaid).not.toHaveBeenCalled();
    expect(res.relinked).toBe(1);
  });

  it('FAILS a stuck session whose order is cancelled (CAS-guarded)', async () => {
    const { cron, markOrderCreated, failStuckPaid } = makeCron({
      stuck: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      order: { id: 'mo-1', orderStatus: 'CANCELLED', paymentStatus: 'CANCELLED' },
    });
    const res = await cron.tick();
    expect(markOrderCreated).not.toHaveBeenCalled();
    expect(failStuckPaid).toHaveBeenCalledWith('sess-1', expect.any(String));
    expect(res.failed).toBe(1);
  });

  it('FAILS a stuck session with no order at all', async () => {
    const { cron, failStuckPaid } = makeCron({
      stuck: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      order: null,
    });
    const res = await cron.tick();
    expect(failStuckPaid).toHaveBeenCalledWith('sess-1', expect.any(String));
    expect(res.failed).toBe(1);
  });

  it('does NOT count a fail whose CAS lost to a concurrent materialize', async () => {
    const { cron, failStuckPaid } = makeCron({
      stuck: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      order: null,
    });
    failStuckPaid.mockResolvedValueOnce({ claimed: false });
    const res = await cron.tick();
    expect(res.failed).toBe(0);
  });
});

describe('CheckoutSessionReconciliationCron — Sweep C (refund FAILED)', () => {
  it('refunds the ACTUAL captured amount with a deterministic key, then stamps', async () => {
    const { cron, initiateRefund, markRefunded, flagMismatch } = makeCron({
      failed: [
        {
          id: 'sess-1',
          razorpayPaymentId: 'pay_1',
          gatewayAmountInPaise: 129950n,
        },
      ],
      // The gateway's actual captured amount is the source of truth (not the
      // stale requested gatewayAmountInPaise).
      gwStatus: 'captured',
      gwAmount: 129950,
      refundResult: { providerRefundId: 'rfnd_9', status: 'processed' },
    });
    const res = await cron.tick();
    expect(initiateRefund).toHaveBeenCalledWith(
      'pay_1',
      129950n,
      expect.objectContaining({ checkout_session_id: 'sess-1' }),
      { idempotencyKey: 'checkout-refund-sess-1' },
    );
    expect(markRefunded).toHaveBeenCalledWith('sess-1', 'rfnd_9');
    expect(flagMismatch).not.toHaveBeenCalled();
    expect(res.refunded).toBe(1);
  });

  it('closes (stamps) a session whose payment is already refunded at the gateway — no new refund', async () => {
    const { cron, initiateRefund, markRefunded } = makeCron({
      failed: [
        { id: 's', razorpayPaymentId: 'pay_1', gatewayAmountInPaise: 100n },
      ],
      gwStatus: 'refunded',
    });
    const res = await cron.tick();
    expect(initiateRefund).not.toHaveBeenCalled();
    expect(markRefunded).toHaveBeenCalledWith('s', null);
    expect(res.refunded).toBe(0);
  });

  it('skips a payment that is not actually captured (no refund)', async () => {
    const { cron, initiateRefund, markRefunded } = makeCron({
      failed: [
        { id: 's', razorpayPaymentId: 'pay_1', gatewayAmountInPaise: 100n },
      ],
      gwStatus: 'authorized',
    });
    const res = await cron.tick();
    expect(initiateRefund).not.toHaveBeenCalled();
    expect(markRefunded).not.toHaveBeenCalled();
    expect(res.refunded).toBe(0);
  });

  it('treats a pending refund as accepted (stamps it)', async () => {
    const { cron, markRefunded } = makeCron({
      failed: [
        { id: 's', razorpayPaymentId: 'pay_1', gatewayAmountInPaise: 100n },
      ],
      refundResult: { providerRefundId: 'rfnd_p', status: 'pending' },
    });
    const res = await cron.tick();
    expect(markRefunded).toHaveBeenCalledWith('s', 'rfnd_p');
    expect(res.refunded).toBe(1);
  });

  it('does NOT stamp + opens an ops alert when the gateway rejects the refund', async () => {
    const { cron, markRefunded, flagMismatch } = makeCron({
      failed: [
        { id: 's', razorpayPaymentId: 'pay_1', gatewayAmountInPaise: 100n },
      ],
      refundResult: { providerRefundId: 'rfnd_f', status: 'failed' },
    });
    const res = await cron.tick();
    expect(markRefunded).not.toHaveBeenCalled();
    expect(flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ORPHAN_PAYMENT', providerPaymentId: 'pay_1' }),
    );
    expect(res.refunded).toBe(0);
  });

  it('opens an ops alert when the refund call throws', async () => {
    const { cron, flagMismatch } = makeCron({
      failed: [
        { id: 's', razorpayPaymentId: 'pay_1', gatewayAmountInPaise: 100n },
      ],
      refundThrows: true,
    });
    await cron.tick();
    expect(flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ORPHAN_PAYMENT' }),
    );
  });
});

describe('CheckoutSessionReconciliationCron — Sweep A (expire abandoned)', () => {
  it('expires a session with no captured payment', async () => {
    const { cron, markExpired, materializeFromGateway } = makeCron({
      abandoned: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      payments: [],
    });
    const res = await cron.tick();
    expect(materializeFromGateway).not.toHaveBeenCalled();
    expect(markExpired).toHaveBeenCalledWith('sess-1');
    expect(res.expired).toBe(1);
  });

  it('materializes a LATE capture instead of stranding it (does not expire)', async () => {
    const { cron, markExpired, materializeFromGateway } = makeCron({
      abandoned: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      payments: [
        {
          paymentId: 'pay_old',
          status: 'captured',
          captured: true,
          createdAt: new Date('2026-06-19T10:00:00Z'),
        },
        {
          paymentId: 'pay_new',
          status: 'captured',
          captured: true,
          createdAt: new Date('2026-06-19T10:05:00Z'),
        },
      ],
    });
    const res = await cron.tick();
    expect(materializeFromGateway).toHaveBeenCalledWith('order_rp1', 'pay_new');
    expect(markExpired).not.toHaveBeenCalled();
    expect(res.lateMaterialized).toBe(1);
  });

  it('expires a session that never reached the gateway (no razorpayOrderId)', async () => {
    const { cron, fetchOrderPayments, markExpired } = makeCron({
      abandoned: [{ id: 'sess-1', razorpayOrderId: null }],
    });
    const res = await cron.tick();
    expect(fetchOrderPayments).not.toHaveBeenCalled();
    expect(markExpired).toHaveBeenCalledWith('sess-1');
    expect(res.expired).toBe(1);
  });
});
