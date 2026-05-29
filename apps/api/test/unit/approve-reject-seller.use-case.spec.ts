import 'reflect-metadata';
import { ApproveSellerUseCase } from '../../src/modules/seller/application/use-cases/approve-seller.use-case';
import { RejectSellerUseCase } from '../../src/modules/seller/application/use-cases/reject-seller.use-case';

/**
 * Phase 19 (2026-05-20) — Approve / Reject use-case tests.
 *
 * Pins:
 *   • approve no longer auto-flips isGstVerified / panVerified
 *   • approve writes kycApprovalNotes + kycReviewedAt + kycReviewedBy
 *   • reject writes kycRejectionReason in the dedicated column
 *   • both write AuditLog rows
 *   • both publish their respective events
 *   • symmetric pre-conditions: both require status=PENDING_APPROVAL
 *     AND verificationStatus=UNDER_REVIEW
 */

const buildCommon = (overrides: Partial<any> = {}) => {
  const sellerRepo = {
    findByIdSelect: jest.fn().mockResolvedValue({
      id: 's-1',
      status: 'PENDING_APPROVAL',
      verificationStatus: 'UNDER_REVIEW',
      isDeleted: false,
      gstin: '27AAAAA1234A1Z5',
      panNumber: 'AAAAA1234A',
    }),
    updateSellerSelect: jest.fn().mockResolvedValue({
      id: 's-1',
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
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
  return { sellerRepo, eventBus, audit, logger };
};

describe('ApproveSellerUseCase', () => {
  it('happy path: flips status + verification, writes kyc audit columns, no auto-GST flag', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon();
    const uc = new ApproveSellerUseCase(sellerRepo, eventBus, audit, logger);
    await uc.execute({ sellerId: 's-1', adminId: 'a-1', notes: 'looks ok' });

    const update = sellerRepo.updateSellerSelect.mock.calls[0][1];
    expect(update.status).toBe('ACTIVE');
    expect(update.verificationStatus).toBe('VERIFIED');
    expect(update.kycApprovalNotes).toBe('looks ok');
    expect(update.kycReviewedBy).toBe('a-1');
    expect(update.kycReviewedAt).toBeInstanceOf(Date);
    expect(update.kycRejectionReason).toBeNull();
    // CRITICAL: Phase 19 no longer auto-flips these.
    expect(update.isGstVerified).toBeUndefined();
    expect(update.panVerified).toBeUndefined();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SELLER_APPROVED' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'seller.approved' }),
    );
  });

  it('rejects when seller is not UNDER_REVIEW', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'PENDING_APPROVAL',
        verificationStatus: 'NOT_VERIFIED',
        isDeleted: false,
      }),
    });
    const uc = new ApproveSellerUseCase(sellerRepo, eventBus, audit, logger);
    await expect(uc.execute({ sellerId: 's-1', adminId: 'a-1' })).rejects.toThrow(
      /not under review/i,
    );
  });

  it('rejects when seller has no GSTIN', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'PENDING_APPROVAL',
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
        gstin: null,
        panNumber: 'AAAAA1234A',
      }),
    });
    const uc = new ApproveSellerUseCase(sellerRepo, eventBus, audit, logger);
    await expect(uc.execute({ sellerId: 's-1', adminId: 'a-1' })).rejects.toThrow(
      /without a GSTIN/i,
    );
  });
});

describe('RejectSellerUseCase', () => {
  it('happy path: writes kycRejectionReason (not gstVerificationNotes), audit, event', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon();
    sellerRepo.updateSellerSelect.mockResolvedValueOnce({
      id: 's-1',
      verificationStatus: 'REJECTED',
    });
    const uc = new RejectSellerUseCase(sellerRepo, eventBus, audit, logger);
    const reason = 'GSTIN format invalid';
    await uc.execute({ sellerId: 's-1', adminId: 'a-1', reason });

    const update = sellerRepo.updateSellerSelect.mock.calls[0][1];
    expect(update.verificationStatus).toBe('REJECTED');
    expect(update.kycRejectionReason).toBe(reason);
    expect(update.kycReviewedBy).toBe('a-1');
    expect(update.kycReviewedAt).toBeInstanceOf(Date);
    // Legacy overloaded column is explicitly cleared on reject so
    // post-Phase-19 reads only see the dedicated column.
    expect(update.gstVerificationNotes).toBeNull();
    expect(update.kycApprovalNotes).toBeNull();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SELLER_REJECTED' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'seller.rejected' }),
    );
  });

  it('rejects empty reason', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon();
    const uc = new RejectSellerUseCase(sellerRepo, eventBus, audit, logger);
    await expect(
      uc.execute({ sellerId: 's-1', adminId: 'a-1', reason: '   ' }),
    ).rejects.toThrow(/reason is required/i);
  });

  it('requires both status=PENDING_APPROVAL AND verification=UNDER_REVIEW (symmetry with approve)', async () => {
    const { sellerRepo, eventBus, audit, logger } = buildCommon({
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's-1',
        status: 'SUSPENDED',
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
      }),
    });
    const uc = new RejectSellerUseCase(sellerRepo, eventBus, audit, logger);
    await expect(
      uc.execute({ sellerId: 's-1', adminId: 'a-1', reason: 'x' }),
    ).rejects.toThrow(/not pending approval/i);
  });
});
