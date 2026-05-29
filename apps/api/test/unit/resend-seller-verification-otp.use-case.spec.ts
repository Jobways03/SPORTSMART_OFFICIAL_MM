import 'reflect-metadata';
import { ResendSellerVerificationOtpUseCase } from '../../src/modules/seller/application/use-cases/resend-seller-verification-otp.use-case';
import { TooManyRequestsAppException } from '../../src/core/exceptions/too-many-requests.exception';

/**
 * Phase 18 (2026-05-20) — Seller resend verification OTP.
 *
 * Verifies enumeration safety: response is uniform regardless of
 * whether the email is registered or already-verified.
 */

describe('ResendSellerVerificationOtpUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    const sellerRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      ...overrides,
    } as any;
    const sendOtp = {
      execute: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;
    return {
      useCase: new ResendSellerVerificationOtpUseCase(sellerRepo, sendOtp, logger),
      sellerRepo,
      sendOtp,
    };
  };

  it('unknown email → uniform success, no OTP sent', async () => {
    const { useCase, sendOtp } = buildUseCase();
    const out = await useCase.execute({ email: 'ghost@example.com' });
    expect(sendOtp.execute).not.toHaveBeenCalled();
    expect(out.message).toMatch(/awaiting verification/i);
  });

  it('already-verified seller → uniform success, no OTP sent', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        isEmailVerified: true,
      }),
    });
    await useCase.execute({ email: 'a@b.com' });
    expect(sendOtp.execute).not.toHaveBeenCalled();
  });

  it('happy path → calls sendOtp + uniform response', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        isEmailVerified: false,
      }),
    });
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(sendOtp.execute).toHaveBeenCalledWith('s-1');
    expect(out.retryAfterSeconds).toBeUndefined();
  });

  it('cooldown active: surfaces retryAfterSeconds inside uniform shape', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        isEmailVerified: false,
      }),
    });
    sendOtp.execute.mockRejectedValueOnce(
      new TooManyRequestsAppException('Please wait 45 seconds'),
    );
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(out.retryAfterSeconds).toBe(60);
  });

  it('SMTP soft-fail: same uniform success message (no enumeration via send-failure)', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 's-1',
        isEmailVerified: false,
      }),
    });
    sendOtp.execute.mockResolvedValueOnce({ sent: false });
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(out.message).toMatch(/awaiting verification/i);
    expect(out.retryAfterSeconds).toBeUndefined();
  });
});
