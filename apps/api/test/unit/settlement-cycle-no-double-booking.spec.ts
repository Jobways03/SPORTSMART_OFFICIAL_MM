import 'reflect-metadata';
import { FranchiseSettlementService } from '../../src/modules/franchise/application/services/franchise-settlement.service';

/**
 * Regression test for the settlement-cycle double-booking race.
 *
 * Before: createSettlementCycle did
 *   findMany({ status: PENDING, createdAt: [start..end] })
 *   ... compute totals ...
 *   updateMany({ where: { id: { in: entryIds } }, data: { status: ACCRUED, settlementBatchId } })
 *
 * Two admins calling simultaneously with overlapping date ranges both
 * see the same PENDING rows, both compute totals from them, and both
 * create FranchiseSettlement rows including the overlap — franchise
 * double-counted in two payouts.
 *
 * After: the service CLAIMS the pending rows atomically via
 * updateMany(status: PENDING → ACCRUED, settlementBatchId = cycle.id)
 * up-front. PostgreSQL takes row-level write locks; the second tx
 * sees the status flipped and claims zero rows in the overlap.
 *
 * This test pins the new ordering so a refactor can't regress back
 * to find-then-update.
 */

describe('FranchiseSettlementService.createSettlementCycle — atomic claim', () => {
  const buildService = () => {
    const calls: Array<{ op: string; args: any }> = [];
    const tx = {
      settlementCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'cycle-1', periodStart: new Date(), periodEnd: new Date() }),
      },
      franchiseFinanceLedger: {
        updateMany: jest.fn(async (args: any) => {
          calls.push({ op: 'ledger.updateMany', args });
          // First call = the claim; return 2 rows claimed.
          // Subsequent calls = per-franchise re-point; also succeed.
          return { count: calls.filter((c) => c.op === 'ledger.updateMany').length === 1 ? 2 : 2 };
        }),
        findMany: jest.fn(async (args: any) => {
          calls.push({ op: 'ledger.findMany', args });
          return [
            {
              id: 'e1',
              franchiseId: 'fr-A',
              sourceType: 'ONLINE_ORDER',
              baseAmount: '100',
              platformEarning: '15',
              franchiseEarning: '85',
              franchise: { id: 'fr-A', businessName: 'Store A', franchiseCode: 'SM-FR-001' },
            },
            {
              id: 'e2',
              franchiseId: 'fr-A',
              sourceType: 'ONLINE_ORDER',
              baseAmount: '50',
              platformEarning: '7.5',
              franchiseEarning: '42.5',
              franchise: { id: 'fr-A', businessName: 'Store A', franchiseCode: 'SM-FR-001' },
            },
          ];
        }),
      },
      franchiseSettlement: {
        create: jest.fn(async (args: any) => {
          calls.push({ op: 'settlement.create', args });
          return { id: 'settle-fr-A', ...args.data };
        }),
      },
    };
    const prisma: any = {
      $transaction: (cb: any) => cb(tx),
    };
    const franchiseRepo: any = { findById: jest.fn() };
    const financeRepo: any = {};
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const svc = new FranchiseSettlementService(
      financeRepo,
      franchiseRepo,
      eventBus,
      logger,
      prisma,
    );
    return { svc, calls, tx };
  };

  it('claims pending rows with updateMany BEFORE it fetches them (atomic claim, not find-then-update)', async () => {
    const { svc, calls } = buildService();
    await svc.createSettlementCycle(new Date('2026-01-01'), new Date('2026-01-07'));

    const ledgerOps = calls.filter((c) =>
      c.op === 'ledger.updateMany' || c.op === 'ledger.findMany',
    );
    // First ledger op MUST be the claim (updateMany), not a read.
    expect(ledgerOps[0].op).toBe('ledger.updateMany');
    // The claim filters on status=PENDING so a racing tx sees zero.
    expect(ledgerOps[0].args.where.status).toBe('PENDING');
    expect(ledgerOps[0].args.data.status).toBe('ACCRUED');
    expect(ledgerOps[0].args.data.settlementBatchId).toBe('cycle-1');

    // Second op is the re-fetch by our cycle's marker (cycle.id), so
    // another tx running in parallel can't observe our claimed rows.
    expect(ledgerOps[1].op).toBe('ledger.findMany');
    expect(ledgerOps[1].args.where.settlementBatchId).toBe('cycle-1');
  });

  it('short-circuits with empty settlements when the atomic claim returns zero rows', async () => {
    const { svc, tx } = buildService();
    tx.franchiseFinanceLedger.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    tx.franchiseFinanceLedger.findMany = jest.fn();

    const res = await svc.createSettlementCycle(new Date(), new Date());

    expect(res.settlements).toEqual([]);
    // Must not even attempt the re-fetch or create settlements.
    expect(tx.franchiseFinanceLedger.findMany).not.toHaveBeenCalled();
  });

  it('re-points claimed rows to the per-franchise settlement id (invariant: one entry → one settlement)', async () => {
    const { svc, calls } = buildService();
    await svc.createSettlementCycle(new Date('2026-01-01'), new Date('2026-01-07'));

    // After creating FranchiseSettlement for fr-A, ledger rows should
    // be re-tagged from cycle.id to the settlement.id. Find the
    // second updateMany — it's the per-franchise re-point.
    const updateManys = calls.filter((c) => c.op === 'ledger.updateMany');
    expect(updateManys).toHaveLength(2);
    expect(updateManys[1].args.data.settlementBatchId).toBe('settle-fr-A');
  });
});
