import 'reflect-metadata';
import {
  WalletAdjustmentService,
  WalletAdjustmentSelfApprovalError,
  WalletAdjustmentDuplicateApproverError,
  WalletAdjustmentFirstApproverRoleError,
  WalletAdjustmentSecondApproverRoleError,
} from '../../src/modules/tax/application/services/wallet-adjustment.service';

// Phase 13 GST — WalletAdjustmentService tests.
//
// Unit-level: prisma + wallet facade are mocked. The DB-roundtrip
// behaviour (FK constraints, UNIQUE on idempotencyKey racing two
// concurrent posts) is exercised by Phase 27 integration tests.

interface MockPrisma {
  return: { findUnique: jest.Mock; update: jest.Mock };
  taxDocument: { findFirst: jest.Mock };
  orderItemTaxSnapshot: { findMany: jest.Mock };
  orderItem: { findUnique: jest.Mock };
  walletAdjustment: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  walletAdjustmentHistory: { create: jest.Mock };
  admin: { findUnique: jest.Mock };
  adminRoleAssignment: { findFirst: jest.Mock };
  platformExpense: { create: jest.Mock };
  $transaction: jest.Mock;
}

interface MockWallet {
  creditAdjustment: jest.Mock;
  debitAdjustment: jest.Mock;
}

function makeService(
  envOverrides: Partial<{
    threshold: number;
    autoApprove: boolean;
  }> = {},
): {
  service: WalletAdjustmentService;
  prisma: MockPrisma;
  wallet: MockWallet;
} {
  // Captures the data passed to walletAdjustment.updateMany (reject CAS) so
  // findUniqueOrThrow can echo it back as the "rejected" row.
  let rejectCaptured: any = {};
  const prisma: MockPrisma = {
    return: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    platformExpense: { create: jest.fn().mockResolvedValue({}) },
    taxDocument: { findFirst: jest.fn() },
    orderItemTaxSnapshot: { findMany: jest.fn() },
    orderItem: { findUnique: jest.fn() },
    walletAdjustment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // Phase 162 — reject() now uses a CAS updateMany + re-read. The stateful
      // pair captures the update data so findUniqueOrThrow returns the rejected
      // row (incl. the :rejected-<ts> idempotencyKey suffix) the tests assert on.
      updateMany: jest.fn(async (a: any) => {
        rejectCaptured = a.data ?? {};
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'mock', ...rejectCaptured })),
    },
    walletAdjustmentHistory: { create: jest.fn().mockResolvedValue({}) },
    // Default role lookups → "not a Super Admin, not a TaxMgr" so single-
    // approval tests that don't care about roles pass through unchanged.
    // Dual-approval tests override these per-case.
    admin: { findUnique: jest.fn().mockResolvedValue({ role: 'SELLER_ADMIN' }) },
    adminRoleAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    // Pass-through transaction — invokes the callback with `prisma`
    // itself so per-table mocks (walletAdjustment.update, return.update)
    // are reused. Sufficient for unit tests that only assert call shape;
    // a real Prisma client gives stronger atomicity guarantees.
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };
  const wallet: MockWallet = {
    creditAdjustment: jest.fn(),
    debitAdjustment: jest.fn(),
  };
  const env: any = {
    getNumber: (_k: string, fb: number) =>
      envOverrides.threshold !== undefined ? envOverrides.threshold : fb,
    getBoolean: (_k: string, fb: boolean) =>
      envOverrides.autoApprove !== undefined ? envOverrides.autoApprove : fb,
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const service = new WalletAdjustmentService(
    prisma as any,
    env,
    wallet as any,
    audit,
    // eventBus + notifications are @Optional — omitted (no-op in tests).
  );
  return { service, prisma, wallet };
}

