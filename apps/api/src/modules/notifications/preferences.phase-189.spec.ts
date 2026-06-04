import { CustomerNotificationsController } from './presentation/controllers/customer-notifications.controller';
import { AdminNotificationPreferencesController } from './presentation/controllers/admin-preferences.controller';
import { NotificationUnsubscribeController } from './presentation/controllers/unsubscribe.controller';
import { EmailUnsubscribeService } from './application/services/email-unsubscribe.service';
import { NotificationPreferenceRepository } from './infrastructure/persistence/prisma/notification-preference.repository';

// Phase 189 — Customer Notification Preferences flow audit remediation.

const REQ = { userId: 'u1', ip: '1.2.3.4', headers: { 'user-agent': 'jest' } };

function customer() {
  const facade: any = {
    listPreferencesForUser: jest.fn().mockResolvedValue([]),
    setPreferencesForUser: jest.fn().mockResolvedValue([]),
    getPreferenceHistoryForUser: jest.fn().mockResolvedValue([]),
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  // Phase 190 — customer controller gained a logs repo (history endpoint).
  const logs: any = { listForRecipient: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }) };
  return { ctrl: new CustomerNotificationsController(facade, audit, logs), facade, audit };
}

describe('#1 locked-class protection', () => {
  it('rejects disabling a locked (security) class', async () => {
    const { ctrl } = customer();
    await expect(
      ctrl.setPreferences(REQ, { entries: [{ eventClass: 'security', channel: 'EMAIL', enabled: false }] } as any),
    ).rejects.toThrow(/cannot be disabled/);
  });

  it('allows disabling a non-locked class', async () => {
    const { ctrl, facade } = customer();
    await ctrl.setPreferences(REQ, { entries: [{ eventClass: 'marketing', channel: 'EMAIL', enabled: false }] } as any);
    expect(facade.setPreferencesForUser).toHaveBeenCalled();
  });
});

describe('#5 validation throws 400 (not 200-success-false)', () => {
  it('throws on an unknown eventClass', async () => {
    const { ctrl } = customer();
    await expect(
      ctrl.setPreferences(REQ, { entries: [{ eventClass: 'nope', channel: 'EMAIL', enabled: true }] } as any),
    ).rejects.toThrow(/Unknown eventClass/);
  });
});

describe('#8 audit + #CUSTOMER source on update', () => {
  it('writes an audit row + passes source CUSTOMER', async () => {
    const { ctrl, facade, audit } = customer();
    await ctrl.setPreferences(REQ, { entries: [{ eventClass: 'order', channel: 'SMS', enabled: false }] } as any);
    expect(facade.setPreferencesForUser.mock.calls[0][2]).toEqual(
      expect.objectContaining({ source: 'CUSTOMER', ipAddress: '1.2.3.4' }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.preferences.updated', actorId: 'u1' }),
    );
  });
});

describe('#1/#3 grid metadata', () => {
  it('reports locked classes as always-enabled with metadata', async () => {
    const { ctrl } = customer();
    const res = await ctrl.listPreferences(REQ);
    const security = res.data.preferences.filter((p: any) => p.eventClass === 'security');
    expect(security.length).toBe(3); // 3 channels
    expect(security.every((p: any) => p.locked && p.enabled)).toBe(true);
    const marketing = res.data.preferences.find((p: any) => p.eventClass === 'marketing');
    expect(marketing?.locked).toBe(false);
  });
});

describe('#16 opt-out-all', () => {
  it('disables every non-locked class×channel + audits', async () => {
    const { ctrl, facade, audit } = customer();
    await ctrl.optOutAll(REQ);
    const entries = facade.setPreferencesForUser.mock.calls[0][1];
    expect(entries.every((e: any) => e.enabled === false)).toBe(true);
    expect(entries.some((e: any) => e.eventClass === 'security')).toBe(false); // locked excluded
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.preferences.opt_out_all' }),
    );
  });
});

describe('#9/#12 repository history + transaction', () => {
  it('writes a history row with source + old/new in the tx', async () => {
    const upsert = jest.fn().mockResolvedValue({ enabled: false });
    const historyCreate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([{ eventClass: 'marketing', channel: 'EMAIL', enabled: true }]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({
          notificationPreference: { upsert },
          notificationPreferenceHistory: { create: historyCreate },
        }),
      ),
    };
    const repo = new NotificationPreferenceRepository(prisma);
    await repo.setMany('u1', [{ eventClass: 'marketing', channel: 'EMAIL', enabled: false }], { source: 'CUSTOMER' });
    expect(upsert).toHaveBeenCalled();
    const hist = historyCreate.mock.calls[0][0].data;
    expect(hist).toEqual(expect.objectContaining({ oldEnabled: true, newEnabled: false, source: 'CUSTOMER' }));
  });

  it('does NOT write history when the value is unchanged', async () => {
    const upsert = jest.fn().mockResolvedValue({ enabled: true });
    const historyCreate = jest.fn();
    const prisma: any = {
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([{ eventClass: 'order', channel: 'EMAIL', enabled: true }]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({ notificationPreference: { upsert }, notificationPreferenceHistory: { create: historyCreate } }),
      ),
    };
    const repo = new NotificationPreferenceRepository(prisma);
    await repo.setMany('u1', [{ eventClass: 'order', channel: 'EMAIL', enabled: true }], { source: 'CUSTOMER' });
    expect(historyCreate).not.toHaveBeenCalled();
  });
});

