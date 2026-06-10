import 'reflect-metadata';
import { FranchiseSettlementService } from '../../src/modules/franchise/application/services/franchise-settlement.service';
import { BadRequestAppException } from '../../src/core/exceptions';

/**
 * Phase 159v — Franchise Earnings + Settlement hardening.
 *
 * Covers the three CRITICAL arithmetic/atomicity findings:
 *  - B4: ADJUSTMENT sign — a +bonus must INCREASE net, a −penalty DECREASE it.
 *  - B5: RETURN_REVERSAL must reduce the payout exactly ONCE (not twice).
 *  - B3/#16: markSettlementPaid must flip status + settle the ledger atomically
 *    via a compare-and-swap, so a concurrent second pay can't double-pay.
 *  - #13: an overlapping period that already produced settlements is rejected.
 */

type Captured = { data: any } | null;

function buildCreateService(entries: any[]) {
  let created: Captured = null;
  const tx: any = {
    settlementCycle: {
      findMany: jest.fn().mockResolvedValue([]), // #13: no overlap
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'cycle-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
      }),
    },
    franchiseSettlement: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async (args: any) => {
        created = { data: args.data };
        return { id: 'settle-1', ...args.data };
      }),
    },
    franchiseFinanceLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: entries.length }),
      findMany: jest.fn().mockResolvedValue(
        entries.map((e, i) => ({
          id: `e${i}`,
          franchiseId: 'fr-A',
          franchise: { id: 'fr-A', businessName: 'Store A', franchiseCode: 'SM-FR-001' },
          ...e,
        })),
      ),
    },
    discountLiabilityLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }) },
    // Phase 250 (Franchise tax) — commission-GST place-of-supply lookup.
    platformGstProfile: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma: any = { $transaction: (cb: any) => cb(tx) };
  const financeRepo: any = {};
  const franchiseRepo: any = { findById: jest.fn() };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const tdsHook: any = {
    applyToFranchiseSettlementOnApprove: jest
      .fn()
      .mockResolvedValue({ stamped: false, skipped: true, tdsInPaise: 0n }),
    markWithheldOnPayFranchise: jest
      .fn()
      .mockResolvedValue({ ledgerId: null, flipped: false }),
  };
  const tcsHook: any = {
    applyToFranchiseSettlementOnApprove: jest
      .fn()
      .mockResolvedValue({ stamped: false, skipped: true, tcsInPaise: 0n }),
    markCollectedOnPayFranchise: jest
      .fn()
      .mockResolvedValue({ ledgerId: null, flipped: false }),
  };
  const svc = new FranchiseSettlementService(financeRepo, franchiseRepo, eventBus, logger, prisma, tdsHook, tcsHook);
  return { svc, get created() { return created; }, tx };
}

describe('FranchiseSettlementService aggregation — B4 / B5 / #9', () => {
  it('gross holds SALES earnings only; reversal subtracts once; adjustment adds with sign', async () => {
    const ctx = buildCreateService([
      // a sale: contributes to gross
      { sourceType: 'ONLINE_ORDER', baseAmount: '1000', platformEarning: '150', franchiseEarning: '850' },
      // a +bonus adjustment: must ADD 500 to net (B4)
      { sourceType: 'ADJUSTMENT', baseAmount: '0', platformEarning: '0', franchiseEarning: '500' },
      // a −penalty adjustment: must SUBTRACT 200 from net (B4)
      { sourceType: 'ADJUSTMENT', baseAmount: '0', platformEarning: '0', franchiseEarning: '-200' },
      // an online return clawback: must reduce net by 1000 ONCE (B5)
      { sourceType: 'RETURN_REVERSAL', baseAmount: '-1000', platformEarning: '-150', franchiseEarning: '-1000' },
    ]);
    await ctx.svc.createSettlementCycle(new Date('2026-01-01'), new Date('2026-01-31'));

    const d = ctx.created!.data;
    // Gross = the sale only (850). NOT the adjustments, NOT the reversal.
    expect(Number(d.grossFranchiseEarning)).toBe(850);
    expect(Number(d.reversalAmount)).toBe(1000); // positive magnitude
    expect(Number(d.adjustmentAmount)).toBe(300); // +500 − 200, signed
    // net = gross − reversal + adjustment = 850 − 1000 + 300 = 150.
    // (The old bug produced 850+500−200−1000 − 1000 − 300 = −1150.)
    expect(Number(d.netPayableToFranchise)).toBe(150);
  });

  it('a pure +bonus increases net above gross', async () => {
    const ctx = buildCreateService([
      { sourceType: 'POS_SALE', baseAmount: '2000', platformEarning: '0', franchiseEarning: '2000' },
      { sourceType: 'ADJUSTMENT', baseAmount: '0', platformEarning: '0', franchiseEarning: '500' },
    ]);
    await ctx.svc.createSettlementCycle(new Date('2026-01-01'), new Date('2026-01-31'));
    const d = ctx.created!.data;
    expect(Number(d.grossFranchiseEarning)).toBe(2000);
    expect(Number(d.netPayableToFranchise)).toBe(2500); // gross + bonus
  });
});

