import 'reflect-metadata';
import {
  WalletAdjustmentService,
  WalletAdjustmentNotApprovableError,
  WALLET_ADJUSTMENT_EVENTS,
  SYSTEM_AUTO_APPROVE,
} from '../../src/modules/tax/application/services/wallet-adjustment.service';

// Phase 162 — Wallet Adjustments approval flow audit remediation coverage.
//   #1/#11 audit + history on approve
//   #4  auto-approve posts under SYSTEM_AUTO_APPROVE (not null / requester)
//   #5  lifecycle events emitted
//   #6  customer notification on approve
//   #8  reject CAS (lost race → NotApprovable)
//   #12 reverse posts inverse entry + REVERSED + audit/history/event
//   #3  over-bound amount audits + throws
//   #14 BigInt-safe rupee formatting in the ledger description

function makeHarness(opts: any = {}) {
  let stored: any = opts.row ?? null;
  const walletAdjustment = {
    findUnique: jest.fn(async () => (stored ? { ...stored } : null)),
    create: jest.fn(async ({ data }: any) => {
      stored = { id: 'adj-new', status: 'PENDING_APPROVAL', ...data };
      return { ...stored };
    }),
    update: jest.fn(async ({ data }: any) => {
      stored = { ...stored, ...data };
      return { ...stored };
    }),
    updateMany: jest.fn(async ({ data }: any) => {
      if (opts.casCount === 0) return { count: 0 };
      stored = { ...stored, ...data };
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn(async () => ({ ...stored })),
  };
  const walletAdjustmentHistory = { create: jest.fn(async () => ({})) };
  const prisma: any = {
    walletAdjustment,
    walletAdjustmentHistory,
    return: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    platformExpense: { create: jest.fn().mockResolvedValue({}) },
    admin: { findUnique: jest.fn().mockResolvedValue({ role: 'SELLER_ADMIN' }) },
    adminRoleAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    taxDocument: { findFirst: jest.fn() },
    orderItemTaxSnapshot: { findMany: jest.fn() },
    orderItem: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };
  const wallet: any = {
    creditAdjustment: jest.fn(async () => ({ transaction: { id: 'tx-credit' } })),
    debitAdjustment: jest.fn(async () => ({ transaction: { id: 'tx-debit' } })),
  };
  const env: any = {
    getNumber: (_k: string, fb: number) => opts.threshold ?? fb,
    getBoolean: (_k: string, fb: boolean) => opts.autoApprove ?? fb,
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const notifications: any = { sendNotification: jest.fn().mockResolvedValue(undefined) };
  const svc = new WalletAdjustmentService(prisma, env, wallet, audit, eventBus, notifications);
  return { svc, prisma, walletAdjustment, walletAdjustmentHistory, wallet, audit, eventBus, notifications };
}

function approvedCreditRow(over: any = {}) {
  return {
    id: 'adj-1',
    customerId: 'u-1',
    kind: 'GOODWILL',
    amountInPaise: 100_000n, // ₹1,000.00
    status: 'PENDING_APPROVAL',
    requiresDualApproval: false,
    requestedByAdminId: 'admin-req',
    idempotencyKey: 'GOODWILL:k',
    reason: 'goodwill credit',
    returnId: null,
    ...over,
  };
}

describe('approve — audit/history/event/notify (Phase 162)', () => {
  it('#1/#5/#6/#11: writes audit + history(APPROVED) + event + customer notification', async () => {
    const { svc, walletAdjustmentHistory, audit, eventBus, notifications, wallet } = makeHarness({
      row: approvedCreditRow(),
    });
    await svc.approve({ adjustmentId: 'adj-1', approvedByAdminId: 'admin-2' });
    expect(walletAdjustmentHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPROVED', toStatus: 'APPROVED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: WALLET_ADJUSTMENT_EVENTS.APPROVED }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: WALLET_ADJUSTMENT_EVENTS.APPROVED }),
    );
    expect(notifications.sendNotification).toHaveBeenCalled();
    // #14 — BigInt-safe rupee string in the ledger description.
    expect(wallet.creditAdjustment.mock.calls[0]![0].description).toContain('₹1000.00');
  });

  it('#14: negative (debit) amount formats without float drift', async () => {
    const { svc, wallet } = makeHarness({
      row: approvedCreditRow({ kind: 'MANUAL_DEBIT', amountInPaise: -250_55n }),
    });
    await svc.approve({ adjustmentId: 'adj-1', approvedByAdminId: 'admin-2' });
    expect(wallet.debitAdjustment.mock.calls[0]![0].description).toContain('₹250.55');
  });
});