describe('#10/#11 admin override', () => {
  function admin() {
    const facade: any = {
      listPreferencesForUser: jest.fn().mockResolvedValue([]),
      setPreferencesForUser: jest.fn().mockResolvedValue([]),
      getPreferenceHistoryForUser: jest.fn().mockResolvedValue([]),
    };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { ctrl: new AdminNotificationPreferencesController(facade, audit), facade, audit };
  }

  it('override passes source/actor/bypassReason + audits', async () => {
    const { ctrl, facade, audit } = admin();
    await ctrl.override(
      { adminId: 'admin-2', ip: '9.9.9.9', headers: {} },
      'cust-1',
      { entries: [{ eventClass: 'security', channel: 'EMAIL', enabled: true }], bypassReason: 'court order #123', source: 'COURT_ORDER' } as any,
    );
    expect(facade.setPreferencesForUser.mock.calls[0][2]).toEqual(
      expect.objectContaining({ source: 'COURT_ORDER', updatedByAdminId: 'admin-2', bypassReason: 'court order #123' }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notifications.preferences.override' }),
    );
  });

  it('fails closed when the admin actor is missing', async () => {
    const { ctrl } = admin();
    await expect(
      ctrl.override({}, 'cust-1', { entries: [{ eventClass: 'order', channel: 'EMAIL', enabled: true }], bypassReason: 'x'.repeat(10) } as any),
    ).rejects.toThrow(/identity/i);
  });
});

describe('#14 unsubscribe token + landing', () => {
  function svc(secret = 'topsecret') {
    const env: any = { getString: (k: string, d = '') => (k === 'NOTIFICATION_UNSUBSCRIBE_SECRET' ? secret : (k === 'APP_URL' ? 'https://x.test' : d)) };
    return new EmailUnsubscribeService(env);
  }

  it('signs + verifies a round-trip token', () => {
    const s = svc();
    const token = s.sign({ userId: 'u1', eventClass: 'marketing', channel: 'EMAIL' })!;
    expect(s.verify(token)).toEqual({ userId: 'u1', eventClass: 'marketing', channel: 'EMAIL' });
  });

  it('rejects a tampered token + fails closed with no secret', () => {
    const s = svc();
    const token = s.sign({ userId: 'u1', eventClass: 'marketing', channel: 'EMAIL' })!;
    expect(s.verify(token + 'x')).toBeNull();
    expect(svc('').sign({ userId: 'u1', eventClass: 'marketing', channel: 'EMAIL' })).toBeNull();
  });

  it('landing flips the preference for a valid token', async () => {
    const facade: any = { setPreferencesForUser: jest.fn().mockResolvedValue([]) };
    const unsub: any = { verify: jest.fn().mockReturnValue({ userId: 'u9', eventClass: 'marketing', channel: 'EMAIL' }) };
    const ctrl = new NotificationUnsubscribeController(facade, unsub);
    const html = await ctrl.handle('tok');
    expect(html).toContain('unsubscribed');
    expect(facade.setPreferencesForUser).toHaveBeenCalledWith(
      'u9',
      [{ eventClass: 'marketing', channel: 'EMAIL', enabled: false }],
      expect.objectContaining({ source: 'UNSUBSCRIBE_LINK' }),
    );
  });

  it('landing refuses a locked-class token + an invalid token', async () => {
    const facade: any = { setPreferencesForUser: jest.fn() };
    const lockedUnsub: any = { verify: jest.fn().mockReturnValue({ userId: 'u9', eventClass: 'security', channel: 'EMAIL' }) };
    expect(await new NotificationUnsubscribeController(facade, lockedUnsub).handle('tok')).toContain('cannot be unsubscribed');
    const badUnsub: any = { verify: jest.fn().mockReturnValue(null) };
    expect(await new NotificationUnsubscribeController(facade, badUnsub).handle('bad')).toContain('could not be verified');
    expect(facade.setPreferencesForUser).not.toHaveBeenCalled();
  });
});