describe('WalletAdjustmentService.requestGoodwill', () => {
  it('throws on zero / negative amount', async () => {
    const { service } = makeService();
    await expect(
      service.requestGoodwill({
        customerId: 'u-1',
        amountInPaise: 0,
        reason: 'test',
        requestedByAdminId: 'admin-1',
      }),
    ).rejects.toThrow(/positive/);
  });

  it('auto-approves when under threshold and flag is on', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 500_000,
      autoApprove: true,
    });
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockResolvedValue({
      id: 'adj-1',
      customerId: 'u-1',
      kind: 'GOODWILL',
      amountInPaise: 10_000n,
      status: 'PENDING_APPROVAL',
      idempotencyKey: 'GOODWILL:admin-1:u-1:10000:test',
      requiresDualApproval: false,
      reason: 'test',
    });
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-1' },
    });
    prisma.walletAdjustment.update.mockResolvedValue({
      id: 'adj-1',
      status: 'APPROVED',
      walletTransactionId: 'tx-1',
    });

    const result = await service.requestGoodwill({
      customerId: 'u-1',
      amountInPaise: 10_000,
      reason: 'test',
      requestedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('APPROVED');
    expect(result.walletTransactionId).toBe('tx-1');
  });

  it('stays PENDING_APPROVAL when above threshold', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 500_000,
      autoApprove: true,
    });
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockResolvedValue({
      id: 'adj-2',
      customerId: 'u-1',
      kind: 'GOODWILL',
      amountInPaise: 1_000_000n,
      status: 'PENDING_APPROVAL',
      idempotencyKey: 'GOODWILL:admin-1:u-1:1000000:big',
      requiresDualApproval: true,
      reason: 'big',
    });

    const result = await service.requestGoodwill({
      customerId: 'u-1',
      amountInPaise: 1_000_000,
      reason: 'big',
      requestedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(result.requiresDualApproval).toBe(true);
  });

  it('stays PENDING_APPROVAL when auto-approve flag is off', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 500_000,
      autoApprove: false,
    });
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockResolvedValue({
      id: 'adj-3',
      customerId: 'u-1',
      kind: 'GOODWILL',
      amountInPaise: 1_000n,
      status: 'PENDING_APPROVAL',
      idempotencyKey: 'GOODWILL:admin-1:u-1:1000:tiny',
      requiresDualApproval: false,
      reason: 'tiny',
    });

    const result = await service.requestGoodwill({
      customerId: 'u-1',
      amountInPaise: 1_000,
      reason: 'tiny',
      requestedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
  });

  it('returns existing row on idempotent retry', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-existing',
      status: 'APPROVED',
      walletTransactionId: 'tx-existing',
    });
    const result = await service.requestGoodwill({
      customerId: 'u-1',
      amountInPaise: 10_000,
      reason: 'retry',
      requestedByAdminId: 'admin-1',
    });
    expect(prisma.walletAdjustment.create).not.toHaveBeenCalled();
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(result.id).toBe('adj-existing');
  });
});

describe('WalletAdjustmentService.requestManualDebit', () => {
  it('always requires dual approval regardless of size', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 500_000,
      autoApprove: true,
    });
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockResolvedValue({
      id: 'adj-d1',
      customerId: 'u-1',
      kind: 'MANUAL_DEBIT',
      amountInPaise: -100n,
      status: 'PENDING_APPROVAL',
      idempotencyKey: 'MANUAL_DEBIT:admin-1:u-1:100:fraud',
      requiresDualApproval: true,
      reason: 'fraud',
    });

    const result = await service.requestManualDebit({
      customerId: 'u-1',
      amountInPaise: 100, // ₹1 — well below threshold
      reason: 'fraud',
      requestedByAdminId: 'admin-1',
    });
    expect(wallet.debitAdjustment).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(result.requiresDualApproval).toBe(true);
    expect(result.amountInPaise).toBe(-100n);
  });

  it('persists negative amount', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockImplementation(async (args: any) => ({
      id: 'adj-d2',
      ...args.data,
    }));

    const result = await service.requestManualDebit({
      customerId: 'u-1',
      amountInPaise: 5_000,
      reason: 'chargeback',
      requestedByAdminId: 'admin-1',
    });
    expect(result.amountInPaise).toBe(-5_000n);
    expect(result.kind).toBe('MANUAL_DEBIT');
  });
});

