import 'reflect-metadata';
import { SubmitSellerOnboardingUseCase } from '../../src/modules/seller/application/use-cases/submit-seller-onboarding.use-case';

/**
 * Phase 19 (2026-05-20) — SubmitSellerOnboardingUseCase unit tests.
 *
 * Pins the pre-Phase-19 invariants (consent, state-machine guards,
 * PAN↔GSTIN cross-check) PLUS the Phase 19 additions:
 *   • GSTIN[0:2] === gstStateCode cross-check
 *   • Duplicate GSTIN/PAN pre-checks
 *   • AuditLog row + kycConfirmedAccurateAt stamping
 *   • UNREGISTERED is no longer reachable (DTO rejects, type doesn't allow)
 */

describe('SubmitSellerOnboardingUseCase', () => {
  const baseInput = {
    sellerId: 's-1',
    legalBusinessName: 'Acme Sports Pvt Ltd',
    gstRegistrationType: 'REGULAR' as const,
    gstin: '27AAAAA1234A1Z5',
    gstStateCode: '27',
    panNumber: 'AAAAA1234A',
    registeredBusinessAddress: {
      line1: '1 Main Rd',
      city: 'Mumbai',
      state: 'MH',
      pincode: '400001',
      country: 'India',
    },
    storeAddress: '1 Main Rd',
    city: 'Mumbai',
    state: 'MH',
    country: 'India',
    sellerZipCode: '400001',
    confirmedAccurate: true,
  };

  const buildUseCase = (overrides: Partial<any> = {}) => {
    const sellerRepo = {
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'PENDING_APPROVAL',
        isEmailVerified: true,
        verificationStatus: 'NOT_VERIFIED',
        isDeleted: false,
      }),
      findByGstin: jest.fn().mockResolvedValue(null),
      findByPanNumber: jest.fn().mockResolvedValue(null),
      updateSellerSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        verificationStatus: 'UNDER_REVIEW',
        isProfileCompleted: true,
      }),
      ...overrides,
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const audit = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    return {
      useCase: new SubmitSellerOnboardingUseCase(
        sellerRepo,
        eventBus,
        audit,
        logger,
      ),
      sellerRepo,
      eventBus,
      audit,
    };
  };

  it('rejects when confirmedAccurate is false', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, confirmedAccurate: false }),
    ).rejects.toThrow(/confirm.+accurate/i);
  });

  it('rejects when seller is not email-verified', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'PENDING_APPROVAL',
        isEmailVerified: false,
        verificationStatus: 'NOT_VERIFIED',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(/Verify your email/i);
  });

  it('rejects when status is not PENDING_APPROVAL', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'ACTIVE',
        isEmailVerified: true,
        verificationStatus: 'VERIFIED',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /PENDING_APPROVAL/,
    );
  });

  it('rejects when already UNDER_REVIEW', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'PENDING_APPROVAL',
        isEmailVerified: true,
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(/already under review/i);
  });

  it('rejects GSTIN/PAN mismatch', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, panNumber: 'BBBBB1234B' }),
    ).rejects.toThrow(/GSTIN does not embed/i);
  });

  it('rejects GSTIN state-code mismatch (Phase 19 new check)', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, gstStateCode: '07' }),
    ).rejects.toThrow(/state code mismatch/i);
  });

  it('rejects duplicate GSTIN (different seller)', async () => {
    const { useCase } = buildUseCase({
      findByGstin: jest.fn().mockResolvedValue({ id: 's-OTHER' }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /GSTIN is already registered/i,
    );
  });

  it('rejects duplicate PAN (different seller)', async () => {
    const { useCase } = buildUseCase({
      findByPanNumber: jest.fn().mockResolvedValue({ id: 's-OTHER' }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /PAN is already registered/i,
    );
  });

  it('happy path: writes seller, audit log, event', async () => {
    const { useCase, sellerRepo, eventBus, audit } = buildUseCase();
    const out = await useCase.execute({ ...baseInput, ipAddress: '1.2.3.4', userAgent: 'TestAgent/1.0' });

    expect(out.verificationStatus).toBe('UNDER_REVIEW');
    expect(sellerRepo.updateSellerSelect).toHaveBeenCalledTimes(1);
    const update = sellerRepo.updateSellerSelect.mock.calls[0][1];
    expect(update.verificationStatus).toBe('UNDER_REVIEW');
    expect(update.kycConfirmedAccurateAt).toBeInstanceOf(Date);
    // Stale rejection state cleared on resubmit.
    expect(update.kycRejectionReason).toBeNull();
    expect(update.gstVerificationNotes).toBeNull();

    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog.mock.calls[0][0].action).toBe(
      'SELLER_KYC_SUBMITTED',
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'seller.onboarding_submitted' }),
    );
  });

  it('seller can re-submit their own GSTIN (same sellerId)', async () => {
    const { useCase } = buildUseCase({
      findByGstin: jest.fn().mockResolvedValue({ id: 's-1' }),
      findByPanNumber: jest.fn().mockResolvedValue({ id: 's-1' }),
    });
    const out = await useCase.execute(baseInput);
    expect(out.verificationStatus).toBe('UNDER_REVIEW');
  });

  it('translates Prisma P2002 (race) into a 409', async () => {
    const { useCase } = buildUseCase({
      updateSellerSelect: jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: { target: ['gstin'] },
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /GSTIN is already registered/i,
    );
  });
});
