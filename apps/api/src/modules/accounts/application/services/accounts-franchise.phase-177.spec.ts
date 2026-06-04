import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { AccountsDashboardService } from './accounts-dashboard.service';
import { FranchiseAccountsController } from '../../presentation/controllers/franchise-accounts.controller';
import { NotFoundAppException, BadRequestAppException, ConflictAppException } from '../../../../core/exceptions';

// Phase 177 — Per-Franchise Accounts Dashboard audit remediation.

const D = (s: string) => new Prisma.Decimal(s);

function makePrisma(exists = true) {
  return {
    franchisePartner: {
      findUnique: jest.fn().mockResolvedValue(
        exists
          ? { id: 'f1', franchiseCode: 'FR-001', businessName: 'Acme F', gstNumber: '29ABCDE1234F1Z5', panNumber: 'ABCDE1234F', status: 'ACTIVE', isDeleted: false, warehousePincode: '560001' }
          : null,
      ),
    },
    franchiseFinanceLedger: {
      aggregate: jest.fn().mockImplementation(({ where }: any) => {
        if (where.status === 'REVERSED') return Promise.resolve({ _sum: { baseAmount: D('30'), platformEarning: D('3') }, _count: { id: 1 } });
        if (where.sourceType === 'PROCUREMENT_FEE') return Promise.resolve({ _sum: { baseAmount: D('500'), platformEarning: D('50') }, _count: { id: 2 } });
        return Promise.resolve({ _sum: { baseAmount: D('1000'), platformEarning: D('100'), franchiseEarning: D('900') }, _count: { id: 5 } });
      }),
    },
    franchisePosSale: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: D('200'), grossAmount: D('250') }, _count: { id: 3 } }),
      count: jest.fn().mockResolvedValue(1), // voided
    },
    franchisePosReturn: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { refundAmount: D('20') }, _count: { id: 1 } }),
    },
    franchiseSettlementAdjustment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: D('25') }, _count: { id: 1 } }),
    },
    franchiseSettlement: {
      aggregate: jest.fn().mockImplementation(({ where }: any) =>
        where.status === 'PAID'
          ? Promise.resolve({ _count: { id: 1 }, _sum: { netPayableToFranchise: D('500') } })
          : Promise.resolve({ _count: { id: 2 }, _sum: { netPayableToFranchise: D('400') } }),
      ),
      findFirst: jest.fn().mockResolvedValue({ paidAt: new Date('2026-05-22T00:00:00Z') }),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      { status: 'OPEN', cnt: 2n },
      { status: 'RESOLVED', cnt: 4n },
    ]),
  } as any;
}

