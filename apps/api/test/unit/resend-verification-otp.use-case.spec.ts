import 'reflect-metadata';
import { ResendVerificationOtpUseCase } from '../../src/modules/identity/application/use-cases/resend-verification-otp.use-case';

/**
 * Phase 16 (2026-05-20) — ResendVerificationOtpUseCase unit tests.
 *
 * Asserts:
 *   1. Unknown email → uniform success message, no OTP issued.
 *   2. Already-verified (status=ACTIVE) → uniform success, no OTP.
 *   3. Cooldown active (recent OTP within 60s) → no new OTP issued.
 *   4. Happy path: old OTPs invalidated, new OTP created, event fires.
 */

describe('ResendVerificationOtpUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    const userRepo = {
      findByEmailForVerification: jest.fn(),
      findRecentEmailVerificationOtp: jest.fn().mockResolvedValue(null),
      invalidateActiveEmailVerificationOtps: jest.fn().mockResolvedValue(undefined),
      createEmailVerificationOtp: jest.fn().mockResolvedValue({ id: 'otp-1' }),
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
    const useCase = new ResendVerificationOtpUseCase(userRepo, eventBus, logger);
    return { useCase, userRepo, eventBus };
  };

  it('unknown email → uniform success, no OTP, no event', async () => {
    const { useCase, userRepo, eventBus } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue(null),
    });
    const out = await useCase.execute({ email: 'ghost@example.com' });
    expect(out.message).toMatch(/awaiting verification/i);
    expect(userRepo.createEmailVerificationOtp).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('already-verified account → uniform success, no OTP, no event', async () => {
    const { useCase, userRepo, eventBus } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'ACTIVE',
        emailVerified: true,
      }),
    });
    await useCase.execute({ email: 'a@b.com' });
    expect(userRepo.createEmailVerificationOtp).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('cooldown active (recent OTP) → uniform success, no new OTP issued', async () => {
    const { useCase, userRepo, eventBus } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      }),
      findRecentEmailVerificationOtp: jest.fn().mockResolvedValue({
        id: 'old-otp',
        createdAt: new Date(),
      }),
    });
    await useCase.execute({ email: 'a@b.com' });
    expect(userRepo.invalidateActiveEmailVerificationOtps).not.toHaveBeenCalled();
    expect(userRepo.createEmailVerificationOtp).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('happy path: invalidates old OTPs, creates new, publishes event', async () => {
    const { useCase, userRepo, eventBus } = buildUseCase({
      findByEmailForVerification: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      }),
      findRecentEmailVerificationOtp: jest.fn().mockResolvedValue(null),
    });
    await useCase.execute({ email: 'a@b.com' });

    expect(userRepo.invalidateActiveEmailVerificationOtps).toHaveBeenCalledWith('u-1');
    expect(userRepo.createEmailVerificationOtp).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = eventBus.publish.mock.calls[0][0];
    expect(event.eventName).toBe('identity.user.verification_otp_requested');
    expect(event.payload.otpPlaintext).toMatch(/^\d{6}$/);
    expect(event.payload.reason).toBe('resend');
  });
});
