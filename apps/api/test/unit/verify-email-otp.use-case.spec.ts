import 'reflect-metadata';
import { createHash } from 'crypto';
import { VerifyEmailOtpUseCase } from '../../src/modules/identity/application/use-cases/verify-email-otp.use-case';

/**
 * Phase 16 (2026-05-20) — VerifyEmailOtpUseCase unit tests.
 *
 * Asserts:
 *   1. No user → uniform 401, no enumeration leak.
 *   2. ALREADY_VERIFIED returns a distinct 400 code so the frontend
 *      can navigate the user to login without looping.
 *   3. SUSPENDED / BANNED → uniform 401 (verify cannot un-suspend).
 *   4. Wrong OTP increments attempts; remaining count is surfaced.
 *   5. CAS failure (race / cap hit) expires the OTP defensively.
 *   6. Valid OTP marks the user verified and publishes the event.
 */

describe('VerifyEmailOtpUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    const userRepo = {
      findByEmailForVerification: jest.fn(),
      findActiveEmailVerificationOtp: jest.fn(),
      incrementEmailVerificationOtpAttemptsCas: jest.fn(),
      expireEmailVerificationOtp: jest.fn(),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
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
    const useCase = new VerifyEmailOtpUseCase(userRepo, eventBus, logger);
    return { useCase, userRepo, eventBus };
  };

  const otpRow = (otpPlaintext: string) => ({
    id: 'otp-1',
    userId: 'u-1',
    otpHash: createHash('sha256').update(otpPlaintext).digest('hex'),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
    verifiedAt: null,
    createdAt: new Date(),
  });

  it('unknown email → uniform 401', async () => {
    const { useCase } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue(null),
    });
    await expect(
      useCase.execute({ email: 'ghost@example.com', otp: '123456' }),
    ).rejects.toThrow(/Invalid or expired/i);
  });

  it('already-active + verified account → ALREADY_VERIFIED', async () => {
    const { useCase } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'ACTIVE',
        emailVerified: true,
      }),
    });
    await expect(
      useCase.execute({ email: 'a@b.com', otp: '123456' }),
    ).rejects.toThrow(/already verified/i);
  });

  it('SUSPENDED account → uniform 401 (verify cannot un-suspend)', async () => {
    const { useCase } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'SUSPENDED',
        emailVerified: false,
      }),
    });
    await expect(
      useCase.execute({ email: 'a@b.com', otp: '123456' }),
    ).rejects.toThrow(/Invalid or expired/i);
  });

  it('wrong OTP → increments attempts, surfaces remaining count', async () => {
    const otp = '654321';
    const { useCase, userRepo } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      }),
      findActiveEmailVerificationOtp: jest.fn().mockResolvedValue(otpRow(otp)),
      incrementEmailVerificationOtpAttemptsCas: jest
        .fn()
        .mockResolvedValue({ ok: true, attempts: 1 }),
    });

    await expect(
      useCase.execute({ email: 'a@b.com', otp: '111111' }),
    ).rejects.toThrow(/4 attempt\(s\) remaining/);

    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it('CAS failure (race / cap hit) expires the OTP defensively', async () => {
    const { useCase, userRepo } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      }),
      findActiveEmailVerificationOtp: jest.fn().mockResolvedValue(otpRow('123456')),
      incrementEmailVerificationOtpAttemptsCas: jest
        .fn()
        .mockResolvedValue({ ok: false }),
      expireEmailVerificationOtp: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      useCase.execute({ email: 'a@b.com', otp: '123456' }),
    ).rejects.toThrow(/Too many failed attempts/i);

    expect(userRepo.expireEmailVerificationOtp).toHaveBeenCalledWith('otp-1');
  });

  it('valid OTP → markEmailVerified called, event fires', async () => {
    const otp = '424242';
    const { useCase, userRepo, eventBus } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      }),
      findActiveEmailVerificationOtp: jest.fn().mockResolvedValue(otpRow(otp)),
      incrementEmailVerificationOtpAttemptsCas: jest
        .fn()
        .mockResolvedValue({ ok: true, attempts: 1 }),
    });

    const result = await useCase.execute({ email: 'a@b.com', otp });
    expect(result).toEqual({ email: 'a@b.com', verified: true });
    expect(userRepo.markEmailVerified).toHaveBeenCalledWith('otp-1', 'u-1');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'identity.user.email_verified' }),
    );
  });
});
