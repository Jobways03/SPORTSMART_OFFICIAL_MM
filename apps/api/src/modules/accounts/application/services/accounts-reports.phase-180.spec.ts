import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { AccountsReportsService } from './accounts-reports.service';
import { AccountsReportsController } from '../../presentation/controllers/accounts-reports.controller';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { BadRequestException } from '@nestjs/common';

const D = (v: string) => new Prisma.Decimal(v);
const PERIOD = new Date('2026-05-01T00:00:00Z');

// Phase 180 — Revenue / Margin / Payouts reports audit remediation.

describe('#1 CSV formula-injection guard (already hardened — regression lock)', () => {
  it('prefixes a formula cell with a single quote', () => {
    expect(escapeCsvField('=cmd|"calc"!A1')).toBe('"\'=cmd|""calc""!A1"');
    expect(escapeCsvField('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvField('@foo')).toBe("'@foo");
  });
  it('leaves plain numbers and text untouched', () => {
    expect(escapeCsvField('-100.50')).toBe('-100.50'); // negative number, not a formula
    expect(escapeCsvField('Acme Traders')).toBe('Acme Traders');
  });
});

describe('#3/#4/#10/#11 getRevenueBreakdown', () => {
  it('merges revenue/split/margin/refund; nets refunds; strings; commission margin', async () => {
    const prisma: any = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ period: PERIOD, total_revenue: D('1000') }]) // revenue (status-filtered, no fan-out)
        .mockResolvedValueOnce([ // seller/franchise split
          { period: PERIOD, node: 'SELLER', amount: D('600') },
          { period: PERIOD, node: 'FRANCHISE', amount: D('300') },
        ])
        .mockResolvedValueOnce([{ period: PERIOD, margin: D('120') }]) // commission margin (#4)
        .mockResolvedValueOnce([{ period: PERIOD, refunded: 5000n }]), // refunds paise (₹50) (#11)
    };
    const repo = new PrismaAccountsRepository(prisma);
    const rows = await repo.getRevenueBreakdown({ fromDate: new Date('2026-05-01'), toDate: new Date('2026-05-31'), groupBy: 'day' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      totalRevenue: '1000.00',
      refunds: '50.00',
      netRevenue: '950.00', // 1000 − 50
      sellerFulfilledAmount: '600.00',
      franchiseFulfilledAmount: '300.00',
      platformCommissionMargin: '120.00', // #4 — NOT the residual 1000-600-300=100
    });
    // the revenue query excludes dead order statuses (#3) — assert the SQL text.
    const revenueSql = JSON.stringify(prisma.$queryRaw.mock.calls[0][0]);
    expect(revenueSql).toContain('CANCELLED');
    expect(revenueSql).toContain('REJECTED');
  });
});

