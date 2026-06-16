import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { AccountsDashboardService } from './accounts-dashboard.service';
import { AccountsDashboardController } from '../../presentation/controllers/accounts-dashboard.controller';
import { BadRequestAppException } from '../../../../core/exceptions';

const D = (v: string) => new Prisma.Decimal(v);

// Phase 179 — Top Performers Report audit remediation.

describe('#1/#3/#11/#16 getTopSellers', () => {
  function prismaFor(internalIds: string[] = []) {
    return {
      seller: { findMany: jest.fn().mockResolvedValue(internalIds.map((id) => ({ id }))) },
      commissionRecord: {
        groupBy: jest.fn().mockResolvedValue([
          {
            sellerId: 's1', sellerName: 'Acme',
            _sum: { totalPlatformAmount: D('1000'), platformMargin: D('100'), refundedAdminEarning: D('50') },
            _count: { subOrderId: 5 },
          },
        ]),
      },
    } as any;
  }

  it('MARGIN metric orders by platformMargin with a sellerId tie-break (#1/#11)', async () => {
    const prisma = prismaFor();
    const repo = new PrismaAccountsRepository(prisma);
    await repo.getTopSellers(10, undefined, undefined, 0, 'MARGIN');
    const call = prisma.commissionRecord.groupBy.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ _sum: { platformMargin: 'desc' } }, { sellerId: 'asc' }]);
  });

  it('REVENUE metric (default) orders by totalPlatformAmount with tie-break', async () => {
    const prisma = prismaFor();
    const repo = new PrismaAccountsRepository(prisma);
    await repo.getTopSellers(10);
    const call = prisma.commissionRecord.groupBy.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ _sum: { totalPlatformAmount: 'desc' } }, { sellerId: 'asc' }]);
  });

  it('excludes internal sellers and nets refunds; emits rank + marginPercentage (#16/#3)', async () => {
    const prisma = prismaFor(['demo-1']);
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.getTopSellers(10);
    expect(prisma.commissionRecord.groupBy.mock.calls[0][0].where.sellerId).toEqual({ notIn: ['demo-1'] });
    expect(r[0]!.rank).toBe(1);
    expect(r[0]!.totalRevenue).toBe('950.00'); // 1000 − 50 refund
    expect(r[0]!.marginPercentage).toBeCloseTo(10.53, 2); // 100 / 950 * 100
  });

  it('no internal sellers → no sellerId filter at all', async () => {
    const prisma = prismaFor([]);
    const repo = new PrismaAccountsRepository(prisma);
    await repo.getTopSellers(10);
    expect(prisma.commissionRecord.groupBy.mock.calls[0][0].where.sellerId).toBeUndefined();
  });
});

describe('#5/#6/#15 getTopFranchises', () => {
  function makePrisma() {
    return {
      franchiseFinanceLedger: {
        groupBy: jest.fn()
          .mockResolvedValueOnce([ // ONLINE_ORDER
            { franchiseId: 'f1', _sum: { baseAmount: D('1000'), platformEarning: D('100') }, _count: { id: 3 } },
          ])
          .mockResolvedValueOnce([ // PROCUREMENT_FEE
            { franchiseId: 'f1', _sum: { platformEarning: D('20') }, _count: { id: 2 } },
          ]),
      },
      franchisePosSale: {
        groupBy: jest.fn().mockResolvedValue([
          { franchiseId: 'f1', _sum: { netAmount: D('500') }, _count: { id: 4 } },
        ]),
      },
      franchisePosReturn: {
        groupBy: jest.fn().mockResolvedValue([
          { franchiseId: 'f1', _sum: { refundAmount: D('100') } },
        ]),
      },
      franchisePartner: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'f1', businessName: 'Store One' },
          { id: 'f2', businessName: 'Idle Store' }, // no activity → skipped
        ]),
      },
    } as any;
  }

  it('revenue = ONLINE base + POS net; margin = online + procurement; marginPercentage present (#6/#15)', async () => {
    const repo = new PrismaAccountsRepository(makePrisma());
    const r = await repo.getTopFranchises(10);
    expect(r).toHaveLength(1); // idle franchise dropped
    // revenue = 1000 + (500 − 100) = 1400; margin = 100 + 20 = 120
    expect(r[0]!.totalRevenue).toBe('1400.00');
    expect(r[0]!.platformEarning).toBe('120.00');
    expect(r[0]!.marginPercentage).toBeCloseTo(8.57, 2);
    expect(r[0]!.rank).toBe(1);
    expect(r[0]!.totalOnlineOrders).toBe(3);
    expect(r[0]!.totalProcurements).toBe(2);
  });

  it('only non-internal franchises are eligible (#16)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaAccountsRepository(prisma);
    await repo.getTopFranchises(10);
    expect(prisma.franchisePartner.findMany.mock.calls[0][0].where).toEqual({ isInternal: false });
  });

  // two franchises: f1 higher revenue, f2 higher margin.
  function twoFranchisePrisma() {
    return {
      franchiseFinanceLedger: {
        // online (call 1), procurement (call 2 — empty)
        groupBy: jest.fn()
          .mockResolvedValueOnce([
            { franchiseId: 'f1', _sum: { baseAmount: D('2000'), platformEarning: D('50') }, _count: { id: 1 } },
            { franchiseId: 'f2', _sum: { baseAmount: D('500'), platformEarning: D('300') }, _count: { id: 1 } },
          ])
          .mockResolvedValueOnce([]),
      },
      franchisePosSale: { groupBy: jest.fn().mockResolvedValue([]) },
      franchisePosReturn: { groupBy: jest.fn().mockResolvedValue([]) },
      franchisePartner: { findMany: jest.fn().mockResolvedValue([{ id: 'f1', businessName: 'A' }, { id: 'f2', businessName: 'B' }]) },
    } as any;
  }

  it('MARGIN metric ranks by platform earning', async () => {
    const byMargin = await new PrismaAccountsRepository(twoFranchisePrisma())
      .getTopFranchises(10, undefined, undefined, 0, 'MARGIN');
    expect(byMargin.map((x) => x.franchiseId)).toEqual(['f2', 'f1']); // f2 wins on margin
  });

  it('REVENUE metric ranks by total revenue', async () => {
    const byRevenue = await new PrismaAccountsRepository(twoFranchisePrisma())
      .getTopFranchises(10, undefined, undefined, 0, 'REVENUE');
    expect(byRevenue.map((x) => x.franchiseId)).toEqual(['f1', 'f2']); // f1 wins on revenue
  });
});

