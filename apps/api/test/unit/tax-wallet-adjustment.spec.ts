import 'reflect-metadata';
import { WalletAdjustmentService } from '../../src/modules/tax/application/services/wallet-adjustment.service';

// Phase 13 GST — WalletAdjustmentService tests.
//
// Unit-level: prisma + wallet facade are mocked. The DB-roundtrip
// behaviour (FK constraints, UNIQUE on idempotencyKey racing two
// concurrent posts) is exercised by Phase 27 integration tests.

interface MockPrisma {
  return: { findUnique: jest.Mock };
  taxDocument: { findFirst: jest.Mock };
  orderItemTaxSnapshot: { findMany: jest.Mock };
  orderItem: { findUnique: jest.Mock };
  walletAdjustment: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
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
  const prisma: MockPrisma = {
    return: { findUnique: jest.fn() },
    taxDocument: { findFirst: jest.fn() },
    orderItemTaxSnapshot: { findMany: jest.fn() },
    orderItem: { findUnique: jest.fn() },
    walletAdjustment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
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
  const service = new WalletAdjustmentService(
    prisma as any,
    env,
    wallet as any,
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