describe('#1/#5/#14 per-franchise overview bundle', () => {
  it('bundles online + POS (net of voids/returns) + procurement + payable + reversals + recon', async () => {
    const repo = new PrismaAccountsRepository(makePrisma());
    const r = await repo.getFranchiseAccountsOverview('f1', new Date('2026-05-01'), new Date('2026-05-31'));
    expect(r).not.toBeNull();
    expect(r!.currency).toBe('INR');
    expect(r!.franchise.pan).toMatch(/^•+234F$/); // PII masked
    expect(r!.revenue.onlineRevenue).toBe('1000.00');
    expect(r!.revenue.posNet).toBe('180.00'); // #14 — 200 net − 20 returns (voided excluded by query)
    expect(r!.revenue.totalRevenue).toBe('1180.00'); // online + posNet
    expect(r!.platformMargin.total).toBe('150.00'); // online 100 + procurement 50
    expect(r!.procurement.totalProcuredValue).toBe('500.00'); // #6
    expect(r!.payable.pendingAmount).toBe('400.00');
    expect(r!.payable.paidAmount).toBe('500.00'); // #12 — paidAt-scoped
    expect(r!.reversals.count).toBe(1);
    expect(r!.reversals.platformEarning).toBe('3.00');
    expect(r!.adjustments.count).toBe(1); // #4
    expect(r!.adjustments.totalAmount).toBe('25.00');
    expect(r!.pos.voidedCount).toBe(1);
    expect(r!.pos.returnCount).toBe(1);
    expect(r!.reconciliation.openDiscrepancies).toBe(2); // #13
    expect(r!.reconciliation.resolvedDiscrepancies).toBe(4);
  });

  it('POS aggregate excludes voided sales (voidedAt null filter)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaAccountsRepository(prisma);
    await repo.getFranchiseAccountsOverview('f1');
    const posAggCall = prisma.franchisePosSale.aggregate.mock.calls[0][0];
    expect(posAggCall.where.voidedAt).toBeNull(); // #14 — voids netted out
  });

  it('returns null for a missing/deleted franchise (service 404s)', async () => {
    const repo = new PrismaAccountsRepository(makePrisma(false));
    expect(await repo.getFranchiseAccountsOverview('nope')).toBeNull();
  });

  it('service maps a null repo result to a 404', async () => {
    const repo: any = { getFranchiseAccountsOverview: jest.fn().mockResolvedValue(null) };
    const svc = new AccountsDashboardService(repo);
    await expect(svc.getFranchiseAccountsOverview('nope')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('#7 getTopFranchises kills the N+1', () => {
  it('uses a bounded set of groupBys + 1 findMany (no per-row findUnique/count)', async () => {
    // Phase 179 — counts now come from the online/proc groupBys' _count; POS is
    // joined via franchisePosSale/Return groupBys. Query count is CONSTANT —
    // it does not scale with the number of franchises (N+1 stays dead).
    const prisma: any = {
      franchiseFinanceLedger: {
        groupBy: jest.fn()
          .mockResolvedValueOnce([ // ONLINE_ORDER
            { franchiseId: 'f1', _sum: { baseAmount: D('1000'), platformEarning: D('100') }, _count: { id: 7 } },
          ])
          .mockResolvedValueOnce([ // PROCUREMENT_FEE
            { franchiseId: 'f1', _sum: { platformEarning: D('30') }, _count: { id: 2 } },
          ]),
        // findUnique/count must NOT be called — they're absent, so a regression throws.
      },
      franchisePosSale: { groupBy: jest.fn().mockResolvedValue([]) },
      franchisePosReturn: { groupBy: jest.fn().mockResolvedValue([]) },
      franchisePartner: {
        findMany: jest.fn().mockResolvedValue([{ id: 'f1', businessName: 'Acme F' }]),
      },
    };
    const repo = new PrismaAccountsRepository(prisma);
    const rows = await repo.getTopFranchises(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.franchiseName).toBe('Acme F');
    expect(rows[0]!.totalOnlineOrders).toBe(7);
    expect(rows[0]!.totalProcurements).toBe(2);
    expect(rows[0]!.totalRevenue).toBe('1000.00'); // online only (no POS in this case)
    // bounded, constant query count — independent of franchise count.
    expect(prisma.franchiseFinanceLedger.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.franchisePosSale.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.franchisePosReturn.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.franchisePartner.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('#4 franchise self-view scopes to req.franchiseId', () => {
  function makeCtrl() {
    const service: any = {
      getFranchiseAccountsOverview: jest.fn().mockResolvedValue({ currency: 'INR' }),
      getFranchiseLedgerEntries: jest.fn().mockResolvedValue({}),
      getFranchisePosSales: jest.fn().mockResolvedValue({}),
      getFranchiseSettlementsList: jest.fn().mockResolvedValue({}),
    };
    return { ctrl: new FranchiseAccountsController(service), service };
  }

  it('passes the session franchiseId, never a param', async () => {
    const { ctrl, service } = makeCtrl();
    await ctrl.myOverview({ franchiseId: 'franchise-self' }, {} as any);
    expect(service.getFranchiseAccountsOverview).toHaveBeenCalledWith('franchise-self', undefined, undefined);
  });

  it('400s when there is no franchise session', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.myOverview({}, {} as any)).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('#4 franchise settlement adjustment', () => {
  it('creates the line item + shifts the net, PENDING-only with CAS', async () => {
    const tx = {
      franchiseSettlement: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', franchiseId: 'f1', status: 'PENDING' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      franchiseSettlementAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adj1' }) },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.createFranchiseSettlementAdjustment({
      settlementId: 's1', amount: '-150.00', adjustmentType: 'MANUAL_CORRECTION' as any, adminId: 'a1',
    });
    expect(r.id).toBe('adj1');
    expect(tx.franchiseSettlementAdjustment.create.mock.calls[0][0].data.amountInPaise).toBe(-15000n); // exact paise
    const upd = tx.franchiseSettlement.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 's1', status: 'PENDING' }); // CAS guard
    expect(upd.data.netPayableToFranchise.increment).toBeDefined();
    expect(upd.data.adjustmentAmount.increment).toBeDefined();
  });

  it('rejects adjusting a non-PENDING settlement (no row created)', async () => {
    const tx = {
      franchiseSettlement: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', franchiseId: 'f1', status: 'PAID' }),
        updateMany: jest.fn(),
      },
      franchiseSettlementAdjustment: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
    const repo = new PrismaAccountsRepository(prisma);
    await expect(
      repo.createFranchiseSettlementAdjustment({ settlementId: 's1', amount: '10.00', adjustmentType: 'GOODWILL' as any }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(tx.franchiseSettlementAdjustment.create).not.toHaveBeenCalled();
  });
});

describe('#10 reconciliation-discrepancies list', () => {
  it('lists discrepancies for the franchise (paise→string difference)', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]),
      reconciliationDiscrepancy: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', kind: 'AMOUNT_MISMATCH', status: 'OPEN', severity: 70, orderNumber: 'ORD-1', externalRef: null, differenceInPaise: 5000n, description: 'x', createdAt: new Date('2026-05-10T00:00:00Z') },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
    };
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.getFranchiseReconciliationDiscrepancies('f1', undefined, 1, 50);
    expect(r.total).toBe(2);
    expect(r.discrepancies[0]!.difference).toBe('50.00'); // 5000 paise
  });

  it('short-circuits to empty when no discrepancy ids match', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      reconciliationDiscrepancy: { findMany: jest.fn(), count: jest.fn() },
    };
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.getFranchiseReconciliationDiscrepancies('f1', undefined, 1, 50);
    expect(r.total).toBe(0);
    expect(prisma.reconciliationDiscrepancy.findMany).not.toHaveBeenCalled();
  });
});
