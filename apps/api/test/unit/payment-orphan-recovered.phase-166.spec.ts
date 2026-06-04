import 'reflect-metadata';
import { OrphanRecoveredHandler } from '../../src/modules/payments/application/event-handlers/orphan-recovered.handler';
import { OrderExpiredHandler } from '../../src/modules/payments/application/event-handlers/order-expired.handler';

// Phase 166 — Payment Status Poller audit remediation coverage.
//   #1  OrphanRecoveredHandler: the consumer that was MISSING. Does a FULL
//       atomic confirm (orderStatus→PLACED + paymentStatus→PAID + payment id),
//       not just markOrderPaid (which would leave the order cancel-expirable).
//   #12 OrderExpiredHandler: audit + customer notification.

function makeOrphanHandler(order: any, opts: { updateCount?: number } = {}) {
  const prisma: any = {
    masterOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
    },
    subOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const paymentOps: any = {
    flagMismatch: jest.fn().mockResolvedValue(undefined),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
  };
  const lifecycle: any = { markCaptured: jest.fn().mockResolvedValue(undefined) };
  const handler = new OrphanRecoveredHandler(prisma, eventBus, audit, paymentOps, lifecycle);
  return { handler, prisma, eventBus, audit, paymentOps, lifecycle };
}

const event = (over: any = {}) => ({
  eventName: 'payments.orphan_recovered',
  aggregate: 'MasterOrder',
  aggregateId: 'mo-1',
  occurredAt: new Date(),
  payload: {
    masterOrderId: 'mo-1',
    orderNumber: 'ORD-1',
    razorpayOrderId: 'order_rzp',
    razorpayPaymentId: 'pay_1',
    capturedAmountInPaise: '100000',
    customerId: 'cust-1',
    ...over,
  },
});

const baseOrder = (over: any = {}) => ({
  id: 'mo-1',
  orderStatus: 'PENDING_PAYMENT',
  paymentStatus: 'PENDING',
  totalAmountInPaise: 100_000n,
  orderNumber: 'ORD-1',
  customerId: 'cust-1',
  paymentMethod: 'ONLINE',
  ...over,
});

describe('OrphanRecoveredHandler (#1)', () => {
  it('does a FULL atomic confirm + fans out captured + audits', async () => {
    const { handler, prisma, eventBus, audit, lifecycle } = makeOrphanHandler(baseOrder());
    await handler.handle(event() as any);

    expect(prisma.masterOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mo-1', orderStatus: 'PENDING_PAYMENT' },
        data: expect.objectContaining({
          orderStatus: 'PLACED',
          paymentStatus: 'PAID',
          razorpayPaymentId: 'pay_1',
          razorpayOrderId: 'order_rzp',
        }),
      }),
    );
    expect(prisma.subOrder.updateMany).toHaveBeenCalled();
    expect(lifecycle.markCaptured).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'payments.payment.captured' }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payments.orphan.confirmed' }),
    );
  });

  it('is idempotent — CAS count 0 (already confirmed) → no fan-out', async () => {
    const { handler, prisma, eventBus } = makeOrphanHandler(baseOrder(), { updateCount: 0 });
    await handler.handle(event() as any);
    expect(prisma.subOrder.updateMany).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does NOT re-emit captured when the order was already PAID (webhook-confirmed)', async () => {
    const { handler, prisma, eventBus } = makeOrphanHandler(
      baseOrder({ paymentStatus: 'PAID' }),
    );
    await handler.handle(event() as any);
    // It still completes orderStatus (updateMany guarded on PENDING_PAYMENT),
    // but must NOT re-emit captured (webhook already did → no double fan-out).
    expect(prisma.masterOrder.updateMany).toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('refuses to resurrect a CANCELLED order — opens an ORPHAN_PAYMENT refund alert', async () => {
    const { handler, prisma, paymentOps } = makeOrphanHandler(
      baseOrder({ orderStatus: 'CANCELLED' }),
    );
    await handler.handle(event() as any);
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ORPHAN_PAYMENT' }),
    );
    expect(prisma.masterOrder.updateMany).not.toHaveBeenCalled();
  });

  it('opens an AMOUNT_MISMATCH alert on drift > 1 paise (no confirm)', async () => {
    const { handler, prisma, paymentOps } = makeOrphanHandler(baseOrder());
    await handler.handle(event({ capturedAmountInPaise: '50000' }) as any); // ₹500 vs ₹1000
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'AMOUNT_MISMATCH' }),
    );
    expect(prisma.masterOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe('OrderExpiredHandler (#12)', () => {
  it('audits + notifies the customer', async () => {
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const notifications: any = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    const handler = new OrderExpiredHandler(audit, notifications);
    await handler.handle({
      eventName: 'payments.payment.expired',
      aggregate: 'MasterOrder',
      aggregateId: 'mo-9',
      occurredAt: new Date(),
      payload: { masterOrderId: 'mo-9', orderNumber: 'ORD-9', customerId: 'cust-9', reason: 'window expired' },
    } as any);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payments.payment.expired' }),
    );
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'cust-9', templateKey: 'order.payment_window_expired' }),
    );
  });
});
