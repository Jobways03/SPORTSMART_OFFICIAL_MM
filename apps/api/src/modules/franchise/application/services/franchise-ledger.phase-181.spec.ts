import { Prisma } from '@prisma/client';
import { PrismaFranchiseFinanceRepository } from '../../infrastructure/repositories/prisma-franchise-finance.repository';
import { AdminFranchiseFinanceController } from '../../presentation/controllers/admin-franchise-finance.controller';
import { FranchiseCommissionService } from './franchise-commission.service';
import { BadRequestAppException, ConflictAppException } from '../../../../core/exceptions';

function makeSvc(financeRepo: any, prisma: any) {
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return new FranchiseCommissionService(financeRepo, eventBus, logger, prisma);
}

// Phase 181 — Franchise Ledger audit remediation (running-balance double-entry).

function makeRepo(opts: { prevBalance?: bigint; existing?: any; currentStatus?: string } = {}) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    // Phase 181 switched the per-franchise advisory lock to $executeRaw
    // (pg_advisory_xact_lock returns SQL `void`, which $queryRaw can't
    // deserialize under Prisma 6.19+). The tx mock must expose it or runCore
    // throws "tx.$executeRaw is not a function". Returns a row count (unused).
    $executeRaw: jest.fn().mockResolvedValue(1),
    franchisePartner: {
      findUnique: jest.fn().mockResolvedValue({ ledgerBalanceInPaise: opts.prevBalance ?? 0n }),
      update: jest.fn().mockResolvedValue({}),
    },
    franchiseFinanceLedger: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'e1', ...data })),
      findUnique: jest.fn().mockResolvedValue(opts.currentStatus ? { status: opts.currentStatus } : null),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'e1', ...data })),
    },
    franchiseLedgerStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    franchiseFinanceLedger: { findUnique: jest.fn().mockResolvedValue(opts.existing ?? null) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  return { repo: new PrismaFranchiseFinanceRepository(prisma), prisma, tx };
}

describe('#1/#2/#3 createLedgerEntry — positive debit/credit + running balance', () => {
  it('ONLINE_ORDER earning → positive CREDIT, advances balance, derives idempotency key', async () => {
    const { repo, tx } = makeRepo({ prevBalance: 0n });
    await repo.createLedgerEntry({ franchiseId: 'f1', sourceType: 'ONLINE_ORDER', sourceId: 'so1', baseAmount: 1000, rate: 10, computedAmount: 100, platformEarning: 100, franchiseEarning: 900 });
    const data = tx.franchiseFinanceLedger.create.mock.calls[0][0].data;
    expect(data.creditInPaise).toBe(90000n);
    expect(data.debitInPaise).toBe(0n);
    expect(data.balanceAfterInPaise).toBe(90000n);
    expect(data.idempotencyKey).toBe('ONLINE_ORDER:so1');
    expect(tx.franchisePartner.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { ledgerBalanceInPaise: 90000n } });
  });

  it('RETURN_REVERSAL (negative earning) → positive DEBIT, lowers balance (no negatives stored)', async () => {
    const { repo, tx } = makeRepo({ prevBalance: 90000n });
    await repo.createLedgerEntry({ franchiseId: 'f1', sourceType: 'RETURN_REVERSAL', sourceId: 'so1', baseAmount: -500, rate: 0, computedAmount: 0, platformEarning: 0, franchiseEarning: -500 });
    const data = tx.franchiseFinanceLedger.create.mock.calls[0][0].data;
    expect(data.debitInPaise).toBe(50000n); // positive
    expect(data.creditInPaise).toBe(0n);
    expect(data.balanceAfterInPaise).toBe(40000n); // 90000 − 50000
  });

  it('PROCUREMENT_FEE → DEBIT from computedAmount even though franchiseEarning is 0', async () => {
    const { repo, tx } = makeRepo({ prevBalance: 10000n });
    await repo.createLedgerEntry({ franchiseId: 'f1', sourceType: 'PROCUREMENT_FEE', sourceId: 'p1', baseAmount: 1000, rate: 5, computedAmount: 50, platformEarning: 50, franchiseEarning: 0 });
    const data = tx.franchiseFinanceLedger.create.mock.calls[0][0].data;
    expect(data.debitInPaise).toBe(5000n);
    expect(data.creditInPaise).toBe(0n);
    expect(data.balanceAfterInPaise).toBe(5000n); // 10000 − 5000
  });
});

