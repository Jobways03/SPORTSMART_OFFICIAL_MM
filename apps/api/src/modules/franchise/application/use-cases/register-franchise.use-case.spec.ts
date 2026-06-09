import { RegisterFranchiseUseCase } from './register-franchise.use-case';
import { ConflictAppException } from '../../../../core/exceptions';

/**
 * Franchise registration signals duplicates EXPLICITLY (product decision
 * 2026-06-09) — matching the seller portal: a registered email/phone → 409
 * ALREADY_REGISTERED so the form can tell the user to sign in. The separate
 * franchise_code P2002 retry must still work (it is NOT a duplicate-account
 * error).
 */
describe('RegisterFranchiseUseCase — explicit duplicate rejection', () => {
  const baseInput = {
    ownerName: 'Dup Owner',
    businessName: 'Dup Biz',
    email: 'submitted@example.com',
    phoneNumber: '9876543210',
    password: 'Abcd@1234',
    confirmPassword: 'Abcd@1234',
    acceptTerms: true,
    acceptPrivacy: true,
  };

  const make = (repoOverrides: Record<string, jest.Mock> = {}) => {
    const franchiseRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
      generateNextFranchiseCode: jest.fn().mockResolvedValue('FR-0001'),
      createFranchise: jest.fn().mockResolvedValue({
        id: 'new-franchise',
        email: 'submitted@example.com',
        ownerName: 'Dup Owner',
        businessName: 'Dup Biz',
      }),
      ...repoOverrides,
    };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const sendOtp = { execute: jest.fn().mockResolvedValue({ sent: true }) };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    // Constructor order: repo, eventBus, sendOtp, logger.
    const uc = new RegisterFranchiseUseCase(
      franchiseRepo as any,
      eventBus as any,
      sendOtp as any,
      logger as any,
    );
    return { uc, franchiseRepo, eventBus, sendOtp };
  };

  it('rejects an email duplicate with a 409 and creates no franchise', async () => {
    const { uc, franchiseRepo, sendOtp } = make({
      findByEmail: jest
        .fn()
        .mockResolvedValue({ id: 'owner-1', email: 'submitted@example.com' }),
    });
    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
    expect(err.message).toMatch(/already exists/i);
    expect(err.message).toMatch(/sign in/i);
    expect(franchiseRepo.createFranchise).not.toHaveBeenCalled();
    expect(sendOtp.execute).not.toHaveBeenCalled();
  });

  it('rejects a phone duplicate with a 409', async () => {
    const { uc, franchiseRepo } = make({
      findByPhone: jest
        .fn()
        .mockResolvedValue({ id: 'phone-owner', email: 'real-owner@example.com' }),
    });
    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
    expect(franchiseRepo.createFranchise).not.toHaveBeenCalled();
  });

  it('maps an email/phone P2002 race to the same 409', async () => {
    const { uc } = make({
      createFranchise: jest
        .fn()
        .mockRejectedValue({ code: 'P2002', meta: { target: ['email'] } }),
    });
    const err = await uc.execute(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
  });

  it('still retries on a franchise_code P2002 (not a duplicate-account error)', async () => {
    let calls = 0;
    const createFranchise = jest.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject({
          code: 'P2002',
          meta: { target: ['franchise_code'] },
        });
      }
      return Promise.resolve({
        id: 'fr-2',
        email: 'submitted@example.com',
        ownerName: 'Dup Owner',
        businessName: 'Dup Biz',
      });
    });
    const { uc, franchiseRepo } = make({ createFranchise });
    const res = await uc.execute(baseInput);
    expect(franchiseRepo.createFranchise).toHaveBeenCalledTimes(2);
    expect(res.requiresVerification).toBe(true);
  });

  it('creates the franchise + sends the OTP for a fresh registration', async () => {
    const { uc, franchiseRepo, sendOtp, eventBus } = make();
    const res = await uc.execute(baseInput);
    expect(franchiseRepo.createFranchise).toHaveBeenCalledTimes(1);
    expect(sendOtp.execute).toHaveBeenCalledWith('new-franchise');
    expect(res.requiresVerification).toBe(true);
    expect(
      eventBus.publish.mock.calls.some(
        (c) => c[0].eventName === 'franchise.registered',
      ),
    ).toBe(true);
  });
});
