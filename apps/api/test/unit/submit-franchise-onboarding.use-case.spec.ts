import 'reflect-metadata';
import { SubmitFranchiseOnboardingUseCase } from '../../src/modules/franchise/application/use-cases/submit-franchise-onboarding.use-case';

/**
 * Phase 20 (2026-05-20) — SubmitFranchiseOnboardingUseCase tests.
 *
 * Pins KYC-submission gates:
 *   • Email-verified precondition.
 *   • PENDING-only precondition.
 *   • UNDER_REVIEW / VERIFIED reject paths.
 *   • GSTIN[2:12] == PAN cross-check.
 *   • GSTIN[0:2] == gstStateCode cross-check.
 *   • Duplicate GSTIN / PAN owned by other franchise → 409 conflict.
 *   • Happy path stamps UNDER_REVIEW + emits event + writes audit row.
 *   • confirmedAccurate=false rejected.
 */

describe('SubmitFranchiseOnboardingUseCase', () => {
  const validGstin = '27ABCDE1234F1Z5';
  const validPan = 'ABCDE1234F';
  const validStateCode = '27';

  const baseInput = {
    franchiseId: 'f-1',
    legalBusinessName: 'Acme Sports Pvt Ltd',
    gstRegistrationType: 'REGULAR' as const,
    gstNumber: validGstin,
    gstStateCode: validStateCode,
    panNumber: validPan,
    businessAddress: {
      line1: '123 Main',
      city: 'Pune',
      state: 'MH',
      pincode: '411001',
      country: 'India',
    },
    confirmedAccurate: true,
  };

  const buildUseCase = (overrides: Partial<any> = {}) => {
    const franchiseRepo = {
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 'f-1',
        status: 'PENDING',
        isEmailVerified: true,
        verificationStatus: 'NOT_VERIFIED',
        isDeleted: false,
      }),
      findByGstNumber: jest.fn().mockResolvedValue(null),
      findByPanNumber: jest.fn().mockResolvedValue(null),
      updateFranchiseSelect: jest
        .fn()
        .mockResolvedValue({ id: 'f-1', verificationStatus: 'UNDER_REVIEW' }),
      ...overrides,
    } as any;
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const audit = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    return {
      useCase: new SubmitFranchiseOnboardingUseCase(
        franchiseRepo,
        eventBus,
        audit,
        logger,
      ),
      franchiseRepo,
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

  it('rejects when franchise is not found', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue(null),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(/not found/i);
  });

  it('rejects when email is not verified', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 'f-1',
        status: 'PENDING',
        isEmailVerified: false,
        verificationStatus: 'NOT_VERIFIED',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(/Verify your email/i);
  });

  it('rejects when status is not PENDING', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 'f-1',
        status: 'ACTIVE',
        isEmailVerified: true,
        verificationStatus: 'VERIFIED',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /only allowed while the account is PENDING/i,
    );
  });

  it('rejects when verification is already UNDER_REVIEW', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 'f-1',
        status: 'PENDING',
        isEmailVerified: true,
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /already under review/i,
    );
  });

  it('rejects when GSTIN does not embed PAN', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({
        ...baseInput,
        panNumber: 'XYZAB1234F', // not embedded in GSTIN[2:12]=ABCDE1234F
      }),
    ).rejects.toThrow(/positions 3-12 must equal the PAN/i);
  });

  it('rejects when state code does not match GSTIN[0:2]', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ ...baseInput, gstStateCode: '07' }),
    ).rejects.toThrow(/state code mismatch/i);
  });

  it('rejects when GSTIN is owned by another franchise', async () => {
    const { useCase } = buildUseCase({
      findByGstNumber: jest.fn().mockResolvedValue({ id: 'other-franchise' }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /GSTIN is already registered/i,
    );
  });

  it('rejects when PAN is owned by another franchise', async () => {
    const { useCase } = buildUseCase({
      findByPanNumber: jest.fn().mockResolvedValue({ id: 'other-franchise' }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /PAN is already registered/i,
    );
  });

  it('happy path: stamps UNDER_REVIEW, writes audit, emits event, payload JSON saved', async () => {
    const { useCase, franchiseRepo, audit, eventBus } = buildUseCase();
    const out = await useCase.execute(baseInput);
    expect(out.verificationStatus).toBe('UNDER_REVIEW');
    const patch = franchiseRepo.updateFranchiseSelect.mock.calls[0][1];
    expect(patch.verificationStatus).toBe('UNDER_REVIEW');
    expect(patch.kycSubmittedAt).toBeInstanceOf(Date);
    expect(patch.kycConfirmedAccurateAt).toBeInstanceOf(Date);
    expect(patch.panLast4).toBe('234F');
    expect(patch.verificationRejectionReason).toBeNull();
    expect(patch.kycSubmittedPayloadJson.gstNumber).toBe(validGstin);
    expect(patch.kycSubmittedPayloadJson.panLast4).toBe('234F');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_KYC_SUBMITTED' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'franchise.onboarding_submitted' }),
    );
  });

  it('REJECTED franchise can resubmit (verification flips back to UNDER_REVIEW)', async () => {
    const { useCase } = buildUseCase({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 'f-1',
        status: 'PENDING',
        isEmailVerified: true,
        verificationStatus: 'REJECTED',
        isDeleted: false,
      }),
    });
    const out = await useCase.execute(baseInput);
    expect(out.verificationStatus).toBe('UNDER_REVIEW');
  });

  it('P2002 race on gst_number unique → 409 conflict', async () => {
    const { useCase } = buildUseCase({
      updateFranchiseSelect: jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: { target: ['gst_number'] },
      }),
    });
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /GSTIN is already registered/i,
    );
  });
});
