/**
 * Coverage for the franchise settlement-cycle dry-run preview. The numbers it
 * returns must match what createSettlementCycle would write, and it must be
 * fully read-only (no cycle / claim / settlement writes).
 */
import 'reflect-metadata';
import { FranchiseSettlementService } from './franchise-settlement.service';

const PERIOD_START = new Date('2026-06-01T00:00:00Z');
const PERIOD_END = new Date('2026-06-19T00:00:00Z');

const ONLINE_ROW = {
  id: 'fl-1',
  franchiseId: 'fr-1',
  sourceType: 'ONLINE_ORDER',
  baseAmount: 2499,
  platformEarning: 374.85,
  franchiseEarning: 2124.15,
  status: 'PENDING',
  createdAt: new Date('2026-06-19T07:57:06Z'),
  franchise: { id: 'fr-1', businessName: 'Demo1', franchiseCode: 'D1' },
};

function build(rows: any[] = [ONLINE_ROW]) {
  let readWhere: any = null;
  const prisma: any = {
    settlementCycle: { findMany: jest.fn().mockResolvedValue([]) },
    franchiseSettlement: { count: jest.fn().mockResolvedValue(0) },
    franchiseFinanceLedger: {
      findMany: jest.fn(async ({ where }: any) => {
        readWhere = where;
        return rows;
      }),
    },
    discountLiabilityLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }),
    },
  };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
  const service = new FranchiseSettlementService(
    {} as any,
    {} as any,
    {} as any,
    logger,
    prisma,
    {} as any,
    {} as any,
  );
  return { service, prisma, getReadWhere: () => readWhere };
}

describe('FranchiseSettlementService.previewSettlementCycle', () => {
  it('computes the per-franchise net read-only over the whole end day', async () => {
    const ctx = build();

    const res: any = await ctx.service.previewSettlementCycle(PERIOD_START, PERIOD_END);

    expect(res.isDryRun).toBe(true);
    expect(res.franchiseCount).toBe(1);
    expect(res.entryCount).toBe(1);
    expect(res.totalNetPayable).toBe('2124.15');
    expect(res.franchiseBreakdown).toHaveLength(1);
    expect(res.franchiseBreakdown[0]).toMatchObject({
      franchiseName: 'Demo1',
      franchiseCode: 'D1',
      entryCount: 1,
      grossFranchiseEarning: '2124.15',
      netPayableToFranchise: '2124.15',
    });
    expect(res.overlap).toBeNull();

    // End-of-day window: exclusive next-day upper bound (same as create).
    expect(ctx.getReadWhere().createdAt.lt).toEqual(new Date('2026-06-20T00:00:00Z'));
    expect(ctx.getReadWhere().status).toBe('PENDING');

    // Read-only: the preview never touches a write method (none are even mocked).
    expect(ctx.prisma.franchiseFinanceLedger.updateMany).toBeUndefined();
    expect(ctx.prisma.franchiseSettlement.create).toBeUndefined();
    expect(ctx.prisma.settlementCycle.create).toBeUndefined();
  });

  it('reports zero when nothing is pending in the window', async () => {
    const ctx = build([]);

    const res: any = await ctx.service.previewSettlementCycle(PERIOD_START, PERIOD_END);

    expect(res.franchiseCount).toBe(0);
    expect(res.entryCount).toBe(0);
    expect(res.totalNetPayable).toBe('0.00');
    expect(res.franchiseBreakdown).toEqual([]);
  });
});