describe('#4/#8 idempotency', () => {
  it('a re-emitted event returns the existing row (fast path, no insert)', async () => {
    const { repo, tx } = makeRepo({ existing: { id: 'dup', sourceId: 'p1' } });
    const r = await repo.createLedgerEntry({ franchiseId: 'f1', sourceType: 'PROCUREMENT_FEE', sourceId: 'p1', baseAmount: 1000, rate: 5, computedAmount: 50, platformEarning: 50, franchiseEarning: 0 });
    expect(r.id).toBe('dup');
    expect(tx.franchiseFinanceLedger.create).not.toHaveBeenCalled();
  });
  it('ADJUSTMENT is NOT auto-keyed (legitimately repeats)', async () => {
    const { repo, tx } = makeRepo();
    await repo.createLedgerEntry({ franchiseId: 'f1', sourceType: 'ADJUSTMENT', sourceId: 'ADJ-x', baseAmount: 100, rate: 0, computedAmount: 100, platformEarning: 0, franchiseEarning: 100, createdByAdminId: 'admin9', createdBySystem: false });
    const data = tx.franchiseFinanceLedger.create.mock.calls[0][0].data;
    expect(data.idempotencyKey).toBeNull();
    expect(data.createdByAdminId).toBe('admin9'); // #5
    expect(data.createdBySystem).toBe(false);
    expect(data.creditInPaise).toBe(10000n);
  });
});

describe('#14 updateLedgerEntryStatus — history + CAS', () => {
  it('appends a status-history row on a real transition', async () => {
    const { repo, tx } = makeRepo({ currentStatus: 'PENDING' });
    await repo.updateLedgerEntryStatus('e1', 'REVERSED', undefined, { actorAdminId: 'a1', reason: 'return' });
    expect(tx.franchiseLedgerStatusHistory.create).toHaveBeenCalledTimes(1);
    const h = tx.franchiseLedgerStatusHistory.create.mock.calls[0][0].data;
    expect(h.fromStatus).toBe('PENDING');
    expect(h.toStatus).toBe('REVERSED');
    expect(h.actorAdminId).toBe('a1');
  });
  it('is a no-op when already at the target status (no history row)', async () => {
    const { repo, tx } = makeRepo({ currentStatus: 'REVERSED' });
    await repo.updateLedgerEntryStatus('e1', 'REVERSED');
    expect(tx.franchiseLedgerStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.franchiseFinanceLedger.update).not.toHaveBeenCalled();
  });
});

describe('#11 controller penalty threshold → async approval', () => {
  function makeCtrl() {
    const svc: any = {
      createPenalty: jest.fn().mockResolvedValue({ id: 'p1', balanceAfterInPaise: 0n }),
      requestPenaltyApproval: jest.fn().mockResolvedValue({ id: 'ap1', status: 'PENDING' }),
    };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const env: any = { getNumber: jest.fn().mockReturnValue(50000) };
    return { ctrl: new AdminFranchiseFinanceController(svc, audit, env), svc };
  }
  const req = (adminId: string) => ({ adminId, headers: {} } as any);

  it('a high-value penalty is submitted for approval, NOT posted directly', async () => {
    const { ctrl, svc } = makeCtrl();
    const r: any = await ctrl.createPenalty(req('a1'), 'f1', { amount: 60000, reason: 'damage' } as any);
    expect(svc.requestPenaltyApproval).toHaveBeenCalled();
    expect(svc.createPenalty).not.toHaveBeenCalled();
    expect(r.requiresApproval).toBe(true);
  });
  it('a sub-threshold penalty posts directly', async () => {
    const { ctrl, svc } = makeCtrl();
    await ctrl.createPenalty(req('a1'), 'f1', { amount: 100, reason: 'late' } as any);
    expect(svc.createPenalty).toHaveBeenCalled();
    expect(svc.requestPenaltyApproval).not.toHaveBeenCalled();
  });
});