describe('WalletAdjustmentService.approve', () => {
  it('throws on unknown adjustmentId', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    await expect(
      service.approve({ adjustmentId: 'nope', approvedByAdminId: 'admin-1' }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on already-APPROVED row', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a1',
      status: 'APPROVED',
      walletTransactionId: 'tx-prior',
      amountInPaise: 1000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'r',
    });
    const result = await service.approve({
      adjustmentId: 'adj-a1',
      approvedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(result.walletTransactionId).toBe('tx-prior');
  });

  it('refuses to approve REJECTED rows', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a2',
      status: 'REJECTED',
      amountInPaise: 1000n,
    });
    await expect(
      service.approve({ adjustmentId: 'adj-a2', approvedByAdminId: 'admin-1' }),
    ).rejects.toThrow(/cannot be approved from status REJECTED/);
  });

  it('posts credit + transitions to APPROVED for positive amounts', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a3',
      status: 'PENDING_APPROVAL',
      amountInPaise: 25_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'r',
    });
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-credit' },
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-a3',
      status: 'APPROVED',
      walletTransactionId: 'tx-credit',
      approvedByAdminId: args.data.approvedByAdminId,
    }));

    const result = await service.approve({
      adjustmentId: 'adj-a3',
      approvedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        amountInPaise: 25_000,
        adjustmentId: 'adj-a3',
      }),
    );
    expect(result.status).toBe('APPROVED');
    expect(result.walletTransactionId).toBe('tx-credit');
  });

  it('posts debit (positive paise to wallet.debit) for negative amounts', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a4',
      status: 'PENDING_APPROVAL',
      amountInPaise: -25_000n,
      customerId: 'u-1',
      kind: 'MANUAL_DEBIT',
      reason: 'chargeback',
    });
    wallet.debitAdjustment.mockResolvedValue({
      transaction: { id: 'tx-debit' },
    });
    prisma.walletAdjustment.update.mockResolvedValue({
      id: 'adj-a4',
      status: 'APPROVED',
      walletTransactionId: 'tx-debit',
    });

    const result = await service.approve({
      adjustmentId: 'adj-a4',
      approvedByAdminId: 'admin-1',
    });
    // Wallet.debit takes a positive amount; the sign was already applied
    // when the adjustment row was created.
    expect(wallet.debitAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ amountInPaise: 25_000 }),
    );
    expect(result.walletTransactionId).toBe('tx-debit');
  });

  it('bypasses wallet block for TIME_BARRED_CREDIT_NOTE', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a5',
      status: 'PENDING_APPROVAL',
      amountInPaise: 50_000n,
      customerId: 'u-1',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      reason: 'sec34',
    });
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-tb' },
    });
    prisma.walletAdjustment.update.mockResolvedValue({
      id: 'adj-a5',
      status: 'APPROVED',
    });

    await service.approve({
      adjustmentId: 'adj-a5',
      approvedByAdminId: 'admin-1',
    });
    expect(wallet.creditAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ bypassBlock: true }),
    );
  });

  it('on TIME_BARRED approval: flips the linked return to REFUNDED + books absorbed-GST PlatformExpense (Phase 109)', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-tb1',
      status: 'PENDING_APPROVAL',
      amountInPaise: 50_000n,
      customerId: 'u-1',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      reason: 'sec34',
      returnId: 'ret-1',
      requiresDualApproval: false,
      wouldHaveBeenTotalTaxInPaise: 9_000n,
    });
    wallet.creditAdjustment.mockResolvedValue({ transaction: { id: 'tx-tb1' } });
    prisma.walletAdjustment.update.mockResolvedValue({ id: 'adj-tb1', status: 'APPROVED' });

    await service.approve({ adjustmentId: 'adj-tb1', approvedByAdminId: 'admin-1' });

    // Lifecycle: the return that submitQcDecision left in QC_APPROVED now closes.
    expect(prisma.return.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ret-1' },
        data: expect.objectContaining({ status: 'REFUNDED', refundMethod: 'WALLET' }),
      }),
    );
    // Absorbed GST booked for GSTR reconciliation; sourceId namespaced to
    // avoid colliding with a liability-ledger PlatformExpense(RETURN, ret-1).
    expect(prisma.platformExpense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'RETURN',
          sourceId: 'gst-timebar:ret-1',
          expenseType: 'ABSORBED_GST',
          amountInPaise: 9_000n,
        }),
      }),
    );
  });

  it('skips the absorbed-GST PlatformExpense when there was no GST to absorb (legacy / no-invoice)', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-leg',
      status: 'PENDING_APPROVAL',
      amountInPaise: 50_000n,
      customerId: 'u-1',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      reason: 'legacy',
      returnId: 'ret-2',
      requiresDualApproval: false,
      wouldHaveBeenTotalTaxInPaise: null,
    });
    wallet.creditAdjustment.mockResolvedValue({ transaction: { id: 'tx-leg' } });
    prisma.walletAdjustment.update.mockResolvedValue({ id: 'adj-leg', status: 'APPROVED' });

    await service.approve({ adjustmentId: 'adj-leg', approvedByAdminId: 'admin-1' });

    expect(prisma.return.update).toHaveBeenCalled(); // still flips to REFUNDED
    expect(prisma.platformExpense.create).not.toHaveBeenCalled();
  });

  it('refuses to post zero-amount adjustments', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a6',
      status: 'PENDING_APPROVAL',
      amountInPaise: 0n,
      kind: 'GOODWILL',
    });
    await expect(
      service.approve({ adjustmentId: 'adj-a6', approvedByAdminId: 'admin-1' }),
    ).rejects.toThrow(/zero amount/);
  });

  it('blocks the requester from approving a dual-approval row at step 1', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a7',
      status: 'PENDING_APPROVAL',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1',
    });
    await expect(
      service.approve({
        adjustmentId: 'adj-a7',
        approvedByAdminId: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentSelfApprovalError);
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(prisma.walletAdjustment.update).not.toHaveBeenCalled();
  });

  it('parks a dual-approval row in FIRST_APPROVED on first sign-off by a TaxMgr (no posting)', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a8',
      status: 'PENDING_APPROVAL',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1',
    });
    // admin-2 = TaxMgr, not Super Admin → allowed to first-approve.
    prisma.admin.findUnique.mockResolvedValue({ role: 'SELLER_ADMIN' });
    prisma.adminRoleAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-a8',
      status: 'FIRST_APPROVED',
      firstApprovedByAdminId: args.data.firstApprovedByAdminId,
      firstApprovedAt: args.data.firstApprovedAt,
    }));
    const result = await service.approve({
      adjustmentId: 'adj-a8',
      approvedByAdminId: 'admin-2',
    });
    expect(result.status).toBe('FIRST_APPROVED');
    expect(result.firstApprovedByAdminId).toBe('admin-2');
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
  });

  it('records first approval for system-initiated dual-approval rows (requester null, TaxMgr signs)', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a9',
      status: 'PENDING_APPROVAL',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      reason: 'sec34',
      requiresDualApproval: true,
      requestedByAdminId: null,
    });
    prisma.admin.findUnique.mockResolvedValue({ role: 'SELLER_ADMIN' });
    prisma.adminRoleAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-a9',
      status: 'FIRST_APPROVED',
      firstApprovedByAdminId: args.data.firstApprovedByAdminId,
    }));
    const result = await service.approve({
      adjustmentId: 'adj-a9',
      approvedByAdminId: 'admin-1',
    });
    expect(result.status).toBe('FIRST_APPROVED');
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
  });

  it('posts to wallet on second sign-off by Super Admin', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a10',
      status: 'FIRST_APPROVED',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1',
      firstApprovedByAdminId: 'admin-2',
    });
    // admin-3 = Super Admin (second-approver requirement). admin-1
    // (requester) is a regular admin so the fallback path stays inactive.
    prisma.admin.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'admin-3'
        ? { role: 'SUPER_ADMIN' }
        : { role: 'SELLER_ADMIN' },
    );
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-final' },
    });
    prisma.walletAdjustment.update.mockResolvedValue({
      id: 'adj-a10',
      status: 'APPROVED',
      walletTransactionId: 'tx-final',
      approvedByAdminId: 'admin-3',
    });
    const result = await service.approve({
      adjustmentId: 'adj-a10',
      approvedByAdminId: 'admin-3',
    });
    expect(result.status).toBe('APPROVED');
    expect(result.walletTransactionId).toBe('tx-final');
    expect(wallet.creditAdjustment).toHaveBeenCalled();
  });

  it('blocks the same admin from signing off twice on a dual-approval row', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a11',
      status: 'FIRST_APPROVED',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1',
      firstApprovedByAdminId: 'admin-2',
    });
    await expect(
      service.approve({
        adjustmentId: 'adj-a11',
        approvedByAdminId: 'admin-2',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentDuplicateApproverError);
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(prisma.walletAdjustment.update).not.toHaveBeenCalled();
  });

  it('blocks the requester from providing the second approval', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a12',
      status: 'FIRST_APPROVED',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1',
      firstApprovedByAdminId: 'admin-2',
    });
    await expect(
      service.approve({
        adjustmentId: 'adj-a12',
        approvedByAdminId: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentSelfApprovalError);
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
  });

  it('blocks Super Admin from doing the FIRST approval on a dual-approval row', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a13',
      status: 'PENDING_APPROVAL',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-x',
    });
    // approver is Super Admin → blocked from step 1.
    prisma.admin.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' });
    prisma.adminRoleAssignment.findFirst.mockResolvedValue(null);
    await expect(
      service.approve({
        adjustmentId: 'adj-a13',
        approvedByAdminId: 'super-admin-1',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentFirstApproverRoleError);
    expect(prisma.walletAdjustment.update).not.toHaveBeenCalled();
  });

  it('blocks an admin without the TaxMgr role from doing the FIRST approval', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a14',
      status: 'PENDING_APPROVAL',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-x',
    });
    // approver is some other admin without TaxMgr (default mocks).
    await expect(
      service.approve({
        adjustmentId: 'adj-a14',
        approvedByAdminId: 'random-admin',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentFirstApproverRoleError);
  });

  it('blocks a TaxMgr from doing the SECOND approval when requester is not Super Admin', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a15',
      status: 'FIRST_APPROVED',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'GOODWILL',
      reason: 'large goodwill',
      requiresDualApproval: true,
      requestedByAdminId: 'admin-1', // not Super Admin
      firstApprovedByAdminId: 'taxmgr-1',
    });
    // approver is a different TaxMgr but requester wasn't Super Admin → no fallback.
    prisma.admin.findUnique.mockResolvedValue({ role: 'SELLER_ADMIN' });
    prisma.adminRoleAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    await expect(
      service.approve({
        adjustmentId: 'adj-a15',
        approvedByAdminId: 'taxmgr-2',
      }),
    ).rejects.toBeInstanceOf(WalletAdjustmentSecondApproverRoleError);
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
  });

  it('FALLBACK: TaxMgr can do the SECOND approval when Super Admin was the requester', async () => {
    const { service, prisma, wallet } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-a16',
      status: 'FIRST_APPROVED',
      amountInPaise: 600_000n,
      customerId: 'u-1',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      reason: 'sec34 routed by SA',
      requiresDualApproval: true,
      requestedByAdminId: 'super-admin-1',
      firstApprovedByAdminId: 'taxmgr-1',
    });
    // Approver (taxmgr-2) is a TaxMgr, not Super Admin.
    // Requester (super-admin-1) IS Super Admin → fallback path activates.
    prisma.admin.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'super-admin-1'
        ? { role: 'SUPER_ADMIN' }
        : { role: 'SELLER_ADMIN' },
    );
    prisma.adminRoleAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-fallback' },
    });
    prisma.walletAdjustment.update.mockResolvedValue({
      id: 'adj-a16',
      status: 'APPROVED',
      walletTransactionId: 'tx-fallback',
    });
    const result = await service.approve({
      adjustmentId: 'adj-a16',
      approvedByAdminId: 'taxmgr-2',
    });
    expect(result.status).toBe('APPROVED');
    expect(wallet.creditAdjustment).toHaveBeenCalled();
  });
});

