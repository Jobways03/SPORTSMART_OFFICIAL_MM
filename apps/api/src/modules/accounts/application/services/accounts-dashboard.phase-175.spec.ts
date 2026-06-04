import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { AccountsDashboardService } from './accounts-dashboard.service';
import { AccountsDashboardController } from '../../presentation/controllers/accounts-dashboard.controller';
import { BadRequestAppException } from '../../../../core/exceptions';

// Phase 175 — Accounts Overview Dashboard audit remediation.

function makePrisma() {
  return {
    commissionRecord: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          totalPlatformAmount: new Prisma.Decimal('1000.50'),
          totalSettlementAmount: new Prisma.Decimal('900.00'),
          platformMargin: new Prisma.Decimal('100.50'),
          refundedAdminEarning: new Prisma.Decimal('25.25'),
          taxCommission: new Prisma.Decimal('18.00'),
          vatOnCommission: new Prisma.Decimal('0'),
        },
      }),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    franchiseFinanceLedger: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { platformEarning: new Prisma.Decimal('50.00'), franchiseEarning: new Prisma.Decimal('200.00') },
      }),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    sellerSettlement: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalSettlementAmount: new Prisma.Decimal('500.00') }, _count: { id: 3 } }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    franchiseSettlement: {
      count: jest.fn().mockResolvedValue(2),
      aggregate: jest.fn().mockResolvedValue({ _sum: { netPayableToFranchise: new Prisma.Decimal('300.00') }, _count: { id: 2 } }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    affiliateCommission: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { adjustedAmount: new Prisma.Decimal('77.77') } }),
    },
    chargeback: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: 123456n } }),
    },
  } as any;
}

describe('#3 money serialized as exact strings + #16/#10/#9/#8 new line items', () => {
  it('returns money as 2-decimal strings, currency, and the new aggregates', async () => {
    const repo = new PrismaAccountsRepository(makePrisma());
    const r = await repo.getPlatformFinanceSummary({
      fromDate: new Date('2026-05-01'),
      toDate: new Date('2026-05-31'),
    });
    expect(r.currency).toBe('INR');
    expect(r.totalPlatformRevenue).toBe('1000.50');
    expect(r.totalRefundedFromCommission).toBe('25.25'); // #9
    expect(r.netPlatformRevenue).toBe('975.25'); // #9 gross − refunds
    expect(r.totalTaxOnCommission).toBe('18.00'); // #8
    expect(r.totalAffiliateCommissionPaid).toBe('77.77'); // #16
    expect(r.chargebackExposure).toBe('1234.56'); // #10 — 123456 paise
    expect(typeof r.totalSettledToSellers).toBe('string');
    expect(r.linkSources.refundApprovalsUrl).toContain('refund-approvals'); // #14
  });
});

describe('#4 settlement aggregates honour the date filter consistently', () => {
  it('PAID aggregates filter by paidAt; PENDING by createdAt', async () => {
    const prisma = makePrisma();
    const repo = new PrismaAccountsRepository(prisma);
    const from = new Date('2026-05-01');
    const to = new Date('2026-05-31');
    await repo.getPlatformFinanceSummary({ fromDate: from, toDate: to });

    const calls = prisma.sellerSettlement.aggregate.mock.calls.map((c: any[]) => c[0]);
    const paidCall = calls.find((c: any) => c.where.status === 'PAID');
    const pendingCall = calls.find((c: any) => c.where.status === 'PENDING');
    expect(paidCall.where.paidAt).toEqual({ gte: from, lte: to }); // #4 — was unfiltered
    expect(pendingCall.where.createdAt).toEqual({ gte: from, lte: to });
  });
});

describe('#12 service TTL cache', () => {
  it('caches within TTL — repo called once for the same range', async () => {
    const repo: any = { getPlatformFinanceSummary: jest.fn().mockResolvedValue({ currency: 'INR' }) };
    const svc = new AccountsDashboardService(repo);
    await svc.getPlatformOverview(new Date('2026-05-01'), new Date('2026-05-31'));
    await svc.getPlatformOverview(new Date('2026-05-01'), new Date('2026-05-31'));
    expect(repo.getPlatformFinanceSummary).toHaveBeenCalledTimes(1);
  });

  it('a different range bypasses the cache', async () => {
    const repo: any = { getPlatformFinanceSummary: jest.fn().mockResolvedValue({ currency: 'INR' }) };
    const svc = new AccountsDashboardService(repo);
    await svc.getPlatformOverview(new Date('2026-05-01'), new Date('2026-05-31'));
    await svc.getPlatformOverview(new Date('2026-06-01'), new Date('2026-06-30'));
    expect(repo.getPlatformFinanceSummary).toHaveBeenCalledTimes(2);
  });
});

describe('#6/#17/#13 controller validation + boundary + audit', () => {
  function makeCtrl() {
    const service: any = {
      getPlatformOverview: jest.fn().mockResolvedValue({}),
      getSellerOverview: jest.fn().mockResolvedValue({}),
      getFranchiseOverview: jest.fn().mockResolvedValue({}),
      getOutstandingPayables: jest.fn().mockResolvedValue({}),
      getTopPerformers: jest.fn().mockResolvedValue({}),
    };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { ctrl: new AccountsDashboardController(service, audit), service, audit };
  }

  it('#6 rejects an invalid date with 400', async () => {
    const { ctrl } = makeCtrl();
    await expect(
      ctrl.getOverview({}, { fromDate: 'banana' } as any),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#17 treats a bare YYYY-MM-DD toDate as inclusive end-of-day', async () => {
    const { ctrl, service } = makeCtrl();
    await ctrl.getOverview({ adminId: 'a1' }, { fromDate: '2026-05-01', toDate: '2026-05-31' } as any);
    const toArg = service.getPlatformOverview.mock.calls[0][1] as Date;
    expect(toArg.toISOString()).toBe('2026-05-31T23:59:59.999Z');
  });

  it('rejects a range over the 366-day cap', async () => {
    const { ctrl } = makeCtrl();
    await expect(
      ctrl.getOverview({}, { fromDate: '2020-01-01', toDate: '2026-01-01' } as any),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#13 writes an accounts.overview.viewed audit row on read', async () => {
    const { ctrl, audit } = makeCtrl();
    await ctrl.getOverview({ adminId: 'a1', ip: '1.2.3.4', headers: {} }, {} as any);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accounts.overview.viewed', actorId: 'a1' }),
    );
  });
});
