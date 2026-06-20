/**
 * Regression for two bugs in the franchise settlement-cycle create path:
 *
 *  1. End-of-day window: the candidate read must include PENDING ledger
 *     entries created at ANY time on the periodEnd day. `new Date('2026-06-19')`
 *     parses to that day's 00:00, so the old `createdAt: { lte: periodEnd }`
 *     dropped every entry after midnight (e.g. a commission locked at 07:57) —
 *     the cycle then claimed nothing and looked like a silent no-op.
 *
 *  2. FK violation (P2003 → "A referenced record does not exist"): the claim
 *     stamped `settlement_batch_id` with the CYCLE id, but that column FKs to
 *     franchise_settlements(id). The fix reads up-front, then claims each
 *     franchise's rows with the REAL settlement id once the settlement exists.
 *
 * Mirrors the table-level Prisma mock used by the discount-liability spec.
 */
import 'reflect-metadata';
import { FranchiseSettlementService } from './franchise-settlement.service';

const PERIOD_START = new Date('2026-06-01T00:00:00Z');
// Admin picked 2026-06-19; the date input parses to that day's midnight.
const PERIOD_END = new Date('2026-06-19T00:00:00Z');

// A franchise commission locked at 07:57 ON the end day — must be in range.
const ON_END_DAY_ROW = {
  id: 'fl-1',
  franchiseId: 'fr-1',
  sourceType: 'ONLINE_ORDER',
  baseAmount: 2499,
  platformEarning: 374.85,
  franchiseEarning: 2124.15,
  status: 'PENDING',
  createdAt: new Date('2026-06-19T07:57:06Z'),
  franchise: { id: 'fr-1', businessName: 'Demo1', franchiseCode: 'D1', gstStateCode: null },
};

function buildService() {
  let readWhere: any = null;
  let claimWhere: any = null;
  let claimData: any = null;

  const tx: any = {
    settlementCycle: {
      findMany: jest.fn().mockResolvedValue([]), // no overlap
      findFirst: jest.fn().mockResolvedValue(null), // no existing cycle
      create: jest.fn().mockResolvedValue({
        id: 'cyc-1',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        status: 'DRAFT',
      }),
    },
    franchiseSettlement: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ id: 'set-1', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    franchiseFinanceLedger: {
      // The candidate READ carries the date window.
      findMany: jest.fn(async ({ where }: any) => {
        readWhere = where;
        return [ON_END_DAY_ROW];
      }),
      // The per-franchise CLAIM stamps the real settlement id under a
      // status=PENDING guard; capture it to assert it is NOT a cycle id.
      updateMany: jest.fn(async ({ where, data }: any) => {
        claimWhere = where;
        claimData = data;
        return { count: 1 };
      }),
    },
    discountLiabilityLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }),
    },
    platformGstProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    settlementChargeRule: { findMany: jest.fn().mockResolvedValue([]) },
    franchiseSettlementChargeLine: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    discountLiabilityLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }),
    },
  };

  const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
  const tdsHook: any = {
    applyToFranchiseSettlementOnApprove: jest
      .fn()
      .mockResolvedValue({ stamped: false, skipped: true, tdsInPaise: 0n }),
    markWithheldOnPayFranchise: jest.fn().mockResolvedValue({ ledgerId: null, flipped: false }),
  };
  const tcsHook: any = {
    applyToFranchiseSettlementOnApprove: jest
      .fn()
      .mockResolvedValue({ stamped: false, skipped: true, tcsInPaise: 0n }),
    markCollectedOnPayFranchise: jest.fn().mockResolvedValue({ ledgerId: null, flipped: false }),
  };

  const service = new FranchiseSettlementService(
    {} as any, // financeRepo
    { findById: jest.fn() } as any, // franchiseRepo
    { publish: jest.fn().mockResolvedValue(undefined) } as any, // eventBus
    logger,
    prisma,
    tdsHook,
    tcsHook,
  );
  return {
    service,
    getReadWhere: () => readWhere,
    getClaimWhere: () => claimWhere,
    getClaimData: () => claimData,
  };
}

describe('FranchiseSettlementService.createSettlementCycle — window + claim FK', () => {
  it('reads the whole end day and claims with the settlement id (never the cycle id)', async () => {
    const ctx = buildService();

    const res: any = await ctx.service.createSettlementCycle(PERIOD_START, PERIOD_END);

    // (1) The candidate read covers the whole end day: exclusive next-day upper
    //     bound, no inclusive-midnight `lte`.
    const read = ctx.getReadWhere();
    expect(read.createdAt.lt).toEqual(new Date('2026-06-20T00:00:00Z'));
    expect(read.createdAt.lte).toBeUndefined();
    expect(read.createdAt.gte).toEqual(PERIOD_START);

    // (2) The claim stamps the REAL settlement id (a valid FK), not the cycle
    //     id, and is guarded on status = PENDING.
    expect(ctx.getClaimData().settlementBatchId).toBe('set-1');
    expect(ctx.getClaimData().settlementBatchId).not.toBe('cyc-1');
    expect(ctx.getClaimWhere().status).toBe('PENDING');

    // The on-end-day entry produced a real settlement (not an empty cycle).
    expect(res.empty).toBeFalsy();
    expect(res.settlements).toHaveLength(1);
  });
});