describe('WalletAdjustmentService.reject', () => {
  it('throws on unknown adjustmentId', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    await expect(
      service.reject({
        adjustmentId: 'nope',
        rejectedByAdminId: 'admin-1',
        rejectionReason: 'r',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on already-REJECTED row', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-r1',
      status: 'REJECTED',
      rejectionReason: 'old reason',
    });
    const result = await service.reject({
      adjustmentId: 'adj-r1',
      rejectedByAdminId: 'admin-1',
      rejectionReason: 'new reason',
    });
    expect(prisma.walletAdjustment.update).not.toHaveBeenCalled();
    expect(result.rejectionReason).toBe('old reason');
  });

  it('refuses to reject already-APPROVED rows', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-r2',
      status: 'APPROVED',
    });
    await expect(
      service.reject({
        adjustmentId: 'adj-r2',
        rejectedByAdminId: 'admin-1',
        rejectionReason: 'r',
      }),
    ).rejects.toThrow(/cannot be rejected from status APPROVED/);
  });

  it('transitions PENDING_APPROVAL → REJECTED', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-r3',
      status: 'PENDING_APPROVAL',
      idempotencyKey: 'GOODWILL:admin-1:u-1:1000:dup',
      kind: 'GOODWILL',
      returnId: null,
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-r3',
      status: 'REJECTED',
      ...args.data,
    }));
    const result = await service.reject({
      adjustmentId: 'adj-r3',
      rejectedByAdminId: 'admin-1',
      rejectionReason: 'duplicate request',
    });
    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('duplicate request');
    expect(result.rejectedByAdminId).toBe('admin-1');
  });

  it('frees idempotencyKey + clears return.financeReviewedAt on TIME_BARRED reject so admin can re-route', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-tb-rej',
      status: 'PENDING_APPROVAL',
      kind: 'TIME_BARRED_CREDIT_NOTE',
      returnId: 'ret-77',
      idempotencyKey: 'TIME_BARRED_CREDIT_NOTE:ret-77',
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-tb-rej',
      status: 'REJECTED',
      ...args.data,
    }));
    prisma.return.update.mockResolvedValue({ id: 'ret-77' });

    const result = await service.reject({
      adjustmentId: 'adj-tb-rej',
      rejectedByAdminId: 'admin-9',
      rejectionReason: 'wrong return',
    });

    // The rejected row's key gets a :rejected-<ts> suffix so the
    // canonical TIME_BARRED_CREDIT_NOTE:ret-77 is free for a retry.
    expect(result.idempotencyKey).toMatch(
      /^TIME_BARRED_CREDIT_NOTE:ret-77:rejected-\d+$/,
    );
    expect(result.status).toBe('REJECTED');

    // The linked return's review-stamp is cleared so the timebar-review
    // page UI shows it as actionable again.
    expect(prisma.return.update).toHaveBeenCalledWith({
      where: { id: 'ret-77' },
      data: { financeReviewedAt: null, financeReviewedBy: null },
    });
  });

  it('does NOT touch return.update when rejecting a non-TIME_BARRED kind', async () => {
    const { service, prisma } = makeService();
    prisma.walletAdjustment.findUnique.mockResolvedValue({
      id: 'adj-gw-rej',
      status: 'PENDING_APPROVAL',
      kind: 'GOODWILL',
      returnId: null,
      idempotencyKey: 'GOODWILL:admin-1:u-1:5000:goodwill',
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-gw-rej',
      status: 'REJECTED',
      ...args.data,
    }));

    await service.reject({
      adjustmentId: 'adj-gw-rej',
      rejectedByAdminId: 'admin-1',
      rejectionReason: 'no',
    });

    expect(prisma.return.update).not.toHaveBeenCalled();
  });
});

