import 'reflect-metadata';
import { CustomerAbuseCounterService } from '../../src/modules/returns/application/services/customer-abuse-counter.service';

/**
 * Phase 5 (PR 5.5) — CustomerAbuseCounterService.
 *
 * The threshold logic is the trust boundary for the soft hold. A bug
 * here either lets repeat-abusers auto-approve every refund (false
 * negatives = stolen merchandise) or flags first-time-buyers (false
 * positives = customer-experience tax). Pin every branch.
 */
describe('CustomerAbuseCounterService', () => {
  type Counter = {
    customerId: string;
    requiresManualApproval: boolean;
    flagReason: string | null;
    returnsLast90d: number;
    ordersLast90d: number;
    returnRateBps: number | null;
  };

  function setup(opts: {
    orders: number;
    returns: number;
    disputes?: number;
    minReturns?: number;
    rateBps?: number;
    existing?: Counter | null;
  }) {
    const upserts: any[] = [];
    const fakePrisma: any = {
      customerAbuseCounter: {
        findUnique: jest.fn(async () => opts.existing ?? null),
        upsert: jest.fn(async ({ create, update, where }) => {
          const merged: any = { ...where, ...create, ...update };
          upserts.push(merged);
          return merged;
        }),
      },
      masterOrder: { count: jest.fn(async () => opts.orders) },
      return: { count: jest.fn(async () => opts.returns) },
      dispute: { count: jest.fn(async () => opts.disputes ?? 0) },
    };
    const fakeEnv: any = {
      getNumber: (key: string) => {
        if (key === 'CUSTOMER_ABUSE_MIN_RETURNS') return opts.minReturns ?? 0;
        if (key === 'CUSTOMER_ABUSE_RATE_THRESHOLD_BPS') return opts.rateBps ?? 0;
        return 0;
      },
    };
    return {
      svc: new CustomerAbuseCounterService(fakePrisma, fakeEnv),
      upserts,
      fakePrisma,
    };
  }

  it('shouldHoldForManualReview returns false when no row exists', async () => {
    const { svc } = setup({ orders: 0, returns: 0, existing: null });
    expect(await svc.shouldHoldForManualReview('c1')).toBe(false);
  });

  it('shouldHoldForManualReview reads requiresManualApproval from the row', async () => {
    const { svc } = setup({
      orders: 0,
      returns: 0,
      existing: {
        customerId: 'c1',
        requiresManualApproval: true,
        flagReason: 'test',
        returnsLast90d: 5,
        ordersLast90d: 10,
        returnRateBps: 5000,
      },
    });
    expect(await svc.shouldHoldForManualReview('c1')).toBe(true);
  });

  it('does not flag when both thresholds are zero (feature off)', async () => {
    const { svc, upserts } = setup({
      orders: 5,
      returns: 5,
      minReturns: 0,
      rateBps: 0,
    });
    await svc.recompute('c1');
    expect(upserts[0].requiresManualApproval).toBe(false);
    expect(upserts[0].returnRateBps).toBe(10_000);
  });

  it('flags when both thresholds are crossed (5 returns / 10 orders = 50%, threshold 30%)', async () => {
    const { svc, upserts } = setup({
      orders: 10,
      returns: 5,
      minReturns: 3,
      rateBps: 3000,
    });
    await svc.recompute('c1');
    expect(upserts[0].requiresManualApproval).toBe(true);
    expect(upserts[0].returnRateBps).toBe(5000);
    expect(upserts[0].flagReason).toContain('5 returns in 90d');
  });

  it('does not flag a brand-new customer below CUSTOMER_ABUSE_MIN_RETURNS', () => {
    // 1 return on 1 order = 100%, but only 1 return ⇒ below the floor.
    const cases = [
      {
        orders: 1,
        returns: 1,
        minReturns: 3,
        rateBps: 3000,
        expectFlag: false,
      },
      {
        orders: 2,
        returns: 2,
        minReturns: 3,
        rateBps: 3000,
        expectFlag: false,
      },
    ];
    return Promise.all(
      cases.map(async (c) => {
        const { svc, upserts } = setup(c);
        await svc.recompute('c1');
        expect(upserts[0].requiresManualApproval).toBe(c.expectFlag);
      }),
    );
  });

  it('returns null rate when ordersLast90d is zero', async () => {
    const { svc, upserts } = setup({
      orders: 0,
      returns: 0,
      minReturns: 3,
      rateBps: 3000,
    });
    await svc.recompute('c1');
    expect(upserts[0].returnRateBps).toBeNull();
    expect(upserts[0].requiresManualApproval).toBe(false);
  });

  it('does not flag when at-the-threshold (must exceed, not equal)', async () => {
    // 3 returns / 10 orders = 30%, threshold = 3000 bps (30%).
    const { svc, upserts } = setup({
      orders: 10,
      returns: 3,
      minReturns: 3,
      rateBps: 3000,
    });
    await svc.recompute('c1');
    expect(upserts[0].returnRateBps).toBe(3000);
    expect(upserts[0].requiresManualApproval).toBe(false);
  });
});
