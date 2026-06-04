import { AdminNotificationLogsController } from './presentation/controllers/list-notification-logs.controller';
import { NotificationLogRepository } from './infrastructure/persistence/prisma/notification-log.repository';

// Phase 190 — Notification Logs flow audit remediation.

describe('#6/#7 recordAttempt failure code + failedAt', () => {
  function makeRepo() {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data }));
    const prisma: any = { notificationLog: { create } };
    return { repo: new NotificationLogRepository(prisma), create };
  }
  const job: any = { channel: 'SMS', recipientId: 'u1', templateKey: null, subject: null, body: 'x', attemptNumber: 1 };

  it('persists the provider failure code + failedAt on FAILED', async () => {
    const { repo, create } = makeRepo();
    await repo.recordAttempt({ job, destination: '+91', result: { success: false, failureReason: 'bad', failureCode: 'INVALID_PHONE', provider: 'sms' }, finalStatus: 'FAILED' });
    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.failureCode).toBe('INVALID_PHONE');
    expect(data.provider).toBe('sms');
    expect(data.failedAt).toBeInstanceOf(Date);
  });

  it('derives a code from the reason when the provider gives none', async () => {
    const { repo, create } = makeRepo();
    await repo.recordAttempt({ job, destination: 'x', result: { success: false, failureReason: 'Message bounced by mailbox' }, finalStatus: 'DEAD_LETTERED' });
    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('DEAD_LETTERED');
    expect(data.failureCode).toBe('BOUNCED');
  });

  it('leaves failure fields null on SENT', async () => {
    const { repo, create } = makeRepo();
    await repo.recordAttempt({ job, destination: 'x', result: { success: true, providerMessageId: 'm1' }, finalStatus: 'SENT' });
    const data = create.mock.calls[0][0].data;
    expect(data.failureCode).toBeNull();
    expect(data.failedAt).toBeNull();
    expect(data.sentAt).toBeInstanceOf(Date);
  });
});

describe('logs controller', () => {
  function make(over: { log?: any; gate?: any } = {}) {
    const logs: any = {
      findById: jest.fn().mockResolvedValue(over.log ?? null),
      listForAdmin: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 }),
    };
    const notifications: any = {
      notify: jest.fn().mockResolvedValue('job-1'),
      notifyFromTemplate: jest.fn().mockResolvedValue('job-2'),
    };
    const gate: any = { check: jest.fn().mockResolvedValue(over.gate ?? { allowed: true }) };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { ctrl: new AdminNotificationLogsController(logs, notifications, gate, audit), logs, notifications, gate, audit };
  }
  const REQ = (perms: string[] = []) => ({ adminId: 'a1', user: { id: 'a1', permissions: perms } });

  it('#13 rejects an invalid channel query', async () => {
    const { ctrl } = make();
    await expect(ctrl.list(REQ(), undefined, undefined, 'GARBAGE')).rejects.toThrow(/Invalid channel/);
  });

  it('#13 accepts a valid channel (case-insensitive)', async () => {
    const { ctrl, logs } = make();
    await ctrl.list(REQ(['notifications.logs.read.unmasked']), '1', '50', 'email');
    expect(logs.listForAdmin.mock.calls[0][0].channel).toBe('EMAIL');
  });

  it('#9 masks destination + body without the unmask permission', async () => {
    const { ctrl } = make({ log: { id: 'l1', channel: 'EMAIL', destination: 'john@example.com', body: 'y'.repeat(200), failureReason: 'oops' } });
    const res = await ctrl.getOne(REQ(), 'l1');
    expect(res.data.destination).not.toBe('john@example.com');
    expect(res.data.destination).toContain('@example.com');
    expect(res.data.body.endsWith('…')).toBe(true);
    expect(res.data.masked).toBe(true);
  });

  it('#9 returns full data WITH the unmask permission', async () => {
    const { ctrl } = make({ log: { id: 'l1', channel: 'EMAIL', destination: 'john@example.com', body: 'full', failureReason: 'oops' } });
    const res = await ctrl.getOne(REQ(['notifications.logs.read.unmasked']), 'l1');
    expect(res.data.destination).toBe('john@example.com');
    expect(res.data.body).toBe('full');
  });

  it('#11 blocks retry to an opted-out recipient without a bypassReason', async () => {
    const { ctrl } = make({ log: { id: 'l1', channel: 'EMAIL', recipientId: 'u1', destination: 'x', body: 'b', eventType: 'marketing' }, gate: { allowed: false, reason: 'opted out' } });
    await expect(ctrl.retry(REQ(), 'l1', {} as any)).rejects.toThrow(/opted out|bypassReason/);
  });

  it('#11/#12 allows retry with a bypassReason + audits', async () => {
    const { ctrl, notifications, audit } = make({ log: { id: 'l1', channel: 'EMAIL', recipientId: 'u1', destination: 'x', body: 'b', eventType: 'marketing' }, gate: { allowed: false, reason: 'opted out' } });
    const res = await ctrl.retry(REQ(), 'l1', { bypassReason: 'legal notice required' } as any);
    expect(res.data.mode).toBe('FROZEN');
    expect(notifications.notify.mock.calls[0][0].parentLogId).toBe('l1');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'notifications.log.retried' }));
  });

  it('#3 re-renders from template when forceTemplateReRender', async () => {
    const { ctrl, notifications } = make({ log: { id: 'l1', channel: 'EMAIL', recipientId: 'u1', destination: 'x', body: 'stale', templateKey: 'order.placed.email', eventType: 'order' } });
    const res = await ctrl.retry(REQ(), 'l1', { forceTemplateReRender: true, vars: { name: 'A' } } as any);
    expect(res.data.mode).toBe('RE_RENDERED');
    expect(notifications.notifyFromTemplate).toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('fails closed when the admin actor is missing', async () => {
    const { ctrl } = make({ log: { id: 'l1', channel: 'EMAIL', recipientId: null, destination: 'x', body: 'b' } });
    await expect(ctrl.retry({}, 'l1', {} as any)).rejects.toThrow(/identity/i);
  });
});