describe('void-PENDING posts a balance-neutralising compensating entry', () => {
  it('reverses the original credit (positive debit) + flips, atomically + idempotently', async () => {
    const tx: any = {};
    const financeRepo: any = {
      findLedgerEntryBySource: jest.fn().mockResolvedValue({ id: 'orig1', status: 'PENDING', creditInPaise: 90000n, debitInPaise: 0n, baseAmount: 900, computedAmount: 100, platformEarning: 100, franchiseEarning: 900 }),
      createLedgerEntry: jest.fn().mockResolvedValue({ id: 'rev1' }),
      updateLedgerEntryStatus: jest.fn().mockResolvedValue({ id: 'orig1', status: 'REVERSED' }),
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    await makeSvc(financeRepo, prisma).recordPosVoid({ franchiseId: 'f1', saleId: 's1' });
    const arg = financeRepo.createLedgerEntry.mock.calls[0][0];
    expect(arg.sourceType).toBe('POS_SALE_REVERSAL');
    expect(arg.debitInPaise).toBe(90000n); // cancels the original credit
    expect(arg.creditInPaise).toBe(0n);
    expect(arg.franchiseEarning).toBe(0); // legacy-aggregator-neutral
    expect(arg.idempotencyKey).toBe('POS_VOID:s1');
    expect(arg.tx).toBe(tx);
    expect(financeRepo.updateLedgerEntryStatus).toHaveBeenCalledWith('orig1', 'REVERSED', undefined, expect.objectContaining({ tx }));
  });
});

describe('#11 penalty two-person approval flow', () => {
  const D = (v: string) => new Prisma.Decimal(v);

  it('requestPenaltyApproval creates a PENDING request (no ledger entry)', async () => {
    const financeRepo: any = { createLedgerEntry: jest.fn() };
    const prisma: any = { franchisePenaltyApproval: { create: jest.fn().mockResolvedValue({ id: 'ap1', status: 'PENDING' }) } };
    const r = await makeSvc(financeRepo, prisma).requestPenaltyApproval({ franchiseId: 'f1', amount: 60000, reason: 'damage', requestedByAdminId: 'a1' });
    expect(r.status).toBe('PENDING');
    expect(financeRepo.createLedgerEntry).not.toHaveBeenCalled();
  });

  it('approvePenalty posts the penalty + flips APPROVED (distinct approver)', async () => {
    const tx: any = { franchisePenaltyApproval: { findUnique: jest.fn().mockResolvedValue({ id: 'ap1', status: 'PENDING', requestedByAdminId: 'a1', franchiseId: 'f1', amount: D('60000'), reason: 'damage' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const financeRepo: any = { createLedgerEntry: jest.fn().mockResolvedValue({ id: 'pen-e1' }) };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const r = await makeSvc(financeRepo, prisma).approvePenalty({ approvalId: 'ap1', approverAdminId: 'a2' });
    const arg = financeRepo.createLedgerEntry.mock.calls[0][0];
    expect(arg.sourceType).toBe('PENALTY');
    expect(arg.franchiseEarning).toBe(-60000);
    expect(arg.idempotencyKey).toBe('PENALTY_APPROVAL:ap1');
    expect(tx.franchisePenaltyApproval.updateMany).toHaveBeenCalled();
    expect(r.ledgerEntryId).toBe('pen-e1');
  });

  it('approvePenalty rejects when approver == requester', async () => {
    const tx: any = { franchisePenaltyApproval: { findUnique: jest.fn().mockResolvedValue({ id: 'ap1', status: 'PENDING', requestedByAdminId: 'a1', franchiseId: 'f1', amount: D('60000'), reason: 'x' }), updateMany: jest.fn() } };
    const financeRepo: any = { createLedgerEntry: jest.fn() };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    await expect(makeSvc(financeRepo, prisma).approvePenalty({ approvalId: 'ap1', approverAdminId: 'a1' })).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('approvePenalty rejects an already-decided request', async () => {
    const tx: any = { franchisePenaltyApproval: { findUnique: jest.fn().mockResolvedValue({ id: 'ap1', status: 'APPROVED', requestedByAdminId: 'a1' }), updateMany: jest.fn() } };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    await expect(makeSvc({ createLedgerEntry: jest.fn() }, prisma).approvePenalty({ approvalId: 'ap1', approverAdminId: 'a2' })).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejectPenalty CAS-rejects a pending request', async () => {
    const prisma: any = { franchisePenaltyApproval: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn().mockResolvedValue({ id: 'ap1', status: 'REJECTED', franchiseId: 'f1' }) } };
    const r = await makeSvc({}, prisma).rejectPenalty({ approvalId: 'ap1', approverAdminId: 'a2', reason: 'unfair' });
    expect((r as any).status).toBe('REJECTED');
    expect(prisma.franchisePenaltyApproval.updateMany).toHaveBeenCalled();
  });
});
