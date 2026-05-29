import 'reflect-metadata';
import { ResendFranchiseVerificationOtpUseCase } from '../../src/modules/franchise/application/use-cases/resend-franchise-verification-otp.use-case';
import { TooManyRequestsAppException } from '../../src/core/exceptions';

/**
 * Phase 20 (2026-05-20) — ResendFranchiseVerificationOtpUseCase tests.
 *
 * Pins enumeration-safety:
 *   - Unknown email → uniform 200, no sendOtp call.
 *   - Already-verified franchise → uniform 200, no sendOtp call.
 *   - Awaiting-verification franchise → sendOtp called, uniform 200.
 *   - Cooldown → surface retryAfterSeconds, still uniform shape.
 */

describe('ResendFranchiseVerificationOtpUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    const franchiseRepo = {
      findByEmail: jest.fn(),
      ...overrides,
    } as any;
    const sendOtp = {
      execute: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    return {
      useCase: new ResendFranchiseVerificationOtpUseCase(
        franchiseRepo,
        sendOtp,
        logger,
      ),
      franchiseRepo,
      sendOtp,
    };
  };

  it('unknown email: uniform shape, no sendOtp call', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue(null),
    });
    const out = await useCase.execute({ email: 'ghost@example.com' });
    expect(sendOtp.execute).not.toHaveBeenCalled();
    expect(out.message).toMatch(/awaiting verification/i);
    expect(out.retryAfterSeconds).toBeUndefined();
  });

  it('already-verified franchise: uniform shape, no sendOtp call', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 'f-1',
        isEmailVerified: true,
      }),
    });
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(sendOtp.execute).not.toHaveBeenCalled();
    expect(out.message).toMatch(/awaiting verification/i);
  });

  it('awaiting verification: sendOtp called, uniform shape', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 'f-1',
        isEmailVerified: false,
      }),
    });
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(sendOtp.execute).toHaveBeenCalledWith('f-1');
    expect(out.message).toMatch(/awaiting verification/i);
    expect(out.retryAfterSeconds).toBeUndefined();
  });

  it('cooldown TooManyRequests: surfaces retryAfterSeconds, still uniform', async () => {
    const { useCase, sendOtp } = buildUseCase({
      findByEmail: jest.fn().mockResolvedValue({
        id: 'f-1',
        isEmailVerified: false,
      }),
    });
    sendOtp.execute.mockRejectedValueOnce(
      new TooManyRequestsAppException('rate limited'),
    );
    const out = await useCase.execute({ email: 'a@b.com' });
    expect(out.retryAfterSeconds).toBe(60);
    expect(out.message).toMatch(/awaiting verification/i);
  });
});
