// Phase 110 — dispute-filing notifications.
//
// A SELLER contesting a return must notify the affected CUSTOMER ("your return
// is under additional review"); a CUSTOMER-filed dispute must notify the
// affected SELLER. Recipient resolution walks the return / sub-order /
// master-order graph. Sends are best-effort — an unresolved party must not
// throw.

import { DisputeNotificationHandler } from './dispute-notification.handler';

function build(prismaOverrides: any = {}) {
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    return: { findUnique: jest.fn() },
    subOrder: { findUnique: jest.fn() },
    masterOrder: { findUnique: jest.fn() },
    ...prismaOverrides,
  };
  // @IdempotentHandler consults tryConsume before running; true = proceed.
  const eventDedup = { tryConsume: jest.fn().mockResolvedValue(true) };
  const handler = new DisputeNotificationHandler(
    notifications as any,
    prisma as any,
    eventDedup as any,
  );
  return { handler, notifications, prisma, eventDedup };
}

const baseFiled = {
  disputeId: 'd-1',
  disputeNumber: 'DSP-2026-000001',
  kind: 'RETURN_REJECTED',
  filedById: 'actor-1',
  filedByName: 'Acme Sports',
  masterOrderId: null as string | null,
  subOrderId: null as string | null,
  returnId: null as string | null,
  summary: 'Item came back damaged',
};

const filedEvent = (payload: any) => ({ eventId: 'evt-1', payload }) as any;

describe('DisputeNotificationHandler.onFiled', () => {
  it('SELLER-filed → notifies the affected customer (resolved via returnId)', async () => {
    const { handler, notifications, prisma } = build();
    prisma.return.findUnique.mockResolvedValue({ customerId: 'cust-1' });

    await handler.onFiled(
      filedEvent({ ...baseFiled, filedByType: 'SELLER', returnId: 'ret-1' }),
    );

    expect(prisma.return.findUnique).toHaveBeenCalledWith({
      where: { id: 'ret-1' },
      select: { customerId: true },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipientId: 'cust-1',
        subject: expect.stringMatching(/under additional review/i),
      }),
    );
  });

  it('SELLER-filed → falls back to subOrder.masterOrder.customerId when no returnId', async () => {
    const { handler, notifications, prisma } = build();
    prisma.subOrder.findUnique.mockResolvedValue({
      masterOrder: { customerId: 'cust-2' },
    });

    await handler.onFiled(
      filedEvent({ ...baseFiled, filedByType: 'SELLER', subOrderId: 'so-1' }),
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'cust-2' }),
    );
  });

  it('CUSTOMER-filed → notifies the affected seller (resolved via subOrderId)', async () => {
    const { handler, notifications, prisma } = build();
    prisma.subOrder.findUnique.mockResolvedValue({ sellerId: 'seller-1' });

    await handler.onFiled(
      filedEvent({ ...baseFiled, filedByType: 'CUSTOMER', subOrderId: 'so-1' }),
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'seller-1',
        subject: expect.stringMatching(/new dispute against your order/i),
      }),
    );
  });

  it('SELLER-filed with no resolvable customer → sends nothing and does not throw', async () => {
    const { handler, notifications } = build();
    await expect(
      handler.onFiled(filedEvent({ ...baseFiled, filedByType: 'SELLER' })),
    ).resolves.toBeUndefined();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('respects the dedup gate — skips entirely when tryConsume returns false', async () => {
    const { handler, notifications, prisma, eventDedup } = build();
    eventDedup.tryConsume.mockResolvedValue(false);

    await handler.onFiled(
      filedEvent({ ...baseFiled, filedByType: 'SELLER', returnId: 'ret-1' }),
    );

    expect(prisma.return.findUnique).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('DisputeNotificationHandler.onDecided', () => {
  const decided = (extra: any) =>
    filedEvent({
      disputeId: 'd-1',
      disputeNumber: 'DSP-2026-000001',
      outcome: 'RESOLVED_BUYER',
      amountInPaise: 50000,
      rationale: 'ok',
      subOrderId: 'so-1',
      ...extra,
    });

  it('notifies the filer AND the affected seller (customer-filed)', async () => {
    const { handler, notifications, prisma } = build();
    prisma.subOrder.findUnique.mockResolvedValue({ sellerId: 'seller-1' });
    await handler.onDecided(decided({ filedByType: 'CUSTOMER', filedById: 'cust-1' }));
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'seller-1' }),
    );
  });

  it('does not double-notify when the seller IS the filer (seller-filed)', async () => {
    const { handler, notifications, prisma } = build();
    prisma.subOrder.findUnique.mockResolvedValue({ sellerId: 'seller-1' });
    await handler.onDecided(decided({ filedByType: 'SELLER', filedById: 'seller-1' }));
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('does NOT leak the internal decision rationale into the filer email', async () => {
    const { handler, notifications } = build();
    await handler.onDecided(
      decided({
        filedByType: 'CUSTOMER',
        filedById: 'cust-1',
        rationale: 'SELLER at fault per internal note ref #42',
      }),
    );
    const filerCall = notifications.notify.mock.calls.find(
      (c: any) => c[0].recipientId === 'cust-1',
    );
    expect(filerCall).toBeTruthy();
    expect(filerCall[0].body).not.toContain('internal note ref #42');
  });
});
