import 'reflect-metadata';
import { createHash } from 'crypto';
import { PublicVerifySellerEmailUseCase } from '../../src/modules/seller/application/use-cases/public-verify-seller-email.use-case';

/**
 * Phase 18 (2026-05-20) — PublicVerifySellerEmailUseCase unit tests.
 *
 * Verifies the public seller verify-email path:
 *   1. Unknown email → uniform 401 (no enumeration).
 *   2. Already-verified seller → ALREADY_VERIFIED 400.
 *   3. No active OTP → 401.
 *   4. Atomic CAS failure (race / cap) → expire + 401.
 *   5. Wrong OTP → 401 with remaining attempts.
 *   6. Valid OTP → repo.verifyEmailTransaction called + event emitted.
 */

describe('PublicVerifySellerEmailUseCase', () => {
  const otpRow = (plaintext: string, overrides: Partial<any> = {}) => ({
    id: 'otp-1',
    sellerId: 's-1',
    otpHash: createHash('sha256').update(plaintext).digest('hex'),
    purpose: 'EMAIL_VERIFICATION',
    attempts: 0,
    maxAttempts: 5,
    verifiedAt: null,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  });

  const buildUseCase = (overrides: Partial<any> = {}) => {
    const sellerRepo = {
      findByEmail: jest.fn(),
      findLatestValidOtp: jest.fn(),
      incrementOtpAttemptsCas: jest.fn(),
      expireOtp: jest.fn().mockResolvedValue(undefined),
      verifyEmailTransaction: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    return {
      useCase: new PublicVerifySellerEmailUseCase(sellerRepo, eventBus, logger),
      sellerRepo,
      eventBus,
    };
  };

  it('unknown email → uniform 401', async () => {
    const { useCase } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue(null),
    });
    await expect(
      useCase.execute({ email: 'ghost@example.com', otp: '123456' }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it('already-verified seller → ALREADY_VERIFIED 400', async () => {
    const { useCase } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        email: 'a@b.com',
        isEmailVerified: true,
      }),
    });
    try {
      await useCase.execute({ email: 'a@b.com', otp: '123456' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('ALREADY_VERIFIED');
    }
  });

  it('no active OTP → 401', async () => {
    const { useCase } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        email: 'a@b.com',
        isEmailVerified: false,
      }),
      findLatestValidOtp: jest.fn().mockResolvedValue(null),
    });
    await expect(
      useCase.execute({ email: 'a@b.com', otp: '123456' }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it('CAS failure (race) → expires defensively, 401', async () => {
    const { useCase, sellerRepo } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        email: 'a@b.com',
        isEmailVerified: false,
      }),
      findLatestValidOtp: jest.fn().mockResolvedValue(otpRow('123456')),
      incrementOtpAttemptsCas: jest.fn().mockResolvedValue({ ok: false }),
    });
    await expect(
      useCase.execute({ email: 'a@b.com', otp: '123456' }),
    ).rejects.toThrow(/Too many failed attempts/);
    expect(sellerRepo.expireOtp).toHaveBeenCalledWith('otp-1');
  });

  it('wrong OTP → surfaces remaining attempts, does not call verifyEmailTransaction', async () => {
    const { useCase, sellerRepo } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        email: 'a@b.com',
        isEmailVerified: false,
      }),
      findLatestValidOtp: jest.fn().mockResolvedValue(otpRow('111111')),
      incrementOtpAttemptsCas: jest
        .fn()
        .mockResolvedValue({ ok: true, attempts: 1 }),
    });
    await expect(
      useCase.execute({ email: 'a@b.com', otp: '222222' }),
    ).rejects.toThrow(/4 attempt\(s\) remaining/);
    expect(sellerRepo.verifyEmailTransaction).not.toHaveBeenCalled();
  });

  it('valid OTP → verifyEmailTransaction + event fires', async () => {
    const otp = '424242';
    const { useCase, sellerRepo, eventBus } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        email: 'a@b.com',
        isEmailVerified: false,
      }),
      findLatestValidOtp: jest.fn().mockResolvedValue(otpRow(otp)),
      incrementOtpAttemptsCas: jest
        .fn()
        .mockResolvedValue({ ok: true, attempts: 1 }),
    });
    const out = await useCase.execute({ email: 'a@b.com', otp });
    expect(out.verified).toBe(true);
    expect(sellerRepo.verifyEmailTransaction).toHaveBeenCalledWith({
      sellerId: 's-1',
      otpId: 'otp-1',
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'seller.email_verified' }),
    );
  });
});
