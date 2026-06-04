import { TemplateRenderer } from './application/services/template-renderer.service';
import { TemplateRegistry } from './application/services/template-registry.service';
import { NotificationsPublicFacade } from './application/facades/notifications-public.facade';
import { SmsNotificationProvider } from './infrastructure/providers/sms.provider';
import { SmsService } from '../../integrations/sms/sms.service';
import { AdminNotificationTemplatesController } from './presentation/controllers/preview-template.controller';
import { NotificationDeliveryReceiptController } from './presentation/controllers/delivery-receipt.controller';
import { sanitizeEmailTemplateBody } from '../../core/utils/rich-text-sanitizer';

// Phase 185 — Template-Based Notifications flow audit remediation.

describe('#3 EMAIL template sanitizer (preserves styling, strips XSS)', () => {
  it('strips <script>/<iframe> but keeps inline styles + structure', () => {
    const dirty =
      '<div style="color:#16a34a;padding:16px"><h3>Hi {{name}}</h3>' +
      '<script>steal()</script><iframe src="evil"></iframe>' +
      '<a href="{{orderUrl}}">Track</a></div>';
    const clean = sanitizeEmailTemplateBody(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/steal\(\)/);
    expect(clean).not.toMatch(/<iframe/i);
    // styling + placeholders + structure preserved
    expect(clean).toContain('style="color:#16a34a;padding:16px"');
    expect(clean).toContain('{{name}}');
    expect(clean).toContain('{{orderUrl}}');
    expect(clean).toContain('<h3>');
  });

  it('neutralises javascript: and expression() in style values', () => {
    const dirty = '<a href="javascript:alert(1)" style="x:expression(alert(1))">hi</a>';
    const clean = sanitizeEmailTemplateBody(dirty);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/expression\s*\(/i);
  });
});

describe('#6 renderer — required-var validation', () => {
  const renderer = new TemplateRenderer();
  it('reports missing required vars', () => {
    expect(renderer.findMissingRequiredVars({ required: ['a', 'b'] }, { a: 'x' })).toEqual(['b']);
  });
  it('treats empty/blank as missing', () => {
    expect(renderer.findMissingRequiredVars({ required: ['a'] }, { a: '   ' })).toEqual(['a']);
  });
  it('no schema → nothing required', () => {
    expect(renderer.findMissingRequiredVars(undefined, {})).toEqual([]);
    expect(renderer.findMissingRequiredVars({}, {})).toEqual([]);
  });
});

describe('#14 renderer — internal-field stripping', () => {
  it('drops _-prefixed / internal* / riskScore / admin* keys (deep)', () => {
    const out = TemplateRenderer.stripInternalVars({
      customerName: 'Alice',
      _secret: 'x',
      internalNotes: 'do not send',
      riskScore: 92,
      adminFlag: true,
      nested: { _hidden: 1, ok: 2 },
    });
    expect(out).toEqual({ customerName: 'Alice', nested: { ok: 2 } });
  });
});

describe('#1/#4 SMS provider — DLT enforcement', () => {
  const realEnv = process.env.SMS_DLT_ENFORCED;
  afterEach(() => {
    if (realEnv === undefined) delete process.env.SMS_DLT_ENFORCED;
    else process.env.SMS_DLT_ENFORCED = realEnv;
  });

  function provider(isReal: boolean, sendImpl?: any) {
    const sms: any = {
      isRealProvider: () => isReal,
      send: jest.fn().mockResolvedValue(sendImpl ?? { sent: true, providerMessageId: 'm1' }),
    };
    return { provider: new SmsNotificationProvider(sms as SmsService), sms };
  }

  it('rejects (non-retryable) an SMS with no DLT id when enforced + real provider', async () => {
    process.env.SMS_DLT_ENFORCED = 'true';
    const { provider: p, sms } = provider(true);
    const r = await p.send({ to: '+919876543210', body: 'hi', templateKey: 'order.placed.sms' });
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.failureReason).toMatch(/DLT/);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('sends when a DLT id is present', async () => {
    process.env.SMS_DLT_ENFORCED = 'true';
    const { provider: p, sms } = provider(true);
    const r = await p.send({ to: '+919876543210', body: 'hi', dltTemplateId: 'DLT123' });
    expect(r.success).toBe(true);
    expect(sms.send).toHaveBeenCalledWith(
      expect.objectContaining({ dltTemplateId: 'DLT123', to: '+919876543210' }),
    );
  });

  it('does NOT enforce DLT for the stub provider (dev/test)', async () => {
    process.env.SMS_DLT_ENFORCED = 'true';
    const { provider: p, sms } = provider(false);
    const r = await p.send({ to: '+919876543210', body: 'hi' });
    expect(r.success).toBe(true);
    expect(sms.send).toHaveBeenCalled();
  });
});

describe('#1 SmsService stub', () => {
  function svc(provider = 'stub') {
    const env: any = { getString: (k: string, d = '') => (k === 'SMS_PROVIDER' ? provider : d) };
    const logger: any = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn() };
    return new SmsService(env, logger);
  }
  it('reports success for a valid number', async () => {
    const r = await svc().send({ to: '+91 98765 43210', body: 'hi' });
    expect(r.sent).toBe(true);
  });
  it('rejects an invalid number', async () => {
    const r = await svc().send({ to: '123', body: 'hi' });
    expect(r.sent).toBe(false);
    expect(r.blockedReason).toBe('INVALID_NUMBER');
  });
});

