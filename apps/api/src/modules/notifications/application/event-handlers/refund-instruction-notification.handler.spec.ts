// Phase 130 — customer notification on finance refund rejection. Emails the
// order customer an honest "on hold / under review" note; never echoes the
// internal rejection reason; respects the dedup gate.

import { RefundInstructionNotificationHandler } from './refund-instruction-notification.handler';

function build(consume = true) {
  const notifications = { notify: jest.fn().mockResolvedValue('job-1') };
  const eventDedup = { tryConsume: jest.fn().mockResolvedValue(consume) };
  const handler = new RefundInstructionNotificationHandler(
    notifications as any,
    eventDedup as any,
  );
  return { handler, notifications };
}

const evt = (payload: any) => ({ eventId: 'e-1', payload }) as any;
const base = {
  instructionId: 'ri-1',
  sourceType: 'DISPUTE',
  sourceId: 'd-1',
  customerId: 'cust-9',
  amountInPaise: '50000', // ₹500.00
  reason: 'duplicate refund suspected', // internal — must NOT reach the customer
};

describe('RefundInstructionNotificationHandler.onRejected', () => {
  it('emails the order customer with the amount, on the EMAIL channel', async () => {
    const { handler, notifications } = build();
    await handler.onRejected(evt(base));
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipientId: 'cust-9',
        subject: expect.stringContaining('₹500.00'),
        eventId: 'ri-1',
      }),
    );
  });

  it('never leaks the internal rejection reason into the customer email', async () => {
    const { handler, notifications } = build();
    await handler.onRejected(evt(base));
    const arg = notifications.notify.mock.calls[0][0];
    expect(`${arg.subject} ${arg.body}`).not.toContain('duplicate refund suspected');
  });

  it('does nothing when there is no customer to notify', async () => {
    const { handler, notifications } = build();
    await handler.onRejected(evt({ ...base, customerId: '' }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('skips entirely when the dedup gate denies (tryConsume=false)', async () => {
    const { handler, notifications } = build(false);
    await handler.onRejected(evt(base));
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