describe('#5/#12/#15 getPlatformMarginReport', () => {
  function makePrisma() {
    return {
      commissionRecord: {
        groupBy: jest.fn().mockResolvedValue([
          { sellerId: 's1', sellerName: 'Acme', _count: { id: 5 }, _sum: { totalPlatformAmount: D('1000'), totalSettlementAmount: D('800'), platformMargin: D('200'), refundedAdminEarning: D('50') } },
        ]),
      },
      franchiseFinanceLedger: { groupBy: jest.fn().mockResolvedValue([]) },
      franchisePartner: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }
  const svc = (prisma: any) => new AccountsReportsService({} as any, prisma);

  it('nets refunds out of seller revenue AND margin; money is strings (#12/#10)', async () => {
    const r = await svc(makePrisma()).getPlatformMarginReport(new Date('2026-05-01'), new Date('2026-05-31'));
    const s = r.sellers[0]!;
    expect(s.totalRevenue).toBe('950.00'); // 1000 − 50
    expect(s.platformMargin).toBe('150.00'); // 200 − 50
    expect(s.marginPercentage).toBeCloseTo(15.79, 2); // 150/950
  });

  it('dateBasis=settled filters via the commission→settlement relation (#5)', async () => {
    const prisma = makePrisma();
    await svc(prisma).getPlatformMarginReport(new Date('2026-05-01'), new Date('2026-05-31'), { dateBasis: 'settled' });
    const where = prisma.commissionRecord.groupBy.mock.calls[0][0].where;
    expect(where.sellerSettlement).toBeDefined();
    expect(where.sellerSettlement.is.status).toBe('PAID');
  });

  it('nodeType=SELLER skips the franchise queries (#15)', async () => {
    const prisma = makePrisma();
    await svc(prisma).getPlatformMarginReport(new Date('2026-05-01'), new Date('2026-05-31'), { nodeType: 'SELLER' });
    expect(prisma.commissionRecord.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.franchiseFinanceLedger.groupBy).not.toHaveBeenCalled();
  });
});

describe('#6/#13/#14 getPayoutReport', () => {
  function makePrisma(opts: { sellerStatus?: string } = {}) {
    return {
      sellerSettlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ss1', sellerId: 's1', sellerName: 'Acme', status: opts.sellerStatus ?? 'PAID',
            totalSettlementAmountInPaise: 100000n, tcsDeductedInPaise: 2000n,
            tdsDeductedInPaise: 1000n, totalCommissionGstInPaise: 18000n,
            paidAmountInPaise: 50000n, totalPlatformMargin: D('120'),
            paidAt: new Date('2026-05-10T00:00:00Z'), updatedAt: new Date('2026-05-10T00:00:00Z'), utrReference: 'UTR1',
            cycle: { id: 'c1', periodStart: new Date('2026-05-01'), periodEnd: new Date('2026-05-07') },
          },
        ]),
      },
      franchiseSettlement: { findMany: jest.fn().mockResolvedValue([]) },
      affiliatePayoutRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ap1', affiliateId: 'a1', grossAmount: D('600'), tdsAmount: D('100'), netAmount: D('500'), paidAt: new Date('2026-05-12'), transactionRef: 'AFTX', affiliate: { firstName: 'Riya', lastName: 'K' } },
        ]),
      },
    } as any;
  }
  const svc = (prisma: any) => new AccountsReportsService({} as any, prisma);

  it('seller netAmountPaid = gross − TCS − TDS − commission-GST (#6)', async () => {
    const r = await svc(makePrisma()).getPayoutReport(new Date('2026-05-01'), new Date('2026-05-31'));
    const s = r.sellerPayouts[0]!;
    expect(s.grossAmount).toBe('1000.00');
    expect(s.netAmountPaid).toBe('790.00'); // 100000 − 2000 − 1000 − 18000 = 79000 paise
    expect(s.tcsDeducted).toBe('20.00');
  });

  it('PARTIALLY_PAID shows the disbursed-so-far amount (#13)', async () => {
    const r = await svc(makePrisma({ sellerStatus: 'PARTIALLY_PAID' })).getPayoutReport(new Date('2026-05-01'), new Date('2026-05-31'));
    const s = r.sellerPayouts[0]!;
    expect(s.status).toBe('PARTIALLY_PAID');
    expect(s.netAmountPaid).toBe('500.00'); // paidAmountInPaise 50000
  });

  it('includes affiliate payouts net of §194 TDS (#14)', async () => {
    const r = await svc(makePrisma()).getPayoutReport(new Date('2026-05-01'), new Date('2026-05-31'));
    expect(r.affiliatePayouts).toHaveLength(1);
    expect(r.affiliatePayouts[0]!.netAmountPaid).toBe('500.00');
    expect(r.affiliatePayouts[0]!.nodeName).toBe('Riya K');
    expect(r.summary.totalAffiliatePayouts).toBe('500.00');
  });

  it('nodeType=SELLER skips franchise + affiliate (#15)', async () => {
    const prisma = makePrisma();
    await svc(prisma).getPayoutReport(new Date('2026-05-01'), new Date('2026-05-31'), { nodeType: 'SELLER' });
    expect(prisma.franchiseSettlement.findMany).not.toHaveBeenCalled();
    expect(prisma.affiliatePayoutRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('#8/#20 getReconciliationReport', () => {
  function makePrisma(opts: { orphans?: number; settledMargin?: string; paidMargin?: string } = {}) {
    const agg = (sum: any, count = 0) => jest.fn().mockResolvedValue({ _sum: sum, _count: { id: count } });
    return {
      commissionRecord: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { totalPlatformAmount: D('1000') }, _count: { id: 10 } }) // revenue
          .mockResolvedValueOnce({ _sum: { platformMargin: D('200'), refundedAdminEarning: D('20') } }) // margin
          .mockResolvedValueOnce({ _sum: { totalSettlementAmount: D('300') }, _count: { id: 3 } }) // pending
          .mockResolvedValueOnce({ _sum: { platformMargin: D(opts.settledMargin ?? '150') } }), // settled-commission margin (#20 A)
        count: jest.fn().mockResolvedValue(opts.orphans ?? 0), // orphaned settled (#20 B)
      },
      sellerSettlement: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { totalSettlementAmount: D('500') }, _count: { id: 5 } }) // settled
          .mockResolvedValueOnce({ _sum: { totalPlatformMargin: D(opts.paidMargin ?? '150') } }), // paid-settlement margin (#20 A)
      },
      franchiseFinanceLedger: {
        aggregate: agg({ baseAmount: D('800'), platformEarning: D('80'), franchiseEarning: D('700') }),
        count: jest.fn().mockResolvedValue(4),
      },
      franchiseSettlement: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { netPayableToFranchise: D('100') }, _count: { id: 1 } }) // pending
          .mockResolvedValueOnce({ _sum: { netPayableToFranchise: D('200') }, _count: { id: 2 } }), // settled
      },
    } as any;
  }
  const svc = (prisma: any) => new AccountsReportsService({} as any, prisma);

  it('reconciles when margins match and no orphans; money is strings', async () => {
    const r = await svc(makePrisma()).getReconciliationReport(new Date('2026-05-01'), new Date('2026-05-31'));
    expect(r.isReconciled).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.seller.totalPlatformMargin).toBe('180.00'); // 200 − 20 refund
    expect(r.period.fromDate).toBe(new Date('2026-05-01').toISOString());
  });

  it('flags a real margin divergence + orphaned settled commissions (#20)', async () => {
    const r = await svc(makePrisma({ orphans: 2, settledMargin: '150', paidMargin: '130' })).getReconciliationReport();
    expect(r.isReconciled).toBe(false);
    expect(r.mismatches.join(' ')).toContain('≠ paid-settlement margin');
    expect(r.mismatches.join(' ')).toContain('2 commission record');
  });
});