describe('#4/#6/#14/#17 facade.notifyFromTemplate', () => {
  function make(template: any) {
    const queue: any = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const registry: any = { get: jest.fn().mockResolvedValue(template) };
    const renderer = new TemplateRenderer();
    const preferences: any = { isEnabled: jest.fn().mockResolvedValue(true) };
    const logRepo: any = {};
    return {
      facade: new NotificationsPublicFacade(queue, registry, renderer, preferences, logRepo),
      queue,
    };
  }
  const baseTpl = {
    key: 'order.placed.sms',
    channel: 'SMS',
    subject: null,
    body: 'Hi {{customerName}} {{_secret}}',
    customerVisibleOnly: true,
    variablesSchema: { required: ['customerName'] },
    dltTemplateId: 'DLT1',
    dltHeaderId: 'HDR1',
  };

  it('drops the send when a required var is missing (#6)', async () => {
    const { facade, queue } = make(baseTpl);
    const id = await facade.notifyFromTemplate({
      eventClass: 'order', templateKey: 'order.placed.sms', recipientId: 'u1', vars: {},
    });
    expect(id).toBe('');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('strips internal vars (#14), threads DLT ids (#4) + triggerSource (#17)', async () => {
    const { facade, queue } = make(baseTpl);
    await facade.notifyFromTemplate({
      eventClass: 'order',
      templateKey: 'order.placed.sms',
      recipientId: 'u1',
      vars: { customerName: 'Alice', _secret: 'leak' },
    });
    const arg = queue.enqueue.mock.calls[0][0];
    expect(arg.body).toBe('Hi Alice '); // _secret stripped → empty
    expect(arg.dltTemplateId).toBe('DLT1');
    expect(arg.dltHeaderId).toBe('HDR1');
    expect(arg.triggerSource).toBe('EVENT_BUS:order');
  });
});

describe('#12 facade DLQ + #5 delivery/cancel', () => {
  function make() {
    const queue: any = {
      getStats: jest.fn().mockResolvedValue({ ready: 1, delayed: 2, deadLetter: 3 }),
      listDeadLetters: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      replayDeadLetter: jest.fn().mockResolvedValue('job-9'),
      discardDeadLetter: jest.fn(),
    };
    const logRepo: any = {
      recordCancellation: jest.fn().mockResolvedValue({}),
      markDelivered: jest.fn().mockResolvedValue(1),
    };
    return {
      facade: new NotificationsPublicFacade(queue, {} as any, {} as any, {} as any, logRepo),
      queue,
      logRepo,
    };
  }

  it('discard records a CANCELLED log row (#5)', async () => {
    const { facade, queue, logRepo } = make();
    queue.discardDeadLetter.mockResolvedValue({ job: { channel: 'EMAIL', body: 'x', attemptNumber: 3 }, reason: 'boom', deadLetteredAt: 1 });
    const ok = await facade.discardDeadLetter(0, 'cleanup');
    expect(ok).toBe(true);
    expect(logRepo.recordCancellation).toHaveBeenCalled();
  });

  it('discard returns false when the entry is gone', async () => {
    const { facade, queue, logRepo } = make();
    queue.discardDeadLetter.mockResolvedValue(null);
    expect(await facade.discardDeadLetter(0, 'x')).toBe(false);
    expect(logRepo.recordCancellation).not.toHaveBeenCalled();
  });

  it('records a delivery receipt (#5)', async () => {
    const { facade, logRepo } = make();
    const when = new Date();
    await facade.recordDeliveryReceipt('pm-1', when);
    expect(logRepo.markDelivered).toHaveBeenCalledWith('pm-1', when);
  });
});

describe('#5 delivery-receipt webhook — secret gate', () => {
  const real = process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET;
  afterEach(() => {
    if (real === undefined) delete process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET;
    else process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET = real;
  });

  it('rejects a wrong/absent secret and fails closed when unset', async () => {
    const facade: any = { recordDeliveryReceipt: jest.fn() };
    const ctrl = new NotificationDeliveryReceiptController(facade);
    delete process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET;
    await expect(ctrl.receipt('anything', { providerMessageId: 'm' } as any)).rejects.toThrow();
    process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET = 'topsecret';
    await expect(ctrl.receipt('wrong', { providerMessageId: 'm' } as any)).rejects.toThrow();
    expect(facade.recordDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('records delivery on a valid secret', async () => {
    const facade: any = { recordDeliveryReceipt: jest.fn().mockResolvedValue(1) };
    const ctrl = new NotificationDeliveryReceiptController(facade);
    process.env.NOTIFICATION_DELIVERY_RECEIPT_SECRET = 'topsecret';
    const r = await ctrl.receipt('topsecret', { providerMessageId: 'm-1' } as any);
    expect(r.success).toBe(true);
    expect(facade.recordDeliveryReceipt).toHaveBeenCalledWith('m-1', expect.any(Date));
  });
});

describe('#2/#3/#7/#11 template controller', () => {
  function make() {
    // Phase 188 — upsert now runs inside $transaction + writes a history row.
    const upsertFn = jest
      .fn()
      .mockImplementation(({ create }: any) => Promise.resolve({ id: 't1', key: 'k', version: 1, ...create }));
    const historyCreate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null), upsert: upsertFn },
      notificationTemplateHistory: { create: historyCreate },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({
          notificationTemplate: { upsert: upsertFn },
          notificationTemplateHistory: { create: historyCreate },
        }),
      ),
    };
    const registry: any = {};
    const renderer = new TemplateRenderer();
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const notifications: any = {};
    return {
      ctrl: new AdminNotificationTemplatesController(prisma, registry, renderer, audit, notifications),
      prisma,
      audit,
    };
  }

  it('rejects a key whose channel suffix contradicts the channel (#7)', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.upsert({ adminId: 'a1' }, 'order.placed.sms', { channel: 'EMAIL', body: 'x' } as any),
    ).rejects.toThrow(/suffix must match/);
  });

  it('sanitizes EMAIL body + writes an audit log (#3/#11)', async () => {
    const { ctrl, prisma, audit } = make();
    await ctrl.upsert(
      { adminId: 'a1' },
      'order.placed.email',
      // Phase 188 (#10) — EMAIL now requires a subject.
      { channel: 'EMAIL', subject: 'Hi', body: '<div style="color:red">Hi</div><script>x()</script>' } as any,
    );
    const created = prisma.notificationTemplate.upsert.mock.calls[0][0].create;
    expect(created.body).toContain('style="color:red"');
    expect(created.body).not.toMatch(/<script/i);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.template.created', actorId: 'a1' }),
    );
  });
});

describe('#13 wired DEFAULT_TEMPLATES coverage', () => {
  // The keys actually dispatched via notifyFromTemplate must resolve.
  const prisma: any = { notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) } };
  const registry = new TemplateRegistry(prisma);
  it.each(['refund.completed.email', 'ticket.replied.email', 'wallet.credited.email'])(
    'resolves the code-default for %s',
    async (key) => {
      const tpl = await registry.get(key);
      expect(tpl).not.toBeNull();
      expect(tpl!.channel).toBe('EMAIL');
      expect(tpl!.customerVisibleOnly).toBe(true);
    },
  );
});