describe('WalletAdjustmentService.requestForTimeBarredReturn', () => {
  it('throws when return is unknown', async () => {
    const { service, prisma } = makeService();
    prisma.return.findUnique.mockResolvedValue(null);
    await expect(
      service.requestForTimeBarredReturn({ returnId: 'nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('throws when no items are QC-approved', async () => {
    const { service, prisma } = makeService();
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-1',
      returnNumber: 'RET-2026-000099',
      customerId: 'u-1',
      subOrderId: 'sub-1',
      refundAmountInPaise: 0n,
      items: [{ qcQuantityApproved: 0, orderItemId: 'oi-1' }],
    });
    await expect(
      service.requestForTimeBarredReturn({ returnId: 'ret-1' }),
    ).rejects.toThrow(/no QC-approved items/);
  });

  it('falls back to refundAmountInPaise when no source invoice + auto-approves below threshold', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 1_000_000,
      autoApprove: true,
    });
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-2',
      returnNumber: 'RET-2026-000100',
      customerId: 'u-1',
      subOrderId: 'sub-1',
      refundAmountInPaise: 15_000n,
      items: [{ qcQuantityApproved: 1, orderItemId: 'oi-1' }],
    });
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockImplementation(async (args: any) => ({
      id: 'adj-tb1',
      status: 'PENDING_APPROVAL',
      ...args.data,
    }));
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-tb1' },
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-tb1',
      status: 'APPROVED',
      walletTransactionId: 'tx-tb1',
      wouldHaveBeenTaxableInPaise: null,
      amountInPaise: 15_000n,
      kind: 'TIME_BARRED_CREDIT_NOTE',
      idempotencyKey: 'TIME_BARRED_CREDIT_NOTE:ret-2',
      ...args.data,
    }));

    const result = await service.requestForTimeBarredReturn({
      returnId: 'ret-2',
    });
    // No source invoice → wouldHaveBeen* fields stay null.
    expect(result.wouldHaveBeenTaxableInPaise).toBeNull();
    expect(result.amountInPaise).toBe(15_000n);
    expect(result.kind).toBe('TIME_BARRED_CREDIT_NOTE');
    expect(result.idempotencyKey).toBe('TIME_BARRED_CREDIT_NOTE:ret-2');
    // Auto-approved + posted to wallet ledger.
    expect(wallet.creditAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        amountInPaise: 15_000,
        bypassBlock: true,
      }),
    );
    expect(result.status).toBe('APPROVED');
  });

  it('uses LEGACY_RECEIPT as sourceTaxDocument when no real invoice exists', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 1_000_000,
      autoApprove: true,
    });
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-leg',
      returnNumber: 'RET-2026-000201',
      customerId: 'u-1',
      subOrderId: 'sub-1',
      refundAmountInPaise: 20_000n,
      items: [{ qcQuantityApproved: 1, orderItemId: 'oi-1' }],
    });
    // First findFirst: no real invoice. Second findFirst: LEGACY_RECEIPT.
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'doc-legacy',
        documentNumber: 'SM-LR-000003',
        documentType: 'LEGACY_RECEIPT',
        status: 'GENERATED',
      });
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockImplementation(async (args: any) => ({
      id: 'adj-leg',
      status: 'PENDING_APPROVAL',
      walletTransactionId: null,
      ...args.data,
    }));
    wallet.creditAdjustment.mockResolvedValue({
      transaction: { id: 'tx-leg' },
    });
    prisma.walletAdjustment.update.mockImplementation(async (args: any) => ({
      id: 'adj-leg',
      status: 'APPROVED',
      walletTransactionId: 'tx-leg',
      sourceTaxDocumentId: 'doc-legacy',
      wouldHaveBeenTaxableInPaise: null,
      amountInPaise: 20_000n,
      kind: 'TIME_BARRED_CREDIT_NOTE',
      ...args.data,
    }));

    const result = await service.requestForTimeBarredReturn({
      returnId: 'ret-leg',
    });
    // sourceTaxDocumentId points at the LEGACY_RECEIPT, not null.
    expect(prisma.walletAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceTaxDocumentId: 'doc-legacy',
          // No GST snapshot because legacy receipts carry no GST claim.
          wouldHaveBeenTaxableInPaise: null,
          wouldHaveBeenCgstInPaise: null,
        }),
      }),
    );
    // Reason text identifies the legacy path.
    const reason = prisma.walletAdjustment.create.mock.calls[0][0].data.reason;
    expect(reason).toMatch(/Legacy order/);
    expect(reason).toMatch(/SM-LR-000003/);
    expect(result.status).toBe('APPROVED');
  });

  it('keeps TIME_BARRED adjustment PENDING when above dual-approval threshold', async () => {
    const { service, prisma, wallet } = makeService({
      threshold: 10_000,
      autoApprove: true,
    });
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-3',
      returnNumber: 'RET-2026-000101',
      customerId: 'u-1',
      subOrderId: 'sub-1',
      refundAmountInPaise: 50_000n,
      items: [{ qcQuantityApproved: 1, orderItemId: 'oi-1' }],
    });
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.walletAdjustment.findUnique.mockResolvedValue(null);
    prisma.walletAdjustment.create.mockImplementation(async (args: any) => ({
      id: 'adj-tb2',
      status: 'PENDING_APPROVAL',
      walletTransactionId: null,
      ...args.data,
    }));

    const result = await service.requestForTimeBarredReturn({
      returnId: 'ret-3',
    });
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(result.requiresDualApproval).toBe(true);
  });
});
