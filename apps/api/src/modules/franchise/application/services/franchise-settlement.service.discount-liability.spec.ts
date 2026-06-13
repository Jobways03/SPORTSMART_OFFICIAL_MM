/**
 * Phase 247-FB — focused coverage for the FRANCHISE-funded discount deduction
 * on FranchiseSettlementService (the consumer side of franchise-funded
 * discount liability).
 *
 * The franchise bears the cost of the discount it funded, so a FRANCHISE
 * DiscountLiabilityLedger row inside the cycle window is a DEDUCTION from the
 * franchise's settlement net — the mirror of the seller-funded discount on
 * SettlementService. A return writes a NEW row with a NEGATIVE amount_in_paise
 * (status REVERSED) and leaves the original APPLIED row intact; summing the
 * SIGNED column (no abs()) nets the credit-back exactly once.
 *
 * These tests pin:
 *   1. a ₹100 (10000 paise) APPLIED franchise discount reduces that
 *      franchise's netPayableToFranchise by exactly ₹100, and surfaces
 *      discountFundedDeductionInPaise="10000".
 *   2. a fully-reversed discount (10000 APPLIED + −10000 REVERSED) nets to 0 —
 *      no deduction, full payout restored.
 *   3. the ledger query is scoped FRANCHISE / this-franchise / window / signed.
 *
 * Mirrors the plain-object Prisma mock + $transaction shim used by the seller
 * settlement.service.discount-liability.spec.ts so the dependency surface stays
 * in lock-step. The 5-arg constructor is NOT changed by this work.
 */
import 'reflect-metadata';
import { FranchiseSettlementService } from './franchise-settlement.service';

const PERIOD_START = new Date('2026-05-01T00:00:00Z');
const PERIOD_END = new Date('2026-05-31T23:59:59Z');

/**
 * One ONLINE_ORDER franchise-earning ledger row worth ₹500 franchise earning,
 * so the pre-discount net is ₹500. (baseAmount/platformEarning are not part of
 * the net computation for ONLINE_ORDER beyond the bucket totals.)
 */
const FINANCE_ROW = {
  id: 'fl-1',
  franchiseId: 'fr-1',
  sourceType: 'ONLINE_ORDER',
  baseAmount: 1000,
  platformEarning: 50,
  franchiseEarning: 500,
  status: 'PENDING',
  createdAt: new Date('2026-05-10T00:00:00Z'),
  franchise: { id: 'fr-1', businessName: 'Acme Sports', franchiseCode: 'AC01' },
};

/**
 * Builds the service with a table-level Prisma mock. `discountRows` are the
 * FRANCHISE discount-liability rows for fr-1; the aggregate sums the SIGNED
 * amount_in_paise of the rows the where-clause would match (status IN list),
 * exactly as Prisma would (no abs()).
 */