describe('auto-approve sentinel (Phase 162 #4)', () => {
  it('posts under SYSTEM_AUTO_APPROVE, never null / requester', async () => {
    const { svc, walletAdjustment, walletAdjustmentHistory } = makeHarness({
      threshold: 500_000,
      autoApprove: true,
    });
    walletAdjustment.findUnique.mockResolvedValue(null); // no idempotent existing
    await svc.requestGoodwill({
      customerId: 'u-1',
      amountInPaise: 10_000,
      reason: 'small goodwill',
      requestedByAdminId: 'admin-req',
    });
    const approveUpdate = walletAdjustment.update.mock.calls.find(
      (c: any) => c[0].data.status === 'APPROVED',
    );
    expect(approveUpdate![0].data.approvedByAdminId).toBe(SYSTEM_AUTO_APPROVE);
    expect(
      walletAdjustmentHistory.create.mock.calls.some(
        (c: any) => c[0].data.action === 'AUTO_APPROVED',
      ),
    ).toBe(true);
  });
});

describe('reject CAS (Phase 162 #8)', () => {
  it('lost race (CAS count 0, fresh APPROVED) → NotApprovable', async () => {
    const { svc } = makeHarness({
      row: approvedCreditRow({ status: 'PENDING_APPROVAL' }),
      casCount: 0,
    });
    // findUniqueOrThrow (the re-read) returns the stored row; force it APPROVED.
    const h = makeHarness({ row: approvedCreditRow({ status: 'PENDING_APPROVAL' }), casCount: 0 });
    h.walletAdjustment.findUniqueOrThrow.mockResolvedValue(approvedCreditRow({ status: 'APPROVED' }));
    await expect(
      h.svc.reject({ adjustmentId: 'adj-1', rejectedByAdminId: 'a', rejectionReason: 'dup reason' }),
    ).rejects.toBeInstanceOf(WalletAdjustmentNotApprovableError);
    void svc;
  });

  it('CAS count 1 → REJECTED + history + audit + event', async () => {
    const { svc, walletAdjustmentHistory, audit, eventBus } = makeHarness({
      row: approvedCreditRow({ status: 'PENDING_APPROVAL' }),
    });
    await svc.reject({ adjustmentId: 'adj-1', rejectedByAdminId: 'a', rejectionReason: 'duplicate' });
    expect(walletAdjustmentHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REJECTED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: WALLET_ADJUSTMENT_EVENTS.REJECTED }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: WALLET_ADJUSTMENT_EVENTS.REJECTED }),
    );
  });
});

describe('reverse (Phase 162 #12)', () => {
  it('posts an inverse ledger entry + REVERSED + history + audit + event', async () => {
    const { svc, wallet, walletAdjustment, walletAdjustmentHistory, audit, eventBus } = makeHarness({
      row: approvedCreditRow({ status: 'APPROVED', walletTransactionId: 'tx-orig' }),
    });
    const res = await svc.reverse({
      adjustmentId: 'adj-1',
      reversedByAdminId: 'admin-9',
      reason: 'mistaken credit — reversing',
    });
    // A +credit is reversed by a debit.
    expect(wallet.debitAdjustment).toHaveBeenCalledTimes(1);
    expect(wallet.debitAdjustment.mock.calls[0]![0].adjustmentId).toBe('adj-1:reverse');
    expect(res.status).toBe('REVERSED');
    expect(walletAdjustment.update.mock.calls[0]![0].data.reversingTransactionId).toBe('tx-debit');
    expect(walletAdjustmentHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REVERSED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: WALLET_ADJUSTMENT_EVENTS.REVERSED }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: WALLET_ADJUSTMENT_EVENTS.REVERSED }),
    );
  });

  it('idempotent on already-REVERSED', async () => {
    const { svc, wallet } = makeHarness({ row: approvedCreditRow({ status: 'REVERSED' }) });
    const res = await svc.reverse({ adjustmentId: 'adj-1', reversedByAdminId: 'a', reason: 'already done' });
    expect(res.status).toBe('REVERSED');
    expect(wallet.debitAdjustment).not.toHaveBeenCalled();
    expect(wallet.creditAdjustment).not.toHaveBeenCalled();
  });

  it('rejects reversing a non-APPROVED row', async () => {
    const { svc } = makeHarness({ row: approvedCreditRow({ status: 'PENDING_APPROVAL' }) });
    await expect(
      svc.reverse({ adjustmentId: 'adj-1', reversedByAdminId: 'a', reason: 'cannot reverse pending' }),
    ).rejects.toBeInstanceOf(WalletAdjustmentNotApprovableError);
  });

  it('requires a reason (min 8)', async () => {
    const { svc } = makeHarness({ row: approvedCreditRow({ status: 'APPROVED', walletTransactionId: 'x' }) });
    await expect(
      svc.reverse({ adjustmentId: 'adj-1', reversedByAdminId: 'a', reason: 'no' }),
    ).rejects.toThrow(/reason/i);
  });
});

describe('amount boundary (Phase 162 #3)', () => {
  it('over-MAX_SAFE_INTEGER amount audits + throws (no silent truncation)', async () => {
    const { svc, audit } = makeHarness({
      row: approvedCreditRow({ amountInPaise: 9_007_199_254_740_993n }), // > 2^53-1
    });
    await expect(
      svc.approve({ adjustmentId: 'adj-1', approvedByAdminId: 'admin-2' }),
    ).rejects.toThrow(/MAX_SAFE_INTEGER/);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.adjustment.amount_overflow' }),
    );
  });
});
