// Option B (Phase 4) — DeferredCaptureRecoveryCron unit specs.
//
// The cron is the missed-webhook backstop: it scans unmaterialized CREATED
// sessions, polls Razorpay, and routes captures to materializeFromGateway.
// The regression-worthy logic is: (a) the enabled() flag gate, (b) picking the
// LATEST captured payment (Razorpay can return several attempts), (c) NOT
// materializing when nothing is captured, and (d) stamping lastPolledAt for
// backoff even when the gateway poll fails. All are pure logic over mocks.

import { DeferredCaptureRecoveryCron } from './deferred-capture-recovery.cron';

function makeCron(
  over: {
    flagOn?: boolean;
    pollInterval?: number;
    candidates?: Array<{ id: string; razorpayOrderId: string | null }>;
    payments?: Array<{
      paymentId: string;
      status: string;
      captured: boolean;
      createdAt: Date;
      amountInPaise: bigint;
    }>;
    fetchThrows?: boolean;
    materializeResult?: { masterOrderId: string; orderNumber: string } | null;
  } = {},
) {
  const findMany = jest.fn().mockResolvedValue(over.candidates ?? []);
  const update = jest.fn().mockResolvedValue({});
  const prisma: any = { checkoutSession: { findMany, update } };
  const env: any = {
    getBoolean: (_k: string, fallback: boolean) =>
      over.flagOn !== undefined ? over.flagOn : fallback,
    getNumber: (k: string, fallback: number) => {
      if (k === 'PAYMENT_POLL_INTERVAL_SECONDS')
        return over.pollInterval ?? fallback;
      return fallback;
    },
  };
  const leader: any = {
    run: jest.fn(
      async (_lock: string, _ttl: number, fn: () => Promise<void>) => fn(),
    ),
  };
  const fetchOrderPayments = over.fetchThrows
    ? jest.fn().mockRejectedValue(new Error('gateway down'))
    : jest.fn().mockResolvedValue(over.payments ?? []);
  const razorpayAdapter: any = { fetchOrderPayments };
  const materializeFromGateway = jest
    .fn()
    .mockResolvedValue(
      over.materializeResult === undefined
        ? { masterOrderId: 'mo-1', orderNumber: 'SM-1' }
        : over.materializeResult,
    );
  const checkoutService: any = { materializeFromGateway };
  const cron = new DeferredCaptureRecoveryCron(
    prisma,
    env,
    leader,
    razorpayAdapter,
    checkoutService,
  );
  return {
    cron,
    findMany,
    update,
    leader,
    fetchOrderPayments,
    materializeFromGateway,
  };
}

describe('DeferredCaptureRecoveryCron — enabled() gate', () => {
  it('run() no-ops when the deferred flag is off', async () => {
    const { cron, leader, findMany } = makeCron({ flagOn: false });
    await cron.run();
    expect(leader.run).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('run() no-ops when polling is disabled (interval <= 0)', async () => {
    const { cron, leader } = makeCron({ flagOn: true, pollInterval: 0 });
    await cron.run();
    expect(leader.run).not.toHaveBeenCalled();
  });

  it('run() runs the tick under the leader lock when enabled', async () => {
    const { cron, leader, findMany } = makeCron({
      flagOn: true,
      pollInterval: 60,
      candidates: [],
    });
    await cron.run();
    expect(leader.run).toHaveBeenCalledWith(
      'deferred-capture-recovery',
      expect.any(Number),
      expect.any(Function),
    );
    expect(findMany).toHaveBeenCalled();
  });
});

describe('DeferredCaptureRecoveryCron — tick()', () => {
  it('scans nothing → no fetch, no materialize', async () => {
    const { cron, fetchOrderPayments, materializeFromGateway } = makeCron({
      candidates: [],
    });
    const res = await cron.tick();
    expect(res).toEqual({ scanned: 0, materialized: 0 });
    expect(fetchOrderPayments).not.toHaveBeenCalled();
    expect(materializeFromGateway).not.toHaveBeenCalled();
  });

  it('routes the LATEST captured payment to materializeFromGateway', async () => {
    const { cron, materializeFromGateway, update } = makeCron({
      candidates: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      payments: [
        {
          paymentId: 'pay_old',
          status: 'captured',
          captured: true,
          createdAt: new Date('2026-06-19T10:00:00Z'),
          amountInPaise: 1000n,
        },
        {
          paymentId: 'pay_new',
          status: 'captured',
          captured: true,
          createdAt: new Date('2026-06-19T10:05:00Z'),
          amountInPaise: 1000n,
        },
      ],
    });
    const res = await cron.tick();
    expect(materializeFromGateway).toHaveBeenCalledWith('order_rp1', 'pay_new');
    expect(res.materialized).toBe(1);
    // Backoff stamp written.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { lastPolledAt: expect.any(Date) },
    });
  });

  it('ignores non-captured payments and does not materialize', async () => {
    const { cron, materializeFromGateway, update } = makeCron({
      candidates: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      payments: [
        {
          paymentId: 'pay_authzd',
          status: 'authorized',
          captured: false,
          createdAt: new Date('2026-06-19T10:00:00Z'),
          amountInPaise: 1000n,
        },
      ],
    });
    const res = await cron.tick();
    expect(materializeFromGateway).not.toHaveBeenCalled();
    expect(res.materialized).toBe(0);
    // Still stamps backoff so we don't re-poll every tick.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { lastPolledAt: expect.any(Date) },
    });
  });

  it('a gateway fetch failure is swallowed and still stamps backoff', async () => {
    const { cron, materializeFromGateway, update } = makeCron({
      candidates: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      fetchThrows: true,
    });
    await expect(cron.tick()).resolves.toEqual({ scanned: 1, materialized: 0 });
    expect(materializeFromGateway).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { lastPolledAt: expect.any(Date) },
    });
  });

  it('does not double-count when materializeFromGateway returns null (concurrent/terminal)', async () => {
    const { cron } = makeCron({
      candidates: [{ id: 'sess-1', razorpayOrderId: 'order_rp1' }],
      payments: [
        {
          paymentId: 'pay_1',
          status: 'captured',
          captured: true,
          createdAt: new Date('2026-06-19T10:00:00Z'),
          amountInPaise: 1000n,
        },
      ],
      materializeResult: null,
    });
    const res = await cron.tick();
    expect(res.materialized).toBe(0);
  });
});
