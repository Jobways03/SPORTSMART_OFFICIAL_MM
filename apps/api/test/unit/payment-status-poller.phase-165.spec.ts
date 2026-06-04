import 'reflect-metadata';
import { PaymentStatusPollerService } from '../../src/modules/payments/application/services/payment-status-poller.service';

// Phase 165 — Razorpay poller hardening coverage.
//   #2  orphan-recovery scans ALL gateway order ids (current + Payment rows),
//       so a payment captured against a PRIOR (overwritten) order id is found.
//   #11 amount drift uses the BigInt paise column, not Number(totalAmount)*100.
//   #17-drift orphan drift > 1 paise OPENS a PaymentMismatchAlert (was log-only).

function makePoller(opts: {
  orders: any[];
  paymentRowsByOrder?: Record<string, any[]>;
  paymentsByOrderId: Record<string, any[]>;
}) {
  const prisma: any = {
    masterOrder: {
      findMany: jest.fn().mockResolvedValue(opts.orders),
      // Phase 166 (#7) — poll-stamp written in the finally of each iteration.
      update: jest.fn().mockResolvedValue({}),
    },
    payment: {
      findMany: jest.fn(async ({ where }: any) => opts.paymentRowsByOrder?.[where.masterOrderId] ?? []),
    },
    paymentMismatchAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const razorpayAdapter: any = {
    fetchOrderPayments: jest.fn(async (orderId: string) => opts.paymentsByOrderId[orderId] ?? []),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const envService: any = { getNumber: (_k: string, fb: number) => fb };
  // Phase 166 — PaymentOpsFacade (POLL_STATUS attempts + fetch-failure alerts).
  const paymentOps: any = {
    recordAttempt: jest.fn().mockResolvedValue(undefined),
    flagMismatch: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new PaymentStatusPollerService(
    prisma,
    {} as any, // redis (unused — leader handles locking now)
    envService,
    eventBus,
    razorpayAdapter,
    {} as any, // franchiseFacade
    {} as any, // leader
    {} as any, // instr
    paymentOps,
  );
  return { svc, prisma, razorpayAdapter, eventBus };
}

const orphanOrder = (over: any = {}) => ({
  id: 'order-1',
  orderNumber: 'ORD-1',
  customerId: 'cust-1',
  razorpayOrderId: 'rzp_new',
  totalAmountInPaise: 100_000n,
  ...over,
});

describe('confirmOrphanedPayments (Phase 165)', () => {
  it('#11/#2 — emits recovery event when a captured payment matches expected amount', async () => {
    const { svc, eventBus, razorpayAdapter } = makePoller({
      orders: [orphanOrder()],
      paymentsByOrderId: {
        rzp_new: [{ captured: true, status: 'captured', paymentId: 'pay_1', amountInPaise: 100_000n }],
      },
    });
    await (svc as any).confirmOrphanedPayments();
    expect(razorpayAdapter.fetchOrderPayments).toHaveBeenCalledWith('rzp_new');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'payments.orphan_recovered',
        payload: expect.objectContaining({ razorpayPaymentId: 'pay_1', razorpayOrderId: 'rzp_new' }),
      }),
    );
  });

  it('#2 — scans a PRIOR gateway order id from the Payment trail (orphan blind spot)', async () => {
    const { svc, eventBus, razorpayAdapter } = makePoller({
      orders: [orphanOrder({ razorpayOrderId: 'rzp_new' })],
      paymentRowsByOrder: { 'order-1': [{ providerOrderId: 'rzp_old' }] },
      paymentsByOrderId: {
        rzp_new: [], // current order id has no payment
        rzp_old: [{ captured: true, status: 'captured', paymentId: 'pay_old', amountInPaise: 100_000n }],
      },
    });
    await (svc as any).confirmOrphanedPayments();
    // It scanned BOTH ids and found the payment against the OLD one.
    expect(razorpayAdapter.fetchOrderPayments).toHaveBeenCalledWith('rzp_old');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ razorpayPaymentId: 'pay_old', razorpayOrderId: 'rzp_old' }),
      }),
    );
  });

  it('#17-drift — opens a PaymentMismatchAlert (not just a log) when amount drifts > 1 paise', async () => {
    const { svc, prisma, eventBus } = makePoller({
      orders: [orphanOrder({ totalAmountInPaise: 100_000n })],
      paymentsByOrderId: {
        rzp_new: [{ captured: true, status: 'captured', paymentId: 'pay_x', amountInPaise: 50_000n }], // ₹500 vs ₹1000
      },
    });
    await (svc as any).confirmOrphanedPayments();
    expect(prisma.paymentMismatchAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'AMOUNT_MISMATCH',
          expectedInPaise: 100_000n,
          actualInPaise: 50_000n,
        }),
      }),
    );
    // Must NOT emit a recovery event on a drift.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
