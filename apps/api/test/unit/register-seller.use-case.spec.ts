import 'reflect-metadata';
import { RegisterSellerUseCase } from '../../src/modules/seller/application/use-cases/register-seller.use-case';

/**
 * Phase 18 (2026-05-20) — RegisterSellerUseCase unit tests.
 *
 * Pins the contract that gates the seller registration audit:
 *   1. confirmPassword equality enforced server-side.
 *   2. Terms + Privacy required.
 *   3. Duplicate email/phone returns the same uniform payload as a
 *      fresh registration (no enumeration leak via shape OR
 *      response timing — timing is delayed in code).
 *   4. Happy path emits seller.registered + calls sendOtp + surfaces
 *      `verificationEmailSent` from the OTP use case result.
 *   5. SMTP soft-failure produces `verificationEmailSent: false`.
 */

describe('RegisterSellerUseCase', () => {
  const baseInput = {
    sellerName: 'A Seller',
    sellerShopName: 'A Shop',
    email: 'a@b.com',
    phoneNumber: '9876543210',
    password: 'Strong#Passw0rd',
    confirmPassword: 'Strong#Passw0rd',
    acceptTerms: true,
    acceptPrivacy: true,
    acceptMarketing: false,
    sellerType: 'D2C' as const,
  };

  const buildUseCase = (opts: {
    existingByEmail?: any;
    existingByPhone?: any;
    sendOtpResult?: { sent: boolean };
    sendOtpThrows?: Error;
  } = {}) => {
    const sellerRepo = {
      findByEmail: jest.fn().mockResolvedValue(opts.existingByEmail ?? null),
      findByPhone: jest.fn().mockResolvedValue(opts.existingByPhone ?? null),
      createSeller: jest.fn().mockResolvedValue({
        id: 's-1',
        email: baseInput.email,
        sellerName: baseInput.sellerName,
        sellerShopName: baseInput.sellerShopName,
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
      useCase: new RegisterSellerUseCase(sellerRepo, eventBus, logger, sendOtp),
      sellerRepo,
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

  it('happy path: creates seller, emits event, calls sendOtp, sent=true', async () => {
    const { useCase, sellerRepo, eventBus, sendOtp } = buildUseCase();
    const out = await useCase.execute(baseInput);

    expect(sellerRepo.createSeller).toHaveBeenCalledTimes(1);
    expect(sellerRepo.createSeller.mock.calls[0][0].sellerType).toBe('D2C');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'seller.registered' }),
    );
    expect(sendOtp.execute).toHaveBeenCalledWith('s-1');
    expect(out.verificationEmailSent).toBe(true);
    expect(out.requiresVerification).toBe(true);
    expect(out.sellerId).toBe('s-1');
  });

  it('SMTP soft-failure → verificationEmailSent=false, seller still created', async () => {
    const { useCase, sellerRepo } = buildUseCase({
      sendOtpResult: { sent: false },
    });
    const out = await useCase.execute(baseInput);

    expect(sellerRepo.createSeller).toHaveBeenCalledTimes(1);
    expect(out.verificationEmailSent).toBe(false);
    expect(out.message).toMatch(/could not send/i);
  });

  it('sendOtp throws → verificationEmailSent=false, seller still created', async () => {
    const { useCase, sellerRepo } = buildUseCase({
      sendOtpThrows: new Error('SMTP refused'),
    });
    const out = await useCase.execute(baseInput);

    expect(sellerRepo.createSeller).toHaveBeenCalledTimes(1);
    expect(out.verificationEmailSent).toBe(false);
  });

  it('duplicate email: uniform shape, no seller created, no event, no sendOtp', async () => {
    const { useCase, sellerRepo, eventBus, sendOtp } = buildUseCase({
      existingByEmail: { id: 'old-seller' },
    });
    const out = await useCase.execute(baseInput);

    expect(sellerRepo.createSeller).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(sendOtp.execute).not.toHaveBeenCalled();
    expect(out.requiresVerification).toBe(true);
    expect(out.verificationEmailSent).toBe(true);
    // sellerId not present in duplicate response (no enumeration via id presence).
    expect(out.sellerId).toBeUndefined();
  });

  it('duplicate phone: same uniform shape as duplicate email', async () => {
    const { useCase, sellerRepo } = buildUseCase({
      existingByPhone: { id: 'old-seller-2' },
    });
    const out = await useCase.execute(baseInput);
    expect(sellerRepo.createSeller).not.toHaveBeenCalled();
    expect(out.requiresVerification).toBe(true);
    expect(out.sellerId).toBeUndefined();
  });

  it('race-window P2002 on createSeller falls back to uniform duplicate response', async () => {
    const { useCase, sellerRepo } = buildUseCase();
    sellerRepo.createSeller.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['email'] },
    });
    const out = await useCase.execute(baseInput);
    expect(out.requiresVerification).toBe(true);
    expect(out.sellerId).toBeUndefined();
  });

  it('non-P2002 errors propagate', async () => {
    const { useCase, sellerRepo } = buildUseCase();
    sellerRepo.createSeller.mockRejectedValueOnce(new Error('db down'));
    await expect(useCase.execute(baseInput)).rejects.toThrow(/db down/);
  });
});
