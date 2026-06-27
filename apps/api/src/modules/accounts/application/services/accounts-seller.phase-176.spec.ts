import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { AccountsDashboardService } from './accounts-dashboard.service';
import { SellerAccountsController } from '../../presentation/controllers/seller-accounts.controller';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';

// Phase 176 — Per-Seller Accounts Dashboard audit remediation.

function makePrisma(sellerExists = true) {
  return {
    seller: {
      findUnique: jest.fn().mockResolvedValue(
        sellerExists
          ? { id: 's1', sellerName: 'Acme', gstin: '29ABCDE1234F1Z5', panNumber: 'ABCDE1234F', status: 'ACTIVE', isDeleted: false }
          : null,
      ),
    },
    commissionRecord: {
      aggregate: jest.fn().mockImplementation(({ where }: any) => {
        if (where.status === 'REFUNDED') {
          return Promise.resolve({ _sum: { refundedAdminEarning: new Prisma.Decimal('50.00') }, _count: { id: 3 } });
        }
        return Promise.resolve({
          _sum: {
            totalPlatformAmount: new Prisma.Decimal('1000.00'),
            platformMargin: new Prisma.Decimal('100.00'),
            totalSettlementAmount: new Prisma.Decimal('900.00'),
            refundedAdminEarning: new Prisma.Decimal('50.00'),
            taxCommission: new Prisma.Decimal('18.00'),
            vatOnCommission: new Prisma.Decimal('0'),
          },
          _count: { id: 10 },
        });
      }),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'SETTLED', _count: { id: 7 }, _sum: { totalPlatformAmount: new Prisma.Decimal('700') } },
        { status: 'REFUNDED', _count: { id: 3 }, _sum: { totalPlatformAmount: new Prisma.Decimal('300') } },
      ]),
      count: jest.fn().mockResolvedValue(0),
    },
    sellerSettlement: {
      // Phase 252 fix — paid/pending NETs are computed PER ROW from the
      // AUTHORITATIVE decimal gross (not a paise-sibling _sum). aggregate() is
      // now only the overdue indicator; findFirst() is lastPaid.
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        where.status === 'PAID'
          ? Promise.resolve([
              { totalSettlementAmount: new Prisma.Decimal('500.00'), tcsDeductedInPaise: 0n, tdsDeductedInPaise: 0n, totalCommissionGstInPaise: 0n },
            ])
          : Promise.resolve([
              { totalSettlementAmount: new Prisma.Decimal('250.00'), tcsDeductedInPaise: 0n, tdsDeductedInPaise: 0n, totalCommissionGstInPaise: 0n },
              { totalSettlementAmount: new Prisma.Decimal('150.00'), tcsDeductedInPaise: 0n, tdsDeductedInPaise: 0n, totalCommissionGstInPaise: 0n },
            ]),
      ),
      aggregate: jest.fn().mockResolvedValue({ _count: { id: 0 }, _sum: { totalSettlementAmount: new Prisma.Decimal('0') } }),
      findFirst: jest.fn().mockResolvedValue({ paidAt: new Date('2026-05-20T00:00:00Z') }),
    },
    section194OTdsLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { tdsInPaise: 12345n }, _count: { id: 2 } }),
      count: jest.fn().mockResolvedValue(1),
    },
    gstTcsSettlementLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalTcsInPaise: 6789n }, _count: { id: 1 } }),
    },
    settlementAdjustment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal('25.00') }, _count: { id: 1 } }),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      { status: 'OPEN', cnt: 2n },
      { status: 'RESOLVED', cnt: 5n },
    ]),
  } as any;
}