describe('FranchiseSettlementService.markSettlementPaid — B3 / #16 (atomic CAS)', () => {
  function build(settlementStatus: string, casCount: number) {
    const ledgerUpdate = jest.fn().mockResolvedValue({ count: 2 });
    const tx: any = {
      franchiseSettlement: {
        updateMany: jest.fn().mockResolvedValue({ count: casCount }),
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'PAID' }),
      },
      franchiseFinanceLedger: { updateMany: ledgerUpdate },
      discountLiabilityLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }) },
    };
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const financeRepo: any = {
      findSettlementById: jest.fn().mockResolvedValue({
        id: 's1',
        status: settlementStatus,
        franchiseId: 'fr-A',
        netPayableToFranchise: '100',
        ledgerEntries: [{ id: 'e1' }, { id: 'e2' }],
      }),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const tdsHook: any = {
      applyToFranchiseSettlementOnApprove: jest
        .fn()
        .mockResolvedValue({ stamped: false, skipped: true, tdsInPaise: 0n }),
      markWithheldOnPayFranchise: jest
        .fn()
        .mockResolvedValue({ ledgerId: null, flipped: false }),
    };
    const tcsHook: any = {
      applyToFranchiseSettlementOnApprove: jest
        .fn()
        .mockResolvedValue({ stamped: false, skipped: true, tcsInPaise: 0n }),
      markCollectedOnPayFranchise: jest
        .fn()
        .mockResolvedValue({ ledgerId: null, flipped: false }),
    };
    const svc = new FranchiseSettlementService(financeRepo, {} as any, eventBus, logger, prisma, tdsHook, tcsHook);
    return { svc, tx, eventBus, ledgerUpdate };
  }

  it('flips APPROVED→PAID and SETTLES the ledger in one transaction (CAS wins)', async () => {
    const { svc, tx, eventBus } = build('APPROVED', 1);
    await svc.markSettlementPaid('s1', 'UTR1234567890');

    expect(tx.franchiseSettlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', status: 'APPROVED' },
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
    expect(tx.franchiseFinanceLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['e1', 'e2'] } },
        data: expect.objectContaining({ status: 'SETTLED', settlementBatchId: 's1' }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('a concurrent loser (CAS count 0) aborts WITHOUT settling the ledger', async () => {
    const { svc, ledgerUpdate } = build('APPROVED', 0);
    await expect(svc.markSettlementPaid('s1', 'UTR1234567890')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-APPROVED settlement up front', async () => {
    const { svc } = build('PAID', 1);
    await expect(svc.markSettlementPaid('s1', 'UTR1234567890')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});

describe('FranchiseSettlementService.createSettlementCycle — #13 overlap', () => {
  it('rejects a period overlapping an already-settled cycle', async () => {
    const tx: any = {
      settlementCycle: {
        findMany: jest.fn().mockResolvedValue([{ id: 'old-cycle' }]),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      franchiseSettlement: { count: jest.fn().mockResolvedValue(1) },
      franchiseFinanceLedger: { updateMany: jest.fn(), findMany: jest.fn() },
      discountLiabilityLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountInPaise: null } }) },
    };
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const tdsHook: any = {
      applyToFranchiseSettlementOnApprove: jest.fn(),
      markWithheldOnPayFranchise: jest.fn(),
    };
    const tcsHook: any = {
      applyToFranchiseSettlementOnApprove: jest.fn(),
      markCollectedOnPayFranchise: jest.fn(),
    };
    const svc = new FranchiseSettlementService(
      {} as any,
      {} as any,
      { publish: jest.fn() } as any,
      logger,
      prisma,
      tdsHook,
      tcsHook,
    );
    await expect(
      svc.createSettlementCycle(new Date('2026-01-05'), new Date('2026-01-20')),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    // Must not create a cycle when overlap is detected.
    expect(tx.settlementCycle.create).not.toHaveBeenCalled();
  });
});
