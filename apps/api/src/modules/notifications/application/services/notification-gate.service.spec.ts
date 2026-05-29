/**
 * Phase 15 (2026-05-16) — first behavioural test for the notifications
 * module. Pre-Phase-15 the module had zero specs.
 *
 * `NotificationGateService.check()` is the chokepoint applied before
 * any provider send. Four policy layers compose here:
 *
 *   1. `notification_suppressions` hard-block list (bounces, spam,
 *      compliance requests) wins over everything else.
 *   2. WhatsApp opt-out wins over the transactional bypass — Meta
 *      TOS requires hard stop after STOP keyword.
 *   3. DPDP consent (Phase 28, 2026-05-21) — for non-transactional
 *      marketing sends, ConsentService.isAllowed must return true
 *      against the channel-specific purpose.
 *   4. Per-user preference (with the `transactional: true` flag
 *      bypassing user toggles for safety-critical sends).
 *
 * The spec mocks Prisma at the table-level + the ConsentService dep
 * so we can isolate each branch without spinning up a DB.
 */
import 'reflect-metadata';
import { NotificationGateService } from './notification-gate.service';

function buildPrismaMock(opts: {
  suppression?: { reason: string; expiresAt: Date | null } | null;
  whatsappSession?: { optedOutAt: Date | null; optOutReason: string | null } | null;
  preference?: { enabled: boolean } | null;
} = {}) {
  return {
    notificationSuppression: {
      findUnique: jest.fn().mockResolvedValue(opts.suppression ?? null),
    },
    whatsappSession: {
      findUnique: jest.fn().mockResolvedValue(opts.whatsappSession ?? null),
    },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(opts.preference ?? null),
    },
  } as any;
}

function buildConsentMock(opts: { allowed?: boolean } = {}) {
  return {
    isAllowed: jest.fn().mockResolvedValue(opts.allowed ?? true),
  } as any;
}

function makeService(
  prisma: any,
  consent: any = buildConsentMock({ allowed: true }),
): NotificationGateService {
  return new NotificationGateService(prisma, consent);
}

describe('NotificationGateService.check (Phase 15)', () => {
  it('denies when the channel/destination is on the suppression list with no expiry', async () => {
    const prisma = buildPrismaMock({
      suppression: { reason: 'BOUNCED', expiresAt: null },
    });
    const result = await makeService(prisma).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'order',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('suppressed');
    }
  });

  it('ignores a suppression past its expiresAt and falls through to preference', async () => {
    const past = new Date(Date.now() - 60_000);
    const prisma = buildPrismaMock({
      suppression: { reason: 'BOUNCED', expiresAt: past },
      preference: { enabled: true },
    });
    const result = await makeService(prisma).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'order',
    });
    expect(result.allowed).toBe(true);
  });

  it('denies WhatsApp sends when the phone has opted out', async () => {
    const prisma = buildPrismaMock({
      whatsappSession: {
        optedOutAt: new Date(),
        optOutReason: 'USER_STOP',
      },
    });
    const result = await makeService(prisma).check({
      channel: 'WHATSAPP',
      destination: '+919876543210',
      recipientUserId: 'u-1',
      eventClass: 'order',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/opted out/);
    }
  });

  it('opted-out WhatsApp denies even when transactional=true (Meta TOS)', async () => {
    const prisma = buildPrismaMock({
      whatsappSession: {
        optedOutAt: new Date(),
        optOutReason: 'USER_STOP',
      },
    });
    const result = await makeService(prisma).check({
      channel: 'WHATSAPP',
      destination: '+919876543210',
      recipientUserId: 'u-1',
      eventClass: 'order',
      transactional: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('allows transactional sends past a disabled preference (safety bypass)', async () => {
    const prisma = buildPrismaMock({
      preference: { enabled: false },
    });
    const result = await makeService(prisma).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'security',
      transactional: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('denies marketing sends when the user has explicitly opted out', async () => {
    // Phase 28 (2026-05-21) — consent passes (true) so the test still
    // exercises the preference-deny path it was written for.
    const prisma = buildPrismaMock({
      preference: { enabled: false },
    });
    const consent = buildConsentMock({ allowed: true });
    const result = await makeService(prisma, consent).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'marketing',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('opted out');
    }
  });

  it('Phase 28 — denies marketing send when DPDP consent is missing', async () => {
    const prisma = buildPrismaMock({ preference: { enabled: true } });
    const consent = buildConsentMock({ allowed: false });
    const result = await makeService(prisma, consent).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'marketing',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('consent not granted');
    }
    expect(consent.isAllowed).toHaveBeenCalledWith('u-1', 'EMAIL_MARKETING');
  });

  it('Phase 28 — consent check is skipped for non-marketing eventClass', async () => {
    const prisma = buildPrismaMock({ preference: { enabled: true } });
    const consent = buildConsentMock({ allowed: false });
    const result = await makeService(prisma, consent).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'order',
    });
    // The consent stub would deny if asked; the gate must not ask
    // for non-marketing classes.
    expect(result.allowed).toBe(true);
    expect(consent.isAllowed).not.toHaveBeenCalled();
  });

  it('Phase 28 — transactional marketing bypasses consent (rare but legitimate)', async () => {
    const prisma = buildPrismaMock();
    const consent = buildConsentMock({ allowed: false });
    const result = await makeService(prisma, consent).check({
      channel: 'EMAIL',
      destination: 'user@example.com',
      recipientUserId: 'u-1',
      eventClass: 'marketing',
      transactional: true,
    });
    expect(result.allowed).toBe(true);
    expect(consent.isAllowed).not.toHaveBeenCalled();
  });

  it('allows when no suppression, no opt-out, no preference row exists (default allow)', async () => {
    const prisma = buildPrismaMock();
    const result = await makeService(prisma).check({
      channel: 'EMAIL',
      destination: 'fresh@example.com',
      recipientUserId: 'u-fresh',
      eventClass: 'order',
    });
    expect(result.allowed).toBe(true);
  });

  it('skips the preference lookup when recipientUserId is null', async () => {
    const prisma = buildPrismaMock();
    const result = await makeService(prisma).check({
      channel: 'EMAIL',
      destination: 'ad-hoc@example.com',
      recipientUserId: null,
      eventClass: 'order',
    });
    expect(result.allowed).toBe(true);
    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
  });
});
