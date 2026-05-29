import 'reflect-metadata';
import { NotificationGateService } from '../../src/modules/notifications/application/services/notification-gate.service';

/**
 * Phase 8 (PR 8.2) — NotificationGateService.
 *
 * Trust boundaries:
 *   1. Suppression list always blocks.
 *   2. Transactional flag bypasses preferences (but NOT suppression).
 *   3. User opt-out blocks non-transactional sends.
 *   4. Phase 28 (2026-05-21) — DPDP consent gates non-transactional
 *      marketing sends via ConsentService.isAllowed; tests below pass
 *      a stub that defaults to "allowed=true" so this layer is
 *      neutralised for branches that exercise the other layers.
 *
 * Pin every branch.
 */
describe('NotificationGateService', () => {
  function setup(opts: {
    suppression?: { reason: string; expiresAt?: Date | null } | null;
    preference?: { enabled: boolean } | null;
    consentAllowed?: boolean;
  } = {}) {
    const fakePrisma: any = {
      notificationSuppression: {
        findUnique: jest.fn(async () =>
          opts.suppression ? { ...opts.suppression } : null,
        ),
        upsert: jest.fn(async () => ({})),
      },
      notificationPreference: {
        findUnique: jest.fn(async () =>
          opts.preference ? { ...opts.preference } : null,
        ),
      },
      whatsappSession: {
        findUnique: jest.fn(async () => null),
      },
    };
    const consentStub: any = {
      isAllowed: jest.fn().mockResolvedValue(opts.consentAllowed ?? true),
    };
    return new NotificationGateService(fakePrisma, consentStub);
  }

  it('allows when no suppression + no preference row', async () => {
    const gate = setup();
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'a@b.com',
      recipientUserId: 'u1',
      eventClass: 'order',
    });
    expect(d.allowed).toBe(true);
  });

  it('blocks when suppression row is active', async () => {
    const gate = setup({ suppression: { reason: 'BOUNCED' } });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'bouncey@b.com',
      recipientUserId: 'u1',
      eventClass: 'order',
    });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false ? d.reason : '').toMatch(/BOUNCED/);
  });

  it('ignores expired suppression', async () => {
    const past = new Date(Date.now() - 60_000);
    const gate = setup({ suppression: { reason: 'BOUNCED', expiresAt: past } });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'bouncey@b.com',
      recipientUserId: 'u1',
      eventClass: 'order',
    });
    expect(d.allowed).toBe(true);
  });

  it('honours active future suppression', async () => {
    const future = new Date(Date.now() + 60_000);
    const gate = setup({
      suppression: { reason: 'TEMP_BLOCK', expiresAt: future },
    });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'a@b.com',
      recipientUserId: 'u1',
      eventClass: 'order',
    });
    expect(d.allowed).toBe(false);
  });

  it('blocks when user opted out (preference.enabled=false)', async () => {
    const gate = setup({ preference: { enabled: false } });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'a@b.com',
      recipientUserId: 'u1',
      eventClass: 'marketing',
    });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false ? d.reason : '').toMatch(/opted out/);
  });

  it('transactional bypass overrides user opt-out', async () => {
    const gate = setup({ preference: { enabled: false } });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'a@b.com',
      recipientUserId: 'u1',
      eventClass: 'security',
      transactional: true,
    });
    expect(d.allowed).toBe(true);
  });

  it('transactional bypass does NOT override active suppression', async () => {
    const gate = setup({
      suppression: { reason: 'SPAM_COMPLAINT' },
      preference: { enabled: true },
    });
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'spammy@b.com',
      recipientUserId: 'u1',
      eventClass: 'security',
      transactional: true,
    });
    expect(d.allowed).toBe(false);
  });

  it('allows when no recipientUserId (raw destination, no preference applies)', async () => {
    const gate = setup();
    const d = await gate.check({
      channel: 'EMAIL' as any,
      destination: 'unknown@b.com',
      recipientUserId: null,
      eventClass: 'order',
    });
    expect(d.allowed).toBe(true);
  });
});
