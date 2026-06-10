import { RegisterSellerUseCase } from './register-seller.use-case';
import { ConflictAppException } from '../../../../core/exceptions';

/**
 * Seller registration signals duplicates EXPLICITLY (product decision
 * 2026-06-09): a registered email/phone → 409 ALREADY_REGISTERED so the form
 * can tell the user to sign in, instead of the old uniform anti-enumeration 202.
 * No seller is created on the duplicate path, and the race-window (P2002) maps
 * to the same 409.
 */
describe('RegisterSellerUseCase — explicit duplicate rejection', () => {
  const baseInput = {
    sellerName: 'Dup Test',
    sellerShopName: 'Dup Shop',
    email: 'submitted@example.com',
    phoneNumber: '9876543210',
    password: 'Abcd@1234',
    confirmPassword: 'Abcd@1234',
    acceptTerms: true,
    acceptPrivacy: true,
    sellerType: 'D2C' as const,
  };

  const make = (repoOverrides: Record<string, jest.Mock> = {}) => {
    const sellerRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
      createSeller: jest.fn().mockResolvedValue({ id: 'new-seller' }),
      ...repoOverrides,
    };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const sendOtp = { execute: jest.fn().mockResolvedValue({ sent: true }) };
    const uc = new RegisterSellerUseCase(
      sellerRepo as any,
      eventBus as any,
      logger as any,
      sendOtp as any,
    );
    return { uc, sellerRepo, eventBus, sendOtp };
  };

  it('rejects an email duplicate with a 409 and creates no seller', async () => {
    const { uc, sellerRepo, sendOtp } = make({
      findByEmail: jest
        .fn()
        .mockResolvedValue({ id: 'owner-1', email: 'submitted@example.com' }),
    });

    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
    expect(err.message).toMatch(/already exists/i);
    expect(err.message).toMatch(/sign in/i);
    expect(sellerRepo.createSeller).not.toHaveBeenCalled();
    expect(sendOtp.execute).not.toHaveBeenCalled();
  });

  it('rejects a phone duplicate with a 409', async () => {
    const { uc, sellerRepo } = make({
      findByPhone: jest
        .fn()
        .mockResolvedValue({ id: 'phone-owner', email: 'real-owner@example.com' }),
    });

    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
    expect(sellerRepo.createSeller).not.toHaveBeenCalled();
  });

  it('maps a P2002 unique-constraint race to the same 409', async () => {
    const { uc } = make({
      createSeller: jest.fn().mockRejectedValue({ code: 'P2002' }),
    });

    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
  });

  it('creates the seller + sends the OTP for a genuinely fresh registration', async () => {
    const { uc, sellerRepo, sendOtp, eventBus } = make();

    const res = await uc.execute(baseInput);

    expect(sellerRepo.createSeller).toHaveBeenCalledTimes(1);
    expect(sendOtp.execute).toHaveBeenCalledWith('new-seller');
    expect(res.requiresVerification).toBe(true);
    expect(
      eventBus.publish.mock.calls.some(
        (c) => c[0].eventName === 'seller.registered',
      ),
    ).toBe(true);
  });
});