describe('#16/#5/#15 controller validation', () => {
  function makeController() {
    const reports: any = {
      getRevenueBreakdown: jest.fn().mockResolvedValue([]),
      getPlatformMarginReport: jest.fn().mockResolvedValue({ sellers: [], franchises: [], dateBasis: 'created' }),
      getPayoutReport: jest.fn().mockResolvedValue({ sellerPayouts: [], franchisePayouts: [], affiliatePayouts: [] }),
      getReconciliationReport: jest.fn().mockResolvedValue({}),
    };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { ctrl: new AccountsReportsController(reports, audit), reports };
  }

  it('rejects an unknown dateBasis (400)', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.getMargins({}, '2026-05-01', '2026-05-31', 'weird')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown nodeType (400)', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.getMargins({}, '2026-05-01', '2026-05-31', 'created', 'BOGUS')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires fromDate + toDate on revenue', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.getRevenueBreakdown({}, '', '2026-05-31')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes AFFILIATE nodeType through on payouts but not margins', async () => {
    const { ctrl, reports } = makeController();
    await ctrl.getPayouts({}, '2026-05-01', '2026-05-31', 'affiliate');
    expect(reports.getPayoutReport.mock.calls[0][2].nodeType).toBe('AFFILIATE');
    await expect(ctrl.getMargins({}, '2026-05-01', '2026-05-31', 'created', 'affiliate')).rejects.toBeInstanceOf(BadRequestException);
  });
});
