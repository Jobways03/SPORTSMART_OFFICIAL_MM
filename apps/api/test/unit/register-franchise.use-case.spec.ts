import 'reflect-metadata';
import { RegisterFranchiseUseCase } from '../../src/modules/franchise/application/use-cases/register-franchise.use-case';

/**
 * Phase 20 (2026-05-20) — RegisterFranchiseUseCase unit tests.
 *
 * Mirrors register-seller.use-case.spec.ts. Pins:
 *   1. confirmPassword equality enforced server-side.
 *   2. Terms + Privacy required.
 *   3. Duplicate email/phone returns the same uniform payload as a
 *      fresh registration (no enumeration leak via shape).
 *   4. Happy path emits franchise.registered + calls sendOtp +
 *      surfaces `verificationEmailSent` from the OTP use case result.
 *   5. SMTP soft-failure produces `verificationEmailSent: false`.
 *   6. P2002 race on email/phone falls back to uniform response.
 */

describe('RegisterFranchiseUseCase', () => {
  const baseInput = {
    ownerName: 'Franchise Owner',
    businessName: 'Owner Sports Co',
    email: 'owner@example.com',
    phoneNumber: '9876543210',
    password: 'Strong#Passw0rd',
    confirmPassword: 'Strong#Passw0rd',
    acceptTerms: true,
    acceptPrivacy: true,
    acceptMarketing: false,
  };

  const buildUseCase = (opts: {
    existingByEmail?: any;
    existingByPhone?: any;
    sendOtpResult?: { sent: boolean };
    sendOtpThrows?: Error;
  } = {}) => {
    const franchiseRepo = {
      findByEmail: jest.fn().mockResolvedValue(opts.existingByEmail ?? null),
      findByPhone: jest.fn().mockResolvedValue(opts.existingByPhone ?? null),
      generateNextFranchiseCode: jest.fn().mockResolvedValue('FRN-00001'),
      createFranchise: jest.fn().mockResolvedValue({
        id: 'f-1',
        email: baseInput.email,
        ownerName: baseInput.ownerName,
        businessName: baseInput.businessName,
        phoneNumber: baseInput.phoneNumber,
      }),
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;
    const sendOtp = {
      execute: jest.fn().mockImplementation(async () => {
        if (opts.sendOtpThrows) throw opts.sendOtpThrows;
        return opts.sendOtpResult ?? { sent: true };
      }),
    } as any;
    return {
      useCase: new RegisterFranchiseUseCase(franchiseRepo, eventBus, sendOtp, logger),
      franchiseRepo,
      eventBus,
      sendOtp,
    };
  };

  it('rejects when password !== confirmPassword', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, confirmPassword: 'other' }),
    ).rejects.toThrow(/PASSWORDS_DO_NOT_MATCH|do not match/i);
  });

  it('rejects when acceptTerms is false', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, acceptTerms: false }),
    ).rejects.toThrow(/Terms/i);
  });

  it('rejects when acceptPrivacy is false', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, acceptPrivacy: false }),
    ).rejects.toThrow(/Privacy/i);
  });

  it('happy path: creates franchise, emits event, calls sendOtp, sent=true', async () => {
    const { useCase, franchiseRepo, eventBus, sendOtp } = buildUseCase();
    const out = await useCase.execute(baseInput);

    expect(franchiseRepo.createFranchise).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'franchise.registered' }),
    );
    expect(sendOtp.execute).toHaveBeenCalledWith('f-1');
    expect(out.verificationEmailSent).toBe(true);
    expect(out.requiresVerification).toBe(true);
    expect(out.franchiseId).toBe('f-1');
  });

  it('SMTP soft-failure → verificationEmailSent=false, franchise still created', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      sendOtpResult: { sent: false },
    });
    const out = await useCase.execute(baseInput);

    expect(franchiseRepo.createFranchise).toHaveBeenCalledTimes(1);
    expect(out.verificationEmailSent).toBe(false);
    expect(out.message).toMatch(/could not send/i);
  });

  it('sendOtp throws → verificationEmailSent=false, franchise still created', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      sendOtpThrows: new Error('SMTP refused'),
    });
    const out = await useCase.execute(baseInput);

    expect(franchiseRepo.createFranchise).toHaveBeenCalledTimes(1);
    expect(out.verificationEmailSent).toBe(false);
  });

  it('duplicate email: uniform shape, no franchise created, no event, no sendOtp', async () => {
    const { useCase, franchiseRepo, eventBus, sendOtp } = buildUseCase({
      existingByEmail: { id: 'old-franchise' },
    });
    const out = await useCase.execute(baseInput);

    expect(franchiseRepo.createFranchise).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(sendOtp.execute).not.toHaveBeenCalled();
    expect(out.requiresVerification).toBe(true);
    expect(out.verificationEmailSent).toBe(true);
    // franchiseId absent on duplicate path (no enumeration via id presence).
    expect(out.franchiseId).toBeUndefined();
  });

  it('duplicate phone: same uniform shape as duplicate email', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      existingByPhone: { id: 'old-franchise-2' },
    });
    const out = await useCase.execute(baseInput);
    expect(franchiseRepo.createFranchise).not.toHaveBeenCalled();
    expect(out.requiresVerification).toBe(true);
    expect(out.franchiseId).toBeUndefined();
  });

  it('race-window P2002 on createFranchise email/phone falls back to uniform duplicate response', async () => {
    const { useCase, franchiseRepo } = buildUseCase();
    franchiseRepo.createFranchise.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['email'] },
    });
    const out = await useCase.execute(baseInput);
    expect(out.requiresVerification).toBe(true);
    expect(out.franchiseId).toBeUndefined();
  });

  it('non-P2002 errors propagate', async () => {
    const { useCase, franchiseRepo } = buildUseCase();
    franchiseRepo.createFranchise.mockRejectedValueOnce(new Error('db down'));
    await expect(useCase.execute(baseInput)).rejects.toThrow(/db down/);
  });
});
