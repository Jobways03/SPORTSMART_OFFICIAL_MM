import { TemplateRenderer } from './application/services/template-renderer.service';
import { AdminNotificationTemplatesController } from './presentation/controllers/preview-template.controller';

// Phase 188 — Template Editor + Preview flow audit remediation.

describe('#8 channel-aware rendering', () => {
  const r = new TemplateRenderer();
  it('HTML-escapes for EMAIL (default)', () => {
    expect(r.render('Hi {{name}}', { name: 'A&B <x>' }, { channel: 'EMAIL' })).toBe('Hi A&amp;B &lt;x&gt;');
    expect(r.render('Hi {{name}}', { name: 'A&B' })).toBe('Hi A&amp;B'); // default = escape
  });
  it('does NOT HTML-escape for SMS / WhatsApp', () => {
    expect(r.render('Hi {{name}}', { name: 'A&B' }, { channel: 'SMS' })).toBe('Hi A&B');
    expect(r.render('Hi {{name}}', { name: 'A&B' }, { channel: 'WHATSAPP' })).toBe('Hi A&B');
  });
  it('strips control chars on plain-text channels', () => {
    expect(r.render('{{x}}', { x: 'ab' }, { channel: 'SMS' })).toBe('ab');
  });
});

describe('#1 unsupported-syntax detection', () => {
  const r = new TemplateRenderer();
  it('flags block helpers / conditionals / partials', () => {
    expect(r.validateSyntax('{{#if vip}}hi{{/if}}').length).toBeGreaterThan(0);
    expect(r.validateSyntax('{{#each items}}x{{/each}}').length).toBeGreaterThan(0);
    expect(r.validateSyntax('{{> header}}').length).toBeGreaterThan(0);
    expect(r.validateSyntax('{{formatDate when}}').length).toBeGreaterThan(0);
  });
  it('accepts simple var + dotted-path + raw', () => {
    expect(r.validateSyntax('Hi {{name}} {{user.first}} {{{rawHtml}}}')).toEqual([]);
  });
});

describe('#16 referencedVars', () => {
  const r = new TemplateRenderer();
  it('lists every referenced path (escaped + raw)', () => {
    expect(r.referencedVars('Hi {{a}} {{b.c}} {{{d}}}').sort()).toEqual(['a', 'b.c', 'd']);
  });
});

describe('template controller — versioning / validation / preview', () => {
  function make(over: { before?: any; template?: any } = {}) {
    const upsertFn = jest.fn().mockImplementation(({ create, update }: any) =>
      Promise.resolve({ id: 't1', key: 'k', version: update?.version ?? create?.version ?? 1, ...(create ?? {}), ...(update ?? {}) }),
    );
    const updateFn = jest.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 't1', key: 'k', channel: 'EMAIL', subject: 's', body: 'b', active: data.active, version: data.version }),
    );
    const historyCreate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue(over.before ?? null),
        upsert: upsertFn,
        update: updateFn,
      },
      notificationTemplateHistory: { create: historyCreate, findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({
          notificationTemplate: { upsert: upsertFn, update: updateFn },
          notificationTemplateHistory: { create: historyCreate },
        }),
      ),
    };
    const registry: any = { get: jest.fn().mockResolvedValue(over.template ?? null) };
    const renderer = new TemplateRenderer();
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const notifications: any = { notify: jest.fn().mockResolvedValue('job-1') };
    return {
      ctrl: new AdminNotificationTemplatesController(prisma, registry, renderer, audit, notifications),
      prisma,
      historyCreate,
    };
  }

  it('#10 rejects an EMAIL template with no subject', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.upsert({ adminId: 'a1' }, 'order.x.email', { channel: 'EMAIL', body: 'b' } as any),
    ).rejects.toThrow(/subject is required/);
  });

  it('#1 rejects a template body with unsupported syntax at save', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.upsert({ adminId: 'a1' }, 'order.x.sms', { channel: 'SMS', body: '{{#if v}}x{{/if}}' } as any),
    ).rejects.toThrow(/Unsupported template syntax/);
  });

  it('#4/#6 writes a history snapshot + version + actor on create', async () => {
    const { ctrl, prisma, historyCreate } = make();
    await ctrl.upsert({ adminId: 'admin-5' }, 'order.x.sms', { channel: 'SMS', body: 'Hi {{name}}' } as any);
    const create = prisma.notificationTemplate.upsert.mock.calls[0][0].create;
    expect(create.version).toBe(1);
    expect(create.createdByAdminId).toBe('admin-5');
    const hist = historyCreate.mock.calls[0][0].data;
    expect(hist.changeType).toBe('CREATE');
    expect(hist.changedByAdminId).toBe('admin-5');
  });

  it('#4 bumps version + history on update', async () => {
    const { ctrl, prisma, historyCreate } = make({ before: { id: 't1', version: 3, channel: 'SMS', subject: null, body: 'old', active: true } });
    await ctrl.upsert({ adminId: 'admin-5' }, 'order.x.sms', { channel: 'SMS', body: 'new {{x}}' } as any);
    const update = prisma.notificationTemplate.upsert.mock.calls[0][0].update;
    expect(update.version).toBe(4);
    expect(historyCreate.mock.calls[0][0].data.changeType).toBe('UPDATE');
  });

  it('#16/#14/#15 preview returns missing-vars, channel hints + raw-html flag', async () => {
    const { ctrl } = make({
      template: { key: 'k', channel: 'SMS', subject: null, body: 'Hi {{name}}, code {{code}}', variablesSchema: { required: ['name'] } },
    });
    const res = await ctrl.preview('k', { vars: { code: '123' } } as any);
    expect(res.data.missingVars).toContain('name');
    expect(res.data.missingRequiredVars).toContain('name');
    expect(res.data.channelHints).toHaveProperty('segments');
    expect(res.data.containsRawHtml).toBe(false);
  });

  it('#12 rejects an over-large preview payload', async () => {
    const { ctrl } = make({ template: { key: 'k', channel: 'EMAIL', subject: 's', body: 'b' } });
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) huge[`k${i}`] = i;
    await expect(ctrl.preview('k', { vars: huge } as any)).rejects.toThrow(/50 keys/);
  });
});
