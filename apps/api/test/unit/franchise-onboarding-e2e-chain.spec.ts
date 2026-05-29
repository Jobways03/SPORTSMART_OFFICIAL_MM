import 'reflect-metadata';
import { createHash } from 'crypto';
import { RegisterFranchiseUseCase } from '../../src/modules/franchise/application/use-cases/register-franchise.use-case';
import { SendFranchiseEmailVerificationUseCase } from '../../src/modules/franchise/application/use-cases/send-franchise-email-verification.use-case';
import { PublicVerifyFranchiseEmailUseCase } from '../../src/modules/franchise/application/use-cases/public-verify-franchise-email.use-case';
import { LoginFranchiseUseCase } from '../../src/modules/franchise/application/use-cases/login-franchise.use-case';
import { SubmitFranchiseOnboardingUseCase } from '../../src/modules/franchise/application/use-cases/submit-franchise-onboarding.use-case';
import { AdminUpdateFranchiseVerificationUseCase } from '../../src/modules/franchise/application/use-cases/admin-update-franchise-verification.use-case';
import { AdminUpdateFranchiseStatusUseCase } from '../../src/modules/franchise/application/use-cases/admin-update-franchise-status.use-case';
import { FranchiseBankDetailsService } from '../../src/modules/franchise/application/services/franchise-bank-details.service';
import { RefreshFranchiseSessionUseCase } from '../../src/modules/franchise/application/use-cases/refresh-franchise-session.use-case';

/**
 * Phase 20 (2026-05-20) — Franchise onboarding chain E2E.
 *
 * Wires the real use cases against an in-memory repo/event/audit/prisma
 * stub set. Steps:
 *
 *   1.  RegisterFranchise            → status=PENDING, isEmailVerified=false
 *                                       (OTP row created, OTP captured by stub)
 *   2.  Login (pre-verify)           → 403 EMAIL_NOT_VERIFIED
 *   3.  PublicVerifyEmail            → isEmailVerified=true, OTP marked used
 *   4.  Login (post-verify, pre-KYC) → 200 with tokens
 *   5.  SubmitFranchiseOnboarding    → verificationStatus=UNDER_REVIEW
 *   6.  AdminUpdateVerification      → VERIFIED
 *   7.  AdminUpdateStatus(PENDING→APPROVED) → preconditions met, stamps approvedAt
 *   8.  AdminUpdateStatus(APPROVED→ACTIVE)  → 400 (no bank details yet)
 *   9.  BankDetailsService.upsert    → row exists
 *   10. AdminUpdateStatus(APPROVED→ACTIVE)  → ACTIVE, stamps activatedAt
 *   11. Refresh                       → 200 happy path
 *   12. Admin flips isEmailVerified=false; Refresh → 403 EMAIL_NOT_VERIFIED + revokes sessions
 *
 * Asserts the right lifecycle events fire at each step.
 */

interface Franchise {
  id: string;
  email: string;
  phoneNumber: string;
  ownerName: string;
  businessName: string;
  passwordHash: string;
  franchiseCode: string;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  gstNumber: string | null;
  panNumber: string | null;
  isDeleted: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
  activatedAt: Date | null;
  activatedBy: string | null;
  kycSubmittedAt: Date | null;
  emailVerifiedAt: Date | null;
  [k: string]: unknown;
}

