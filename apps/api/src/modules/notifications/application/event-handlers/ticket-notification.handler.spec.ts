// Phase 122 — ticket status-change customer notification. Emails the creator
// (via the snapshotted `to` address) on RESOLVED/CLOSED; silent on internal
// workflow transitions; respects the dedup gate.

import { TicketNotificationHandler } from './ticket-notification.handler';

function build(consume = true) {
  const notifications = {
    notify: jest.fn().mockResolvedValue('job-1'),
    notifyFromTemplate: jest.fn().mockResolvedValue('job-2'),
  };
  const eventDedup = { tryConsume: jest.fn().mockResolvedValue(consume) };
  const handler = new TicketNotificationHandler(
    notifications as any,
    eventDedup as any,
  );
  return { handler, notifications };
}

const evt = (payload: any) => ({ eventId: 'e-1', payload }) as any;
const base = {
  ticketId: 't-1',
  ticketNumber: 'TKT-2026-000001',
  ticketSubject: 'Order not delivered',
  fromStatus: 'IN_PROGRESS',
  recipientType: 'CUSTOMER' as const,
  recipientEmail: 'cust@example.com',
  recipientName: 'Cust',
};

describe('TicketNotificationHandler.onTicketStatusChanged', () => {
  it('emails the creator when the ticket is RESOLVED', async () => {
    const { handler, notifications } = build();
    await handler.onTicketStatusChanged(evt({ ...base, toStatus: 'RESOLVED' }));
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'cust@example.com',
        subject: expect.stringMatching(/resolved/i),
      }),
    );
  });

  it('emails the creator when the ticket is CLOSED', async () => {
    const { handler, notifications } = build();
    await handler.onTicketStatusChanged(evt({ ...base, toStatus: 'CLOSED' }));
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/closed/i) }),
    );
  });

  it('does NOT email on internal-workflow transitions (IN_PROGRESS)', async () => {
    const { handler, notifications } = build();
    await handler.onTicketStatusChanged(evt({ ...base, toStatus: 'IN_PROGRESS' }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('skips entirely when the dedup gate denies (tryConsume=false)', async () => {
    const { handler, notifications } = build(false);
    await handler.onTicketStatusChanged(evt({ ...base, toStatus: 'RESOLVED' }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('TicketNotificationHandler.onTicketAssigned', () => {
  const assigned = (extra: any = {}) =>
    evt({
      ticketId: 't-1',
      ticketNumber: 'TKT-2026-000001',
      assigneeId: 'a-1',
      assigneeEmail: 'agent@example.com',
      assigneeName: 'Agent',
      ...extra,
    });

  it('emails the newly-assigned admin', async () => {
    const { handler, notifications } = build();
    await handler.onTicketAssigned(assigned());
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'agent@example.com',
        subject: expect.stringMatching(/assigned to you/i),
      }),
    );
  });

  it('skips when there is no assignee email', async () => {
    const { handler, notifications } = build();
    await handler.onTicketAssigned(assigned({ assigneeEmail: '' }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('TicketNotificationHandler.onTicketPriorityChanged', () => {
  const escalated = (extra: any = {}) =>
    evt({
      ticketId: 't-1',
      ticketNumber: 'TKT-2026-000001',
      fromPriority: 'NORMAL',
      toPriority: 'URGENT',
      assigneeId: 'a-1',
      assigneeEmail: 'agent@example.com',
      assigneeName: 'Agent',
      ...extra,
    });

  it('emails the assignee with the new priority on escalation', async () => {
    const { handler, notifications } = build();
    await handler.onTicketPriorityChanged(escalated());
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'agent@example.com',
        subject: expect.stringMatching(/escalated to URGENT/i),
      }),
    );
  });

  it('skips when there is no assignee email', async () => {
    const { handler, notifications } = build();
    await handler.onTicketPriorityChanged(escalated({ assigneeEmail: '' }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('skips entirely when the dedup gate denies', async () => {
    const { handler, notifications } = build(false);
    await handler.onTicketPriorityChanged(escalated());
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