function buildService(discountRows: any[]) {
  const discountAggregate = jest.fn(async ({ where }: any) => {
    const matched = discountRows.filter(
      (r) =>
        where.liabilityParty === 'FRANCHISE' &&
        where.franchiseId === r.franchiseId &&
        where.status.in.includes(r.status),
    );
    const sum = matched.reduce((acc, r) => acc + BigInt(r.amountInPaise), 0n);
    return { _sum: { amountInPaise: matched.length ? sum : null } };
  });

  // Capture the data the settlement is created with so the test can assert the
  // net + surfaced deduction.
  const createdSettlements: any[] = [];
  const settlementCreate = jest.fn(async ({ data }: any) => {
    const row = { id: `set-${createdSettlements.length + 1}`, ...data };
    createdSettlements.push(row);
    return row;
  });

  const tx: any = {
    settlementCycle: {
      findMany: jest.fn().mockResolvedValue([]), // no overlap
      findFirst: jest.fn().mockResolvedValue(null), // no existing cycle
      create: jest
        .fn()
        .mockResolvedValue({ id: 'cyc-1', periodStart: PERIOD_START, periodEnd: PERIOD_END, status: 'DRAFT' }),
    },
    franchiseSettlement: {
      count: jest.fn().mockResolvedValue(0),
      create: settlementCreate,
      // Phase 251 — dynamic-charge total + flag stamped after each create.
      update: jest.fn().mockResolvedValue({}),
    },
    franchiseFinanceLedger: {
      // claim: PENDING → ACCRUED (one row claimed)
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // refetch the claimed rows
      findMany: jest.fn().mockResolvedValue([FINANCE_ROW]),
    },
    discountLiabilityLedger: {
      aggregate: discountAggregate,
    },
    // Phase 250 (Franchise tax) — commission-GST place-of-supply lookup. A null
    // profile → calculator falls back to inter-state IGST (fine for these tests).
    platformGstProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // Phase 251 — dynamic settlement charge rules snapshot + frozen breakup.
    settlementChargeRule: { findMany: jest.fn().mockResolvedValue([]) },
    franchiseSettlementChargeLine: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    discountLiabilityLedger: { aggregate: discountAggregate },
  };

  const financeRepo: any = {};
  const franchiseRepo: any = { findById: jest.fn() };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
  // Phase 250 (Franchise tax) — TDS hook (only exercised by approve/pay, mocked).
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

  const service = new FranchiseSettlementService(
    financeRepo,
    franchiseRepo,
    eventBus,
    logger,
    prisma,
    tdsHook,
    tcsHook,
  );
  return { service, createdSettlements, discountAggregate };
}

describe('FranchiseSettlementService — franchise-funded discount deduction (Phase 247-FB)', () => {
  it('subtracts a ₹100 APPLIED franchise discount from the net and surfaces it', async () => {
    const { service, createdSettlements, discountAggregate } = buildService([
      {
        franchiseId: 'fr-1',
        status: 'APPLIED',
        amountInPaise: 10000n, // ₹100 funded by the franchise
        createdAt: new Date('2026-05-12T00:00:00Z'),
      },
    ]);

    const res = await service.createSettlementCycle(PERIOD_START, PERIOD_END);

    // Net was ₹500 gross − ₹100 discount = ₹400.
    expect(createdSettlements).toHaveLength(1);
    expect(createdSettlements[0].netPayableToFranchise.toFixed(2)).toBe('400.00');

    // The deduction is surfaced on the response settlement (BigInt → string).
    const surfaced = res.settlements[0];
    expect(surfaced.discountFundedDeductionInPaise).toBe('10000');

    // The ledger query is scoped FRANCHISE / this franchise / signed status set.
    expect(discountAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          liabilityParty: 'FRANCHISE',
          franchiseId: 'fr-1',
          status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
          createdAt: { gte: PERIOD_START, lte: PERIOD_END },
        }),
        _sum: { amountInPaise: true },
      }),
    );
  });

  it('nets a fully-reversed discount to zero (full payout restored)', async () => {
    const { service, createdSettlements } = buildService([
      {
        franchiseId: 'fr-1',
        status: 'APPLIED',
        amountInPaise: 10000n,
        createdAt: new Date('2026-05-12T00:00:00Z'),
      },
      {
        franchiseId: 'fr-1',
        status: 'REVERSED',
        amountInPaise: -10000n, // return credited the full discount back
        createdAt: new Date('2026-05-20T00:00:00Z'),
      },
    ]);

    const res = await service.createSettlementCycle(PERIOD_START, PERIOD_END);

    // 10000 + (−10000) = 0 deduction → net stays the full ₹500.
    expect(createdSettlements[0].netPayableToFranchise.toFixed(2)).toBe('500.00');
    expect(res.settlements[0].discountFundedDeductionInPaise).toBe('0');
  });

  it('leaves the net unchanged when the franchise funded no discount', async () => {
    const { service, createdSettlements } = buildService([]);

    const res = await service.createSettlementCycle(PERIOD_START, PERIOD_END);

    expect(createdSettlements[0].netPayableToFranchise.toFixed(2)).toBe('500.00');
    expect(res.settlements[0].discountFundedDeductionInPaise).toBe('0');
  });
});