interface OtpRow {
  id: string;
  franchisePartnerId: string;
  otpHash: string;
  purpose: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt: Date | null;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

interface SessionRow {
  id: string;
  franchisePartnerId: string;
  refreshToken: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

describe('Franchise onboarding chain E2E', () => {
  const buildHarness = () => {
    const franchises: Franchise[] = [];
    const otps: OtpRow[] = [];
    const sessions: SessionRow[] = [];
    const bankDetailsTable: any[] = [];
    const events: Array<{ eventName: string; payload: any }> = [];
    let franchiseSeq = 0;
    let otpSeq = 0;
    let sessionSeq = 0;
    let plaintextOtp: string | null = null;

    const eventBus: any = {
      publish: jest.fn(async (evt: any) => {
        events.push({ eventName: evt.eventName, payload: evt.payload });
      }),
    };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const envService: any = {
      getString: (k: string, d?: string) => {
        if (k === 'JWT_FRANCHISE_SECRET') return 'x'.repeat(32);
        if (k === 'JWT_ACCESS_TTL') return d ?? '7d';
        if (k === 'JWT_REFRESH_TTL') return d ?? '30d';
        return d ?? '';
      },
      getOptional: (k: string) =>
        k === 'FRANCHISE_BANK_ENCRYPTION_KEY' ? 'a'.repeat(64) : undefined,
    };
    const audit: any = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    };
    const emailOtpAdapter: any = {
      sendOtp: jest.fn(async (_email: string, otp: string) => {
        plaintextOtp = otp;
        return true;
      }),
    };

    const franchiseRepo: any = {
      findByEmail: jest.fn(async (email: string) =>
        franchises.find((f) => f.email === email && !f.isDeleted) ?? null,
      ),
      findByPhone: jest.fn(async (phone: string) =>
        franchises.find((f) => f.phoneNumber === phone && !f.isDeleted) ?? null,
      ),
      findByGstNumber: jest.fn(async (gst: string) =>
        franchises.find((f) => f.gstNumber === gst && !f.isDeleted) ?? null,
      ),
      findByPanNumber: jest.fn(async (pan: string) =>
        franchises.find((f) => f.panNumber === pan && !f.isDeleted) ?? null,
      ),
      findById: jest.fn(async (id: string) =>
        franchises.find((f) => f.id === id) ?? null,
      ),
      findByIdSelect: jest.fn(async (id: string, _select: any) =>
        franchises.find((f) => f.id === id) ?? null,
      ),
      // Phase 27 hourly resend-cap probe; harness has no rate pressure.
      countOtpsSince: jest.fn().mockResolvedValue(0),
      generateNextFranchiseCode: jest.fn(async () => {
        franchiseSeq += 1;
        return `FRN-${String(franchiseSeq).padStart(5, '0')}`;
      }),
      createFranchise: jest.fn(async (data: any) => {
        const f: Franchise = {
          id: `f-${++franchiseSeq}`,
          email: data.email,
          phoneNumber: data.phoneNumber,
          ownerName: data.ownerName,
          businessName: data.businessName,
          passwordHash: data.passwordHash,
          franchiseCode: data.franchiseCode,
          status: 'PENDING',
          verificationStatus: 'NOT_VERIFIED',
          isEmailVerified: false,
          failedLoginAttempts: 0,
          lockUntil: null,
          gstNumber: null,
          panNumber: null,
          isDeleted: false,
          approvedAt: null,
          approvedBy: null,
          activatedAt: null,
          activatedBy: null,
          kycSubmittedAt: null,
          emailVerifiedAt: null,
        };
        franchises.push(f);
        return f;
      }),
      updateFranchise: jest.fn(async (id: string, patch: any) => {
        const f = franchises.find((x) => x.id === id);
        if (!f) throw new Error('not found');
        Object.assign(f, patch);
        return f;
      }),
      updateFranchiseSelect: jest.fn(async (id: string, patch: any, _select: any) => {
        const f = franchises.find((x) => x.id === id);
        if (!f) throw new Error('not found');
        Object.assign(f, patch);
        return f;
      }),
      createSession: jest.fn(async (data: any) => {
        const s: SessionRow = {
          id: `sess-${++sessionSeq}`,
          franchisePartnerId: data.franchisePartnerId,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          revokedAt: null,
        };
        sessions.push(s);
        return s;
      }),
      findSessionByRefreshToken: jest.fn(async (rawToken: string) =>
        sessions.find((s) => s.refreshToken === rawToken && !s.revokedAt) ?? null,
      ),
      findSessionByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
      revokeAllSessions: jest.fn(async (franchisePartnerId: string) => {
        for (const s of sessions) {
          if (s.franchisePartnerId === franchisePartnerId) {
            s.revokedAt = new Date();
          }
        }
      }),
      rotateSession: jest.fn(async (sessionId: string, newToken: string, newExp: Date) => {
        const s = sessions.find((x) => x.id === sessionId);
        if (!s) throw new Error('session not found');
        s.refreshToken = newToken;
        s.expiresAt = newExp;
      }),
      findRecentOtp: jest.fn(async (params: any) => {
        const candidates = otps.filter(
          (o) =>
            o.franchisePartnerId === params.franchisePartnerId &&
            o.purpose === params.purpose &&
            !o.usedAt &&
            (!params.createdAfter || o.createdAt > params.createdAfter),
        );
        return candidates.sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
      }),
      findLatestValidOtp: jest.fn(async (franchisePartnerId: string, purpose: string) => {
        const candidates = otps.filter(
          (o) =>
            o.franchisePartnerId === franchisePartnerId &&
            o.purpose === purpose &&
            !o.usedAt &&
            o.expiresAt > new Date(),
        );
        return candidates.sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
      }),
      invalidateActiveOtps: jest.fn(async (franchisePartnerId: string, purpose?: string) => {
        for (const o of otps) {
          if (
            o.franchisePartnerId === franchisePartnerId &&
            (!purpose || o.purpose === purpose) &&
            !o.usedAt
          ) {
            o.usedAt = new Date();
          }
        }
      }),
      createOtp: jest.fn(async (data: any) => {
        const o: OtpRow = {
          id: `otp-${++otpSeq}`,
          franchisePartnerId: data.franchisePartnerId,
          otpHash: data.otpHash,
          purpose: data.purpose,
          attempts: 0,
          maxAttempts: 5,
          verifiedAt: null,
          usedAt: null,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
        };
        otps.push(o);
        return o;
      }),
      incrementOtpAttemptsCas: jest.fn(async (otpId: string, maxAttempts: number) => {
        const o = otps.find((x) => x.id === otpId);
        if (!o || o.usedAt || o.attempts >= maxAttempts) return { ok: false };
        o.attempts += 1;
        return { ok: true as const, attempts: o.attempts };
      }),
      expireOtp: jest.fn(async (id: string) => {
        const o = otps.find((x) => x.id === id);
        if (o) o.expiresAt = new Date(0);
      }),
      verifyEmailTransaction: jest.fn(
        async (params: { franchisePartnerId: string; otpId: string }) => {
          const f = franchises.find((x) => x.id === params.franchisePartnerId);
          const o = otps.find((x) => x.id === params.otpId);
          if (f) {
            f.isEmailVerified = true;
            f.emailVerifiedAt = new Date();
          }
          if (o) {
            o.verifiedAt = new Date();
            o.usedAt = new Date();
          }
        },
      ),
    };

    const prismaStub: any = {
      // Phase 159i/159j — the status + verification use-cases read/write via
      // prisma directly (CAS + history rows in a tx). Back franchisePartner
      // with the same `franchises` array the repo mock uses so the chain stays
      // consistent across both code paths.
      franchisePartner: {
        findUnique: jest.fn(async (args: any) =>
          franchises.find((f) => f.id === args.where.id) ?? null,
        ),
        updateMany: jest.fn(async (args: any) => {
          const f = franchises.find((x) => x.id === args.where.id);
          if (!f) return { count: 0 };
          // Honor whichever CAS guard column the use-case passed.
          if (args.where.status !== undefined && f.status !== args.where.status) {
            return { count: 0 };
          }
          if (
            args.where.verificationStatus !== undefined &&
            f.verificationStatus !== args.where.verificationStatus
          ) {
            return { count: 0 };
          }
          Object.assign(f, args.data);
          return { count: 1 };
        }),
      },
      franchiseStatusHistory: { create: jest.fn(async () => ({})) },
      franchiseVerificationEvent: { create: jest.fn(async () => ({})) },
      franchiseBankDetails: {
        findUnique: jest.fn(async (args: any) =>
          bankDetailsTable.find(
            (b) => b.franchisePartnerId === args.where.franchisePartnerId,
          ) ?? null,
        ),
        upsert: jest.fn(async (args: any) => {
          const existing = bankDetailsTable.find(
            (b) => b.franchisePartnerId === args.where.franchisePartnerId,
          );
          if (existing) {
            Object.assign(existing, args.update);
            existing.updatedAt = new Date();
            return existing;
          }
          const row = { ...args.create, updatedAt: new Date() };
          bankDetailsTable.push(row);
          return row;
        }),
      },
      subOrder: { count: jest.fn().mockResolvedValue(0) },
    };
    prismaStub.$transaction = jest.fn(async (cb: any) => cb(prismaStub));

    const sendOtp = new SendFranchiseEmailVerificationUseCase(
      franchiseRepo,
      emailOtpAdapter,
      eventBus,
      logger,
      audit,
    );
    const register = new RegisterFranchiseUseCase(
      franchiseRepo,
      eventBus,
      sendOtp,
      logger,
    );
    const publicVerify = new PublicVerifyFranchiseEmailUseCase(
      franchiseRepo,
      eventBus,
      logger,
    );
    const login = new LoginFranchiseUseCase(
      franchiseRepo,
      envService,
      eventBus,
      logger,
    );
    const submitOnboarding = new SubmitFranchiseOnboardingUseCase(
      franchiseRepo,
      eventBus,
      audit,
      logger,
    );
    const updateVerification = new AdminUpdateFranchiseVerificationUseCase(
      franchiseRepo,
      eventBus,
      audit,
      logger,
      prismaStub,
    );
    const updateStatus = new AdminUpdateFranchiseStatusUseCase(
      franchiseRepo,
      eventBus,
      audit,
      logger,
      prismaStub,
    );
    const bankDetailsSvc = new FranchiseBankDetailsService(envService, prismaStub);
    const refresh = new RefreshFranchiseSessionUseCase(
      franchiseRepo,
      envService,
      logger,
    );

    const eventNames = () => events.map((e) => e.eventName);
    const getOtpForLatest = () => plaintextOtp!;
    const clearOtp = () => {
      plaintextOtp = null;
    };

    return {
      franchises,
      otps,
      sessions,
      events,
      eventNames,
      getOtpForLatest,
      clearOtp,
      register,
      publicVerify,
      login,
      submitOnboarding,
      updateVerification,
      updateStatus,
      bankDetailsSvc,
      refresh,
      franchiseRepo,
    };
  };

  it('runs the full chain: register → verify → login → KYC → verify-approve → status-approve → bank → activate → refresh + revoke on unverify', async () => {
    const h = buildHarness();

    // ── Step 1: Register ─────────────────────────────────────
    const regOut = await h.register.execute({
      ownerName: 'Owner',
      businessName: 'Owner Sports Co',
      email: 'owner@example.com',
      phoneNumber: '9876543210',
      password: 'Strong#Passw0rd',
      confirmPassword: 'Strong#Passw0rd',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptMarketing: false,
    });
    expect(regOut.requiresVerification).toBe(true);
    expect(regOut.verificationEmailSent).toBe(true);
    expect(h.franchises).toHaveLength(1);
    expect(h.franchises[0]!.status).toBe('PENDING');
    expect(h.franchises[0]!.isEmailVerified).toBe(false);
    expect(h.eventNames()).toContain('franchise.registered');
    expect(h.eventNames()).toContain('franchise.email_verification_otp_sent');
    const otpAfterRegister = h.getOtpForLatest();
    expect(otpAfterRegister).toMatch(/^\d{6}$/);

    // ── Step 2: Login before verify → 403 EMAIL_NOT_VERIFIED ─
    try {
      await h.login.execute({
        identifier: 'owner@example.com',
        password: 'Strong#Passw0rd',
      });
      fail('Expected EMAIL_NOT_VERIFIED');
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }

    // ── Step 3: Public verify email ──────────────────────────
    const verifyOut = await h.publicVerify.execute({
      email: 'owner@example.com',
      otp: otpAfterRegister,
    });
    expect(verifyOut.verified).toBe(true);
    expect(h.franchises[0]!.isEmailVerified).toBe(true);
    expect(h.franchises[0]!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(h.eventNames()).toContain('franchise.email_verified');

    // ── Step 4: Login after verify ───────────────────────────
    const loginOut = await h.login.execute({
      identifier: 'owner@example.com',
      password: 'Strong#Passw0rd',
    });
    expect(loginOut.accessToken).toBeTruthy();
    expect(loginOut.refreshToken).toBeTruthy();
    expect(loginOut.franchise.isEmailVerified).toBe(true);
    const refreshToken = loginOut.refreshToken;

    // ── Step 5: Submit KYC ──────────────────────────────────
    const validGstin = '27ABCDE1234F1Z5';
    const validPan = 'ABCDE1234F';
    await h.submitOnboarding.execute({
      franchiseId: h.franchises[0]!.id,
      legalBusinessName: 'Acme Sports Pvt Ltd',
      gstRegistrationType: 'REGULAR',
      gstNumber: validGstin,
      gstStateCode: '27',
      panNumber: validPan,
      businessAddress: {
        line1: '1 Main',
        city: 'Pune',
        state: 'MH',
        pincode: '411001',
        country: 'India',
      },
      confirmedAccurate: true,
    });
    expect(h.franchises[0]!.verificationStatus).toBe('UNDER_REVIEW');
    expect(h.franchises[0]!.kycSubmittedAt).toBeInstanceOf(Date);
    expect(h.franchises[0]!.gstNumber).toBe(validGstin);
    expect(h.franchises[0]!.panNumber).toBe(validPan);
    expect(h.eventNames()).toContain('franchise.onboarding_submitted');

    // ── Step 6: Admin marks verification VERIFIED ───────────
    await h.updateVerification.execute({
      adminId: 'admin-1',
      franchiseId: h.franchises[0]!.id,
      verificationStatus: 'VERIFIED',
      reason: 'docs are clean',
    });
    expect(h.franchises[0]!.verificationStatus).toBe('VERIFIED');
    expect(h.eventNames()).toContain('franchise.verification_updated');

    // ── Step 7: Admin PENDING → APPROVED ────────────────────
    await h.updateStatus.execute({
      adminId: 'admin-1',
      franchiseId: h.franchises[0]!.id,
      status: 'APPROVED',
    });
    expect(h.franchises[0]!.status).toBe('APPROVED');
    expect(h.franchises[0]!.approvedAt).toBeInstanceOf(Date);
    expect(h.franchises[0]!.approvedBy).toBe('admin-1');

    // ── Step 8: Admin APPROVED → ACTIVE without bank → 400 ──
    await expect(
      h.updateStatus.execute({
        adminId: 'admin-1',
        franchiseId: h.franchises[0]!.id,
        status: 'ACTIVE',
      }),
    ).rejects.toThrow(/bank details on file/i);
    expect(h.franchises[0]!.status).toBe('APPROVED');

    // ── Step 9: Upsert bank details ─────────────────────────
    await h.bankDetailsSvc.upsert({
      franchisePartnerId: h.franchises[0]!.id,
      accountHolderName: 'Owner Sports Co',
      accountNumber: '1234567890',
      ifscCode: 'HDFC0001234',
    });

    // ── Step 10: Admin APPROVED → ACTIVE with bank → success
    await h.updateStatus.execute({
      adminId: 'admin-1',
      franchiseId: h.franchises[0]!.id,
      status: 'ACTIVE',
    });
    expect(h.franchises[0]!.status).toBe('ACTIVE');
    expect(h.franchises[0]!.activatedAt).toBeInstanceOf(Date);

    // ── Step 11: Refresh (happy path) ───────────────────────
    const refreshOut = await h.refresh.execute({ refreshToken });
    expect(refreshOut.accessToken).toBeTruthy();
    expect(refreshOut.refreshToken).not.toBe(refreshToken);
    const newRefreshToken = refreshOut.refreshToken;

    // ── Step 12: Admin flips back to unverified; refresh fails
    h.franchises[0]!.isEmailVerified = false;
    try {
      await h.refresh.execute({ refreshToken: newRefreshToken });
      fail('Expected EMAIL_NOT_VERIFIED');
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }
    // All sessions revoked.
    expect(h.sessions.every((s) => s.revokedAt !== null)).toBe(true);

    // ── Lifecycle event order assertion ─────────────────────
    const lifecycle = h.eventNames().filter((n) => n.startsWith('franchise.'));
    expect(lifecycle).toEqual(
      expect.arrayContaining([
        'franchise.registered',
        'franchise.email_verification_otp_sent',
        'franchise.email_verified',
        'franchise.logged_in',
        'franchise.onboarding_submitted',
        'franchise.verification_updated',
        'franchise.status_updated', // fires twice (APPROVED + ACTIVE)
      ]),
    );
  });

  it('rejects KYC submit when email is not yet verified', async () => {
    const h = buildHarness();
    await h.register.execute({
      ownerName: 'Owner',
      businessName: 'OSC',
      email: 'unverified@example.com',
      phoneNumber: '9876543211',
      password: 'Strong#Passw0rd',
      confirmPassword: 'Strong#Passw0rd',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await expect(
      h.submitOnboarding.execute({
        franchiseId: h.franchises[0]!.id,
        legalBusinessName: 'Acme',
        gstRegistrationType: 'REGULAR',
        gstNumber: '27ABCDE1234F1Z5',
        gstStateCode: '27',
        panNumber: 'ABCDE1234F',
        businessAddress: {
          line1: '1 Main',
          city: 'Pune',
          state: 'MH',
          pincode: '411001',
        },
        confirmedAccurate: true,
      }),
    ).rejects.toThrow(/Verify your email/i);
  });

  it('rejects APPROVED before verification is VERIFIED', async () => {
    const h = buildHarness();
    await h.register.execute({
      ownerName: 'Owner',
      businessName: 'OSC',
      email: 'a@b.com',
      phoneNumber: '9876543212',
      password: 'Strong#Passw0rd',
      confirmPassword: 'Strong#Passw0rd',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await h.publicVerify.execute({
      email: 'a@b.com',
      otp: h.getOtpForLatest(),
    });
    await expect(
      h.updateStatus.execute({
        adminId: 'admin-1',
        franchiseId: h.franchises[0]!.id,
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/Verification must be VERIFIED/i);
  });
});
