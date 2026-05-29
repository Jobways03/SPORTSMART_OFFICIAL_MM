import 'reflect-metadata';
import { AdminUpdateFranchiseVerificationUseCase } from '../../src/modules/franchise/application/use-cases/admin-update-franchise-verification.use-case';
import { ConflictAppException } from '../../src/core/exceptions';

/**
 * Phase 20 / 159j — AdminUpdateFranchiseVerificationUseCase tests.
 *
 * Phase 20 pinned the verification state machine:
 *   NOT_VERIFIED → UNDER_REVIEW
 *   UNDER_REVIEW → VERIFIED, REJECTED
 *   REJECTED     → UNDER_REVIEW
 *   VERIFIED     → NOT_VERIFIED
 * Anything else throws VERIFICATION_TRANSITION_FORBIDDEN.
 *
 * Phase 159j added: prisma status-CAS (concurrent loser → Conflict), an
 * append-only franchise_verification_events row, a KYC-completeness gate
 * (PAN + GST must be on file before VERIFIED), and an HTML-stripped reason.
 * The use-case now reads/writes via prisma directly (was franchiseRepo).
 */
describe('AdminUpdateFranchiseVerificationUseCase', () => {
  const buildUseCase = (
    opts: {
      verificationStatus?: string;
      panNumber?: string | null;
      gstNumber?: string | null;
      isDeleted?: boolean;
      found?: boolean;
      casCount?: number;
    } = {},
  ) => {
    const franchise =
      opts.found === false
        ? null
        : {
            id: 'f-1',
            isDeleted: opts.isDeleted ?? false,
            verificationStatus: opts.verificationStatus ?? 'UNDER_REVIEW',
            // `undefined` → present (default); explicit `null` → missing.
            panNumber: opts.panNumber === undefined ? 'ABCPF1234F' : opts.panNumber,
            gstNumber:
              opts.gstNumber === undefined ? '27ABCPF1234F1Z5' : opts.gstNumber,
          };
    const updateMany = jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 });
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      franchisePartner: {
        findUnique: jest.fn().mockResolvedValue(franchise),
        updateMany,
      },
      franchiseVerificationEvent: { create: eventCreate },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    const franchiseRepo = {
      findById: jest.fn(),
      updateFranchise: jest.fn(),
    } as any;
    return {
      useCase: new AdminUpdateFranchiseVerificationUseCase(
        franchiseRepo,
        eventBus,
        audit,
        logger,
        prisma,
      ),
      updateMany,
      eventCreate,
      eventBus,
      audit,
    };
  };

  it('rejects when franchise not found', async () => {
    const { useCase } = buildUseCase({ found: false });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'UNDER_REVIEW',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('idempotent: same state → no updateMany call', async () => {
    const { useCase, updateMany } = buildUseCase({ verificationStatus: 'VERIFIED' });
    const out = await useCase.execute({
      adminId: 'a',
      franchiseId: 'f-1',
      verificationStatus: 'VERIFIED',
    });
    expect(out.verificationStatus).toBe('VERIFIED');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('NOT_VERIFIED → UNDER_REVIEW: allowed; stamps reviewer + CAS guard + history row', async () => {
    const { useCase, updateMany, eventCreate } = buildUseCase({
      verificationStatus: 'NOT_VERIFIED',
    });
    await useCase.execute({
      adminId: 'admin-1',
      franchiseId: 'f-1',
      verificationStatus: 'UNDER_REVIEW',
    });
    const call = updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'f-1', verificationStatus: 'NOT_VERIFIED' }); // CAS
    expect(call.data.verificationStatus).toBe('UNDER_REVIEW');
    expect(call.data.verificationReviewedBy).toBe('admin-1');
    expect(call.data.verificationReviewedAt).toBeInstanceOf(Date);
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'NOT_VERIFIED',
          toStatus: 'UNDER_REVIEW',
          changedByAdminId: 'admin-1',
        }),
      }),
    );
  });

  it('UNDER_REVIEW → VERIFIED: allowed when PAN+GST on file; stores approvalNotes (HTML-stripped)', async () => {
    const { useCase, updateMany, audit } = buildUseCase({
      verificationStatus: 'UNDER_REVIEW',
    });
    await useCase.execute({
      adminId: 'a',
      franchiseId: 'f-1',
      verificationStatus: 'VERIFIED',
      reason: '<b>all clean</b>',
    });
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.verificationStatus).toBe('VERIFIED');
    expect(data.verificationApprovalNotes).toBe('all clean'); // HTML stripped
    expect(data.verificationRejectionReason).toBeNull();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_VERIFICATION_CHANGED' }),
    );
  });

  it('UNDER_REVIEW → VERIFIED: BLOCKED when PAN missing (audit #16)', async () => {
    const { useCase, updateMany } = buildUseCase({
      verificationStatus: 'UNDER_REVIEW',
      panNumber: null,
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'VERIFIED',
      }),
    ).rejects.toThrow(/PAN on file/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('UNDER_REVIEW → VERIFIED: BLOCKED when GST missing (audit #16)', async () => {
    const { useCase } = buildUseCase({
      verificationStatus: 'UNDER_REVIEW',
      gstNumber: null,
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'VERIFIED',
      }),
    ).rejects.toThrow(/GSTIN on file/i);
  });

  it('UNDER_REVIEW → REJECTED: stores rejectionReason (HTML-stripped); PAN/GST not required', async () => {
    const { useCase, updateMany } = buildUseCase({
      verificationStatus: 'UNDER_REVIEW',
      panNumber: null,
      gstNumber: null,
    });
    await useCase.execute({
      adminId: 'a',
      franchiseId: 'f-1',
      verificationStatus: 'REJECTED',
      reason: 'GSTIN mismatch <script>x</script>',
    });
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.verificationStatus).toBe('REJECTED');
    expect(data.verificationRejectionReason).toBe('GSTIN mismatch x'); // stripped
    expect(data.verificationApprovalNotes).toBeNull();
  });

  it('throws Conflict when CAS matches 0 rows (concurrent change)', async () => {
    const { useCase } = buildUseCase({
      verificationStatus: 'UNDER_REVIEW',
      casCount: 0,
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'REJECTED',
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('VERIFIED → REJECTED: forbidden (out of FSM)', async () => {
    const { useCase } = buildUseCase({ verificationStatus: 'VERIFIED' });
    try {
      await useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'REJECTED',
      });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('VERIFICATION_TRANSITION_FORBIDDEN');
    }
  });

  it('NOT_VERIFIED → VERIFIED: forbidden (must go through UNDER_REVIEW)', async () => {
    const { useCase } = buildUseCase({ verificationStatus: 'NOT_VERIFIED' });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        verificationStatus: 'VERIFIED',
      }),
    ).rejects.toThrow(/Illegal verification transition/);
  });

  it('VERIFIED → NOT_VERIFIED: allowed (explicit admin reset); clears both notes', async () => {
    const { useCase, updateMany } = buildUseCase({ verificationStatus: 'VERIFIED' });
    const out = await useCase.execute({
      adminId: 'a',
      franchiseId: 'f-1',
      verificationStatus: 'NOT_VERIFIED',
    });
    expect(out.verificationStatus).toBe('NOT_VERIFIED');
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.verificationRejectionReason).toBeNull();
    expect(data.verificationApprovalNotes).toBeNull();
  });
});
