import { AdminDispatchService } from './application/services/admin-dispatch.service';
import { AdminNotificationDispatchController } from './presentation/controllers/admin-dispatch.controller';

// Phase 187 — Admin Notification Dispatch flow audit remediation.

function makeService(over: {
  existing?: any;
  resolve?: { found: boolean; destination: string | null };
  template?: any;
  notifyJobId?: string;
} = {}) {
  const prisma: any = {
    notificationDispatch: {
      findUnique: jest.fn().mockResolvedValue(over.existing ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const notifications: any = {
    notifyFromTemplate: jest.fn().mockResolvedValue(over.notifyJobId ?? 'job-1'),
    notify: jest.fn().mockResolvedValue(over.notifyJobId ?? 'job-1'),
  };
  const recipients: any = {
    resolve: jest.fn().mockResolvedValue(over.resolve ?? { found: true, destination: 'x@y.com' }),
  };
  const registry: any = {
    get: jest.fn().mockResolvedValue(
      over.template ?? { key: 'k', channel: 'EMAIL', subject: 's', body: 'b' },
    ),
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  return {
    svc: new AdminDispatchService(prisma, notifications, recipients, registry, audit),
    prisma,
    notifications,
    recipients,
    audit,
  };
}

describe('#12 template eventClass must be registered', () => {
  it('rejects an unregistered eventClass', async () => {
    const { svc } = makeService();
    await expect(
      svc.dispatchTemplate({ adminId: 'a1', templateKey: 'k', recipientId: 'u1', eventClass: 'admin.manual' }),
    ).rejects.toThrow(/must be one of/);
  });

  it('accepts a registered eventClass', async () => {
    const { svc, notifications } = makeService();
    const r = await svc.dispatchTemplate({ adminId: 'a1', templateKey: 'k', recipientId: 'u1', eventClass: 'order' });
    expect(r.status).toBe('ENQUEUED');
    expect(notifications.notifyFromTemplate).toHaveBeenCalled();
  });
});

describe('#10 recipient existence', () => {
  it('404s an unknown recipient (template)', async () => {
    const { svc } = makeService({ resolve: { found: false, destination: null } });
    await expect(
      svc.dispatchTemplate({ adminId: 'a1', templateKey: 'k', recipientId: 'ghost', eventClass: 'order' }),
    ).rejects.toThrow(/Unknown recipient/);
  });

  it('404s an unknown recipient (raw)', async () => {
    const { svc } = makeService({ resolve: { found: false, destination: null } });
    await expect(
      svc.dispatchRaw({
        adminId: 'a1', channel: 'EMAIL', recipientId: 'ghost', body: 'hi',
        alertType: 'ACCOUNT_SECURITY', bypassReason: 'security check needed', confirmed: true,
      }),
    ).rejects.toThrow(/Unknown recipient/);
  });
});

describe('#8 idempotency dedup', () => {
  it('returns the existing dispatch without re-sending', async () => {
    const { svc, notifications } = makeService({
      existing: { jobId: 'old-job', status: 'ENQUEUED' },
    });
    const r = await svc.dispatchTemplate({
      adminId: 'a1', templateKey: 'k', recipientId: 'u1', eventClass: 'order', idempotencyKey: 'key-123456',
    });
    expect(r.deduped).toBe(true);
    expect(r.jobId).toBe('old-job');
    expect(notifications.notifyFromTemplate).not.toHaveBeenCalled();
  });
});

describe('#3/#7 dispatch row + audit (template)', () => {
  it('records a NotificationDispatch row + audit with the actor', async () => {
    const { svc, prisma, audit } = makeService();
    await svc.dispatchTemplate({ adminId: 'admin-9', templateKey: 'order.shipped', recipientId: 'u1', eventClass: 'order' });
    const row = prisma.notificationDispatch.create.mock.calls[0][0].data;
    expect(row.dispatchedByAdminId).toBe('admin-9');
    expect(row.dispatchPath).toBe('TEMPLATE');
    expect(row.bypassOptOut).toBe(false);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.dispatch.template', actorId: 'admin-9' }),
    );
  });
});

describe('#4/#14 raw requires confirmation', () => {
  it('rejects an unconfirmed raw dispatch', async () => {
    const { svc } = makeService();
    await expect(
      svc.dispatchRaw({
        adminId: 'a1', channel: 'EMAIL', recipientId: 'u1', body: 'hi',
        alertType: 'FRAUD_ALERT', bypassReason: 'chargeback notice', confirmed: false,
      }),
    ).rejects.toThrow(/confirmation/);
  });
});

describe('#15/#13 raw EMAIL sanitized + account-notice banner', () => {
  it('strips script + prepends the banner', async () => {
    const { svc, notifications } = makeService();
    await svc.dispatchRaw({
      adminId: 'a1', channel: 'EMAIL', recipientId: 'u1',
      body: '<div>hi</div><script>steal()</script>',
      alertType: 'ACCOUNT_SECURITY', bypassReason: 'suspicious login alert', confirmed: true,
    });
    const sentBody = notifications.notify.mock.calls[0][0].body;
    expect(sentBody).not.toMatch(/<script/i);
    expect(sentBody).toContain('Important account notice');
  });
});

describe('#17 raw `to` format validation', () => {
  it('rejects a malformed email when no recipientId', async () => {
    const { svc } = makeService();
    await expect(
      svc.dispatchRaw({
        adminId: 'a1', channel: 'EMAIL', to: 'not-an-email', body: 'hi',
        alertType: 'CRITICAL_SERVICE', bypassReason: 'platform outage notice', confirmed: true,
      }),
    ).rejects.toThrow(/valid email/);
  });

  it('accepts a valid phone for SMS', async () => {
    const { svc, notifications } = makeService();
    const r = await svc.dispatchRaw({
      adminId: 'a1', channel: 'SMS', to: '+919876543210', body: 'alert',
      alertType: 'CRITICAL_SERVICE', bypassReason: 'platform outage notice', confirmed: true,
    });
    expect(r.status).toBe('ENQUEUED');
    expect(notifications.notify).toHaveBeenCalled();
  });
});

describe('#3/#4/#7 raw dispatch row records bypass justification', () => {
  it('persists bypassOptOut + reason + alertType + actor', async () => {
    const { svc, prisma, audit } = makeService();
    await svc.dispatchRaw({
      adminId: 'admin-7', channel: 'EMAIL', recipientId: 'u1', body: 'notice',
      alertType: 'COMPLIANCE_NOTICE', bypassReason: 'GDPR data request ack', confirmed: true,
    });
    const row = prisma.notificationDispatch.create.mock.calls[0][0].data;
    expect(row.dispatchPath).toBe('RAW');
    expect(row.bypassOptOut).toBe(true);
    expect(row.bypassReason).toBe('GDPR data request ack');
    expect(row.alertType).toBe('COMPLIANCE_NOTICE');
    expect(row.dispatchedByAdminId).toBe('admin-7');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.dispatch.raw' }),
    );
  });
});

describe('#1/#2 controller routing', () => {
  function ctrl() {
    const dispatch: any = {
      dispatchTemplate: jest.fn().mockResolvedValue({ jobId: 'j', eventId: 'e', status: 'ENQUEUED', deduped: false, message: 'ok' }),
      dispatchRaw: jest.fn().mockResolvedValue({ jobId: 'j', eventId: 'e', status: 'ENQUEUED', deduped: false, message: 'ok' }),
    };
    return { c: new AdminNotificationDispatchController(dispatch), dispatch };
  }

  it('legacy /dispatch rejects a raw body (no templateKey) → use /dispatch/raw', async () => {
    const { c } = ctrl();
    await expect(c.legacyDispatch({ adminId: 'a1' }, { channel: 'EMAIL', body: 'x' } as any)).rejects.toThrow(/dispatch\/raw/);
  });

  it('legacy /dispatch routes a template body to dispatchTemplate', async () => {
    const { c, dispatch } = ctrl();
    await c.legacyDispatch({ adminId: 'a1' }, { templateKey: 'k', recipientId: 'u1', eventClass: 'order' } as any);
    expect(dispatch.dispatchTemplate).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', templateKey: 'k' }));
  });

  it('fails closed when the admin actor cannot be resolved (#3)', async () => {
    const { c } = ctrl();
    await expect(c.dispatchRaw({}, { channel: 'EMAIL', body: 'x', alertType: 'FRAUD_ALERT', bypassReason: 'x'.repeat(10), confirmed: true } as any)).rejects.toThrow(/identity/i);
  });
});