describe('#14 service node-type scoping', () => {
  function makeRepo() {
    return {
      getTopSellers: jest.fn().mockResolvedValue([{ rank: 1, sellerId: 's1' }]),
      getTopFranchises: jest.fn().mockResolvedValue([{ rank: 1, franchiseId: 'f1' }]),
    } as any;
  }

  it('nodeType=SELLER skips the franchise query', async () => {
    const repo = makeRepo();
    const svc = new AccountsDashboardService(repo);
    const r = await svc.getTopPerformers(10, undefined, undefined, 1, 'REVENUE', 'SELLER');
    expect(repo.getTopSellers).toHaveBeenCalledTimes(1);
    expect(repo.getTopFranchises).not.toHaveBeenCalled();
    expect(r.topFranchises).toEqual([]);
    expect(r.metric).toBe('REVENUE');
    expect(r.revenueBasis.sellers).toContain('Commission base');
    expect(r.methodology).toContain('NOT attributed per node');
  });

  it('nodeType=ALL (default) runs both', async () => {
    const repo = makeRepo();
    const svc = new AccountsDashboardService(repo);
    await svc.getTopPerformers(10, undefined, undefined, 1, 'MARGIN', 'ALL');
    expect(repo.getTopSellers).toHaveBeenCalledTimes(1);
    expect(repo.getTopFranchises).toHaveBeenCalledTimes(1);
    // metric threads through to both repo calls.
    expect(repo.getTopSellers.mock.calls[0][4]).toBe('MARGIN');
    expect(repo.getTopFranchises.mock.calls[0][4]).toBe('MARGIN');
  });

  // Isolation fix (2026-06-16) — the seller-type scope must thread to the repo
  // AND be part of the cache key, else a scoped admin and an unrestricted admin
  // would share a cached leaderboard (cross-type leak).
  it('threads allowedSellerTypes (7th arg) to getTopSellers', async () => {
    const repo = makeRepo();
    const svc = new AccountsDashboardService(repo);
    await svc.getTopPerformers(10, undefined, undefined, 1, 'REVENUE', 'SELLER', ['D2C']);
    expect(repo.getTopSellers.mock.calls[0][5]).toEqual(['D2C']);
  });

  it('does NOT serve a different scope from the same cache entry', async () => {
    const repo = makeRepo();
    const svc = new AccountsDashboardService(repo);
    // Same (limit, range, page, metric, nodeType) but different scope → two
    // distinct cache keys → two repo calls (no cross-scope contamination).
    await svc.getTopPerformers(10, undefined, undefined, 1, 'REVENUE', 'SELLER', ['D2C']);
    await svc.getTopPerformers(10, undefined, undefined, 1, 'REVENUE', 'SELLER', ['RETAIL']);
    expect(repo.getTopSellers).toHaveBeenCalledTimes(2);
    expect(repo.getTopSellers.mock.calls[0][5]).toEqual(['D2C']);
    expect(repo.getTopSellers.mock.calls[1][5]).toEqual(['RETAIL']);
    // Sanity: an identical scope IS served from cache (no third call).
    await svc.getTopPerformers(10, undefined, undefined, 1, 'REVENUE', 'SELLER', ['D2C']);
    expect(repo.getTopSellers).toHaveBeenCalledTimes(2);
  });
});

describe('#1/#14 controller metric/nodeType validation', () => {
  function makeController() {
    const svc: any = { getTopPerformers: jest.fn().mockResolvedValue({ topSellers: [], topFranchises: [] }) };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { ctrl: new AccountsDashboardController(svc, audit), svc };
  }

  it('rejects an unknown metric (400)', async () => {
    const { ctrl } = makeController();
    await expect(
      ctrl.getTopPerformers({}, '10', '1', undefined, undefined, 'BOGUS'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects an unknown nodeType (400)', async () => {
    const { ctrl } = makeController();
    await expect(
      ctrl.getTopPerformers({}, '10', '1', undefined, undefined, 'REVENUE', 'WRONG'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('normalises valid lower-case values and passes them through', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.getTopPerformers({}, '10', '1', undefined, undefined, 'margin', 'seller');
    // Isolation fix (2026-06-16) — the controller now also passes the admin's
    // seller-type scope (7th arg). The mock req has no permissions, so
    // resolveScopedTypes → null (unrestricted).
    expect(svc.getTopPerformers).toHaveBeenCalledWith(10, undefined, undefined, 1, 'MARGIN', 'SELLER', null);
  });
});