describe('#1/#8/#9/#10 per-seller overview bundle', () => {
  it('bundles revenue/margin/payable/tax/reversals/reconciliation as exact strings', async () => {
    const repo = new PrismaAccountsRepository(makePrisma());
    const r = await repo.getSellerAccountsOverview('s1', new Date('2026-05-01'), new Date('2026-05-31'));
    expect(r).not.toBeNull();
    expect(r!.currency).toBe('INR');
    expect(r!.seller.pan).toMatch(/^•+234F$/); // PII masked to last 4
    expect(r!.revenue.gross).toBe('1000.00');
    expect(r!.revenue.net).toBe('950.00'); // #9 — less refunds
    expect(r!.revenue.taxExcluded).toBe('18.00'); // #8
    expect(r!.margin.platformMargin).toBe('100.00');
    expect(r!.payable.pendingAmount).toBe('400.00');
    expect(r!.payable.paidAmount).toBe('500.00'); // #7 — paidAt-scoped
    expect(r!.taxDeductions.tdsDeducted).toBe('123.45'); // #8 — 12345 paise
    expect(r!.taxDeductions.tcsCollected).toBe('67.89');
    expect(r!.taxDeductions.tdsDepositedCount).toBe(1);
    expect(r!.reversals.count).toBe(3); // #9
    expect(r!.adjustments.totalAmount).toBe('25.00'); // #9
    expect(r!.reconciliation.openDiscrepancies).toBe(2); // #10 (OPEN)
    expect(r!.reconciliation.resolvedDiscrepancies).toBe(5);
    expect(r!.commission.statusBreakdown.SETTLED).toBe(7);
  });

  it('#7 — paidAmount nets from the DECIMAL gross + clamps ≥0 (the −₹175.43 regression)', async () => {
    const prisma = makePrisma();
    // A PAID settlement whose paise gross sibling is 0 (MONEY_DUAL_WRITE off /
    // legacy row) BUT with populated TCS + commission-GST deductions. The old
    // _sum aggregate netted 0 − 38.14 − 137.29 = −₹175.43 (the live bug). The
    // per-row fix derives gross from the decimal (3737.29) → ₹3,561.86.
    prisma.sellerSettlement.findMany.mockImplementation(({ where }: any) =>
      where.status === 'PAID'
        ? Promise.resolve([
            {
              totalSettlementAmount: new Prisma.Decimal('3737.29'),
              tcsDeductedInPaise: 3814n, // ₹38.14
              tdsDeductedInPaise: 0n,
              totalCommissionGstInPaise: 13729n, // ₹137.29
            },
          ])
        : Promise.resolve([]),
    );
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.getSellerAccountsOverview('s1');
    expect(r!.payable.paidAmount).toBe('3561.86'); // not the buggy −175.43
    expect(r!.payable.pendingAmount).toBe('0.00');
  });

  it('#13 — returns null for a missing/deleted seller (service 404s)', async () => {
    const repo = new PrismaAccountsRepository(makePrisma(false));
    expect(await repo.getSellerAccountsOverview('nope')).toBeNull();
  });

  it('service maps a null repo result to a 404', async () => {
    const repo: any = { getSellerAccountsOverview: jest.fn().mockResolvedValue(null) };
    const svc = new AccountsDashboardService(repo);
    await expect(svc.getSellerAccountsOverview('nope')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('#6 getTopSellers nets out refunds', () => {
  it('ranked revenue = totalPlatformAmount − refundedAdminEarning', async () => {
    const prisma: any = {
      // Phase 179 (#16) — getTopSellers first looks up internal sellers to exclude.
      seller: { findMany: jest.fn().mockResolvedValue([]) },
      commissionRecord: {
        groupBy: jest.fn().mockResolvedValue([
          {
            sellerId: 's1',
            sellerName: 'Acme',
            _sum: {
              totalPlatformAmount: new Prisma.Decimal('1000.00'),
              platformMargin: new Prisma.Decimal('100.00'),
              refundedAdminEarning: new Prisma.Decimal('200.00'),
            },
            _count: { subOrderId: 5 },
          },
        ]),
      },
    };
    const repo = new PrismaAccountsRepository(prisma);
    const rows = await repo.getTopSellers(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalRevenue).toBe('800.00'); // 1000 − 200
  });
});

describe('#4 seller self-view scopes to req.sellerId', () => {
  function makeCtrl() {
    const service: any = {
      getSellerAccountsOverview: jest.fn().mockResolvedValue({ currency: 'INR' }),
      getSellerCommissionRecords: jest.fn().mockResolvedValue({}),
      getSellerSettlements: jest.fn().mockResolvedValue({}),
    };
    return { ctrl: new SellerAccountsController(service), service };
  }

  it('passes the session sellerId, never a param', async () => {
    const { ctrl, service } = makeCtrl();
    await ctrl.myOverview({ sellerId: 'seller-self' }, {} as any);
    expect(service.getSellerAccountsOverview).toHaveBeenCalledWith('seller-self', undefined, undefined);
  });

  it('400s when there is no seller session', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.myOverview({}, {} as any)).rejects.toBeInstanceOf(BadRequestAppException);
  });
});
