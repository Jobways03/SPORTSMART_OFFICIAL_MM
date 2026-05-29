import 'reflect-metadata';
import { EmailNotificationHandler } from '../../src/integrations/email/event-handlers/email-notification.handler';

/**
 * Phase 20 (2026-05-20) — Franchise lifecycle email handler tests.
 *
 * Pins each @OnEvent('franchise.*') handler:
 *   • franchise.registered          → owner welcome + verify link
 *   • franchise.email_verified      → next-step KYC email to owner
 *   • franchise.onboarding_submitted → admin notification
 *   • franchise.status_updated      → owner notification per variant
 *       (APPROVED, ACTIVE, SUSPENDED, DEACTIVATED, anything else = noop)
 *   • franchise.verification_updated → owner email only for VERIFIED + REJECTED
 *   • franchise.account_locked      → owner notification
 *
 * Each handler swallows EmailService errors (logged, not thrown) — the
 * audit of "lifecycle emails are not load-bearing" is enforced here.
 */

describe('EmailNotificationHandler — franchise lifecycle', () => {
  const FRANCHISE = {
    email: 'owner@example.com',
    ownerName: 'Franchise Owner',
    businessName: 'Owner Sports Co',
    status: 'PENDING',
  };

  const buildHandler = (overrides: Partial<any> = {}) => {
    const emailService = {
      send: jest.fn().mockResolvedValue(undefined),
      ...((overrides as any).emailService ?? {}),
    } as any;
    const prisma = {
      franchisePartner: {
        findUnique: jest.fn().mockResolvedValue(FRANCHISE),
      },
      ...((overrides as any).prisma ?? {}),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;
    const envService = {
      getString: (k: string, d?: string) => {
        if (k === 'ADMIN_SEED_EMAIL') return 'admin@sportsmart.com';
        if (k === 'APP_URL') return 'https://example.test';
        return d ?? '';
      },
    } as any;
    return {
      handler: new EmailNotificationHandler(emailService, prisma, logger, envService),
      emailService,
      prisma,
      logger,
    };
  };

  const baseEvent = (eventName: string, payload: any) => ({
    eventName,
    aggregate: 'franchise',
    aggregateId: payload.franchiseId,
    occurredAt: new Date(),
    payload,
  });

  describe('franchise.registered', () => {
    it('emails the owner with a verify-link CTA', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseRegistered(
        baseEvent('franchise.registered', {
          franchiseId: 'f-1',
          email: 'owner@example.com',
          ownerName: 'Owner',
          businessName: 'OSC',
        }) as any,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.to).toBe('owner@example.com');
      expect(call.subject).toMatch(/verify.+franchise.+email/i);
      expect(call.html).toContain('register/verify?email=owner%40example.com');
      expect(call.html).toContain('Owner');
      expect(call.html).toContain('OSC');
    });

    it('swallows EmailService errors (logs but does not throw)', async () => {
      const { handler, emailService, logger } = buildHandler({
        emailService: {
          send: jest.fn().mockRejectedValue(new Error('smtp down')),
        },
      });
      await expect(
        handler.onFranchiseRegistered(
          baseEvent('franchise.registered', {
            franchiseId: 'f-1',
            email: 'owner@example.com',
            ownerName: 'Owner',
            businessName: 'OSC',
          }) as any,
        ),
      ).resolves.toBeUndefined();
      expect(emailService.send).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to send franchise.registered email/),
      );
    });

    it('HTML-escapes the owner-controlled businessName and ownerName', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseRegistered(
        baseEvent('franchise.registered', {
          franchiseId: 'f-1',
          email: 'owner@example.com',
          ownerName: 'Sue<script>',
          businessName: 'Acme "Sports" Co',
        }) as any,
      );
      const call = emailService.send.mock.calls[0][0];
      expect(call.html).not.toContain('<script>');
      expect(call.html).toContain('Sue&lt;script&gt;');
      expect(call.html).toContain('&quot;Sports&quot;');
    });
  });

  describe('franchise.email_verified', () => {
    it('emails the owner with a continue-onboarding CTA', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseEmailVerified(
        baseEvent('franchise.email_verified', {
          franchiseId: 'f-1',
        }) as any,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.to).toBe('owner@example.com');
      expect(call.subject).toMatch(/Email verified/i);
      expect(call.html).toContain('/dashboard/onboarding');
    });

    it('silent no-op when franchise lookup fails (deleted/missing)', async () => {
      const { handler, emailService } = buildHandler({
        prisma: {
          franchisePartner: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        },
      });
      await handler.onFranchiseEmailVerified(
        baseEvent('franchise.email_verified', { franchiseId: 'f-1' }) as any,
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });

  describe('franchise.onboarding_submitted', () => {
    it('emails the admin with KYC review CTA + masked PAN', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseOnboardingSubmitted(
        baseEvent('franchise.onboarding_submitted', {
          franchiseId: 'f-1',
          legalBusinessName: 'Acme Sports Pvt Ltd',
          gstRegistrationType: 'REGULAR',
          panLast4: '234F',
        }) as any,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.to).toBe('admin@sportsmart.com');
      expect(call.subject).toMatch(/KYC pending review/i);
      expect(call.html).toContain('Acme Sports Pvt Ltd');
      expect(call.html).toContain('REGULAR');
      expect(call.html).toContain('234F');
      expect(call.html).toContain('/admin/franchises/f-1');
    });
  });

  describe('franchise.status_updated', () => {
    const cases = [
      { newStatus: 'APPROVED', expectedSubject: /approved/i, color: '#15803d' },
      { newStatus: 'ACTIVE', expectedSubject: /active/i, color: '#15803d' },
      { newStatus: 'SUSPENDED', expectedSubject: /suspended/i, color: '#dc2626' },
      { newStatus: 'DEACTIVATED', expectedSubject: /deactivated/i, color: '#dc2626' },
    ];
    cases.forEach(({ newStatus, expectedSubject }) => {
      it(`${newStatus} → emails the owner`, async () => {
        const { handler, emailService } = buildHandler();
        await handler.onFranchiseStatusUpdated(
          baseEvent('franchise.status_updated', {
            franchiseId: 'f-1',
            previousStatus: 'PENDING',
            newStatus,
          }) as any,
        );
        expect(emailService.send).toHaveBeenCalledTimes(1);
        const call = emailService.send.mock.calls[0][0];
        expect(call.to).toBe('owner@example.com');
        expect(call.subject).toMatch(expectedSubject);
      });
    });

    it('unknown newStatus → no email sent (variant is null)', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseStatusUpdated(
        baseEvent('franchise.status_updated', {
          franchiseId: 'f-1',
          previousStatus: 'PENDING',
          newStatus: 'UNKNOWN_VARIANT',
        }) as any,
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('includes reason block when admin provided one', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseStatusUpdated(
        baseEvent('franchise.status_updated', {
          franchiseId: 'f-1',
          previousStatus: 'ACTIVE',
          newStatus: 'SUSPENDED',
          reason: 'multiple chargebacks',
        }) as any,
      );
      const call = emailService.send.mock.calls[0][0];
      expect(call.html).toContain('multiple chargebacks');
    });

    it('reason is HTML-escaped (XSS-safe)', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseStatusUpdated(
        baseEvent('franchise.status_updated', {
          franchiseId: 'f-1',
          previousStatus: 'ACTIVE',
          newStatus: 'SUSPENDED',
          reason: '<img src=x onerror=alert(1)>',
        }) as any,
      );
      const call = emailService.send.mock.calls[0][0];
      expect(call.html).not.toContain('<img src=x');
      expect(call.html).toContain('&lt;img');
    });
  });

  describe('franchise.verification_updated', () => {
    it('VERIFIED → emails the owner', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseVerificationUpdated(
        baseEvent('franchise.verification_updated', {
          franchiseId: 'f-1',
          previousVerificationStatus: 'UNDER_REVIEW',
          newVerificationStatus: 'VERIFIED',
        }) as any,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.subject).toMatch(/KYC verified/i);
    });

    it('REJECTED → emails the owner with reason', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseVerificationUpdated(
        baseEvent('franchise.verification_updated', {
          franchiseId: 'f-1',
          previousVerificationStatus: 'UNDER_REVIEW',
          newVerificationStatus: 'REJECTED',
          reason: 'PAN does not match GSTIN',
        }) as any,
      );
      const call = emailService.send.mock.calls[0][0];
      expect(call.subject).toMatch(/needs changes/i);
      expect(call.html).toContain('PAN does not match GSTIN');
    });

    it('REJECTED with no reason → uses fallback copy', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseVerificationUpdated(
        baseEvent('franchise.verification_updated', {
          franchiseId: 'f-1',
          previousVerificationStatus: 'UNDER_REVIEW',
          newVerificationStatus: 'REJECTED',
        }) as any,
      );
      const call = emailService.send.mock.calls[0][0];
      expect(call.html).toMatch(/No reason provided/);
    });

    it('UNDER_REVIEW transition → no email (handled by onboarding_submitted)', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseVerificationUpdated(
        baseEvent('franchise.verification_updated', {
          franchiseId: 'f-1',
          previousVerificationStatus: 'NOT_VERIFIED',
          newVerificationStatus: 'UNDER_REVIEW',
        }) as any,
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('NOT_VERIFIED reset → no email', async () => {
      const { handler, emailService } = buildHandler();
      await handler.onFranchiseVerificationUpdated(
        baseEvent('franchise.verification_updated', {
          franchiseId: 'f-1',
          previousVerificationStatus: 'VERIFIED',
          newVerificationStatus: 'NOT_VERIFIED',
        }) as any,
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });

  describe('franchise.account_locked', () => {
    it('emails the owner with the unlock time', async () => {
      const { handler, emailService } = buildHandler();
      const lockUntil = new Date('2026-05-20T15:30:00Z');
      await handler.onFranchiseAccountLocked(
        baseEvent('franchise.account_locked', {
          franchiseId: 'f-1',
          lockUntil,
        }) as any,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.to).toBe('owner@example.com');
      expect(call.subject).toMatch(/Account Temporarily Locked/i);
    });

    it('silent no-op when franchise lookup fails', async () => {
      const { handler, emailService } = buildHandler({
        prisma: {
          franchisePartner: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        },
      });
      await handler.onFranchiseAccountLocked(
        baseEvent('franchise.account_locked', {
          franchiseId: 'f-1',
          lockUntil: new Date(),
        }) as any,
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });
});
