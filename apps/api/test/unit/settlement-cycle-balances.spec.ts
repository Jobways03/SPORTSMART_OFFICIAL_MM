// Phase 149 — settlement cycle balances are now a TRUE outstanding-balance
// ledger: opening = unpaid prior carried forward, closing = opening + cycle net
// − cycle paid. Single query per party type (no N+1), filtered by the cycle's
// period (not row createdAt), includes franchise, and surfaces the breakdown.

import { SettlementService } from '../../src/modules/settlements/settlement.service';
import { NotFoundAppException } from '../../src/core/exceptions';

const PERIOD_START = new Date('2026-05-01T00:00:00Z');

function build(opts: {
  sellers?: any[];
  franchises?: any[];
  priorSellers?: any[];
  priorFranchises?: any[];
} = {}) {
  const sellerFindMany = jest.fn().mockResolvedValue(opts.priorSellers ?? []);
  const franchiseFindMany = jest.fn().mockResolvedValue(opts.priorFranchises ?? []);
  const prisma = {
    settlementCycle: {
      findUnique: jest.fn().mockResolvedValue(
        opts.sellers === undefined && opts.franchises === undefined
          ? null
          : {
              id: 'cyc1',
              periodStart: PERIOD_START,
              sellerSettlements: opts.sellers ?? [],
              franchiseSettlements: opts.franchises ?? [],
            },
      ),
    },
    sellerSettlement: { findMany: sellerFindMany },
    franchiseSettlement: { findMany: franchiseFindMany },
  };
  const svc = new SettlementService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { applyToCycleOnApprove: jest.fn().mockResolvedValue(undefined) } as any, // commissionInvoice
    {
      getSettlementTaxConfig: jest.fn().mockResolvedValue({
        gst: { rateBps: 1800, baseType: 'COMMISSION', enabled: true },
        tcs: { rateBps: 100, baseType: 'TAXABLE_SUPPLY', enabled: true },
        tds: { rateBps: 100, baseType: 'COMMISSION', enabled: false },
      }),
    } as any, // Phase 252 — taxConfig (7th ctor arg)
  );
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, sellerFindMany, franchiseFindMany };
}

const seller = (over: any = {}) => ({
  sellerId: 's1',
  status: 'APPROVED',
  totalSettlementAmountInPaise: 5_000_000n, // ₹50,000 net
  approvedSettlementAmountInPaise: 5_000_000n,
  seller: { sellerShopName: 'Shop' },
  ...over,
});

describe('SettlementService.computeOpeningClosingBalance (Phase 149)', () => {
  it('first-ever cycle: opening 0, closing = cycle net', async () => {
    const { svc } = build({ sellers: [seller()] });
    const [row] = await svc.computeOpeningClosingBalance('cyc1');
    expect(row!.openingBalanceInPaise).toBe('0');
    expect(row!.closingBalanceInPaise).toBe('5000000');
  });

  it('carries forward UNPAID prior settlements into opening', async () => {
    const { svc } = build({
      sellers: [seller()],
      priorSellers: [{ sellerId: 's1', totalSettlementAmountInPaise: 10_000_000n }], // ₹1L unpaid prior
    });
    const [row] = await svc.computeOpeningClosingBalance('cyc1');
    expect(row!.openingBalanceInPaise).toBe('10000000');
    // opening 1L + this cycle 50k − paid 0 = 1.5L outstanding
    expect(row!.closingBalanceInPaise).toBe('15000000');
  });

  it('a PAID current cycle nets to its opening (paid = net, not outstanding)', async () => {
    const { svc } = build({
      sellers: [seller({ status: 'PAID' })],
      priorSellers: [{ sellerId: 's1', totalSettlementAmountInPaise: 2_000_000n }],
    });
    const [row] = await svc.computeOpeningClosingBalance('cyc1');
    expect(row!.cyclePaidInPaise).toBe('5000000');
    // opening 20k + net 50k − paid 50k = 20k (only the prior remains outstanding)
    expect(row!.closingBalanceInPaise).toBe('2000000');
  });

  it('splits cycle net into earnings + adjustments', async () => {
    const { svc } = build({
      sellers: [
        seller({
          totalSettlementAmountInPaise: 4_500_000n, // net (after a -₹5k adjustment)
          approvedSettlementAmountInPaise: 5_000_000n, // approved gross
        }),
      ],
    });
    const [row] = await svc.computeOpeningClosingBalance('cyc1');
    expect(row!.cycleEarningsInPaise).toBe('5000000');
    expect(row!.cycleAdjustmentsInPaise).toBe('-500000');
    expect(row!.cycleAmountInPaise).toBe('4500000');
  });

  it('queries prior outstanding ONCE (no N+1) filtered by cycle period, excluding PAID/CANCELLED', async () => {
    const { svc, sellerFindMany } = build({
      sellers: [seller({ sellerId: 's1' }), seller({ sellerId: 's2' })],
    });
    await svc.computeOpeningClosingBalance('cyc1');
    expect(sellerFindMany).toHaveBeenCalledTimes(1); // not once-per-seller
    const where = sellerFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ['PAID', 'CANCELLED'] });
    expect(where.cycle).toEqual({ periodStart: { lt: PERIOD_START } });
    expect(where.createdAt).toBeUndefined(); // no longer the createdAt filter
  });

  it('includes franchise rows (net from Decimal)', async () => {
    const { svc } = build({
      sellers: [],
      franchises: [
        {
          franchiseId: 'f1',
          status: 'APPROVED',
          netPayableToFranchise: '500.00',
          franchise: { businessName: 'Franchise A' },
        },
      ],
    });
    const rows = await svc.computeOpeningClosingBalance('cyc1');
    const f = rows.find((r) => r.settlementType === 'FRANCHISE');
    expect(f).toBeDefined();
    expect(f!.cycleAmountInPaise).toBe('50000'); // ₹500 → 50000 paise
    expect(f!.sellerName).toBe('Franchise A');
  });

  it('404s on a missing cycle', async () => {
    const { svc } = build({});
    await expect(svc.computeOpeningClosingBalance('missing')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});
