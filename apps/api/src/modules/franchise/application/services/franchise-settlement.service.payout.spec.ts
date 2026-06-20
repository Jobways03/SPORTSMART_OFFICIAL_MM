/**
 * Coverage for the richer franchise payout flow (parity with the seller side):
 *   - mark-paid captures UTR / method / proof / paidByAdminId
 *   - mark-paid accepts APPROVED *or* FAILED (retry a failed payout)
 *   - a duplicate UTR (Prisma P2002 on the unique index) maps to a clear 400
 *   - approve stamps approvedByAdminId + approvedAt
 */
import 'reflect-metadata';
import { FranchiseSettlementService } from './franchise-settlement.service';

const BASE_SETTLEMENT = {
  id: 'set-1',
  franchiseId: 'fr-1',
  status: 'APPROVED',
  netPayableToFranchise: '2124.15',
  tcsDeductedInPaise: 0n,
  tdsDeductedInPaise: 0n,
  totalCommissionGstInPaise: 0n,
  dynamicChargeTotalInPaise: 0n,
  chargeRulesApplied: false,
  ledgerEntries: [{ id: 'fl-1' }],
  cycle: {
    id: 'cyc-1',
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-06-19T00:00:00Z'),
  },
};

function buildForPay(
  settlement: any,
  opts: { flipCount?: number; flipError?: any } = {},
) {
  const captured: any = {};
  const tx: any = {
    franchiseSettlement: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        captured.flipWhere = where;
        captured.flipData = data;
        if (opts.flipError) throw opts.flipError;
        return { count: opts.flipCount ?? 1 };
      }),
      findUnique: jest.fn().mockResolvedValue({ id: settlement.id, status: 'PAID' }),
    },
    franchiseFinanceLedger: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const financeRepo: any = {
    findSettlementById: jest.fn().mockResolvedValue(settlement),
  };
  const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
  const tdsHook: any = { markWithheldOnPayFranchise: jest.fn().mockResolvedValue({}) };
  const tcsHook: any = { markCollectedOnPayFranchise: jest.fn().mockResolvedValue({}) };
  const service = new FranchiseSettlementService(
    financeRepo,
    {} as any,
    eventBus,
    logger,
    prisma,
    tdsHook,
    tcsHook,
  );
  return { service, captured };
}

describe('FranchiseSettlementService.markSettlementPaid — richer payout', () => {
  it('captures UTR, method, proof and paidByAdminId, and accepts APPROVED|FAILED', async () => {
    const ctx = buildForPay({ ...BASE_SETTLEMENT });

    await ctx.service.markSettlementPaid('set-1', {
      paymentReference: 'UTR12345',
      paymentMethod: 'NEFT',
      paymentProofUrl: 'https://proof/x.pdf',
      paidByAdminId: 'admin-9',
    });

    expect(ctx.captured.flipData).toMatchObject({
      status: 'PAID',
      paymentReference: 'UTR12345',
      paymentMethod: 'NEFT',
      paymentProofUrl: 'https://proof/x.pdf',
      paidByAdminId: 'admin-9',
    });
    expect(ctx.captured.flipWhere.status).toEqual({ in: ['APPROVED', 'FAILED'] });
  });

  it('allows retrying a FAILED payout', async () => {
    const ctx = buildForPay({ ...BASE_SETTLEMENT, status: 'FAILED' });
    await expect(
      ctx.service.markSettlementPaid('set-1', { paymentReference: 'UTR999' }),
    ).resolves.toBeTruthy();
  });

  it('rejects a PENDING settlement', async () => {
    const ctx = buildForPay({ ...BASE_SETTLEMENT, status: 'PENDING' });
    await expect(
      ctx.service.markSettlementPaid('set-1', { paymentReference: 'UTR1' }),
    ).rejects.toThrow(/Only APPROVED or FAILED/);
  });

  it('maps a duplicate-UTR unique violation (P2002) to a clear error', async () => {
    const ctx = buildForPay({ ...BASE_SETTLEMENT }, { flipError: { code: 'P2002' } });
    await expect(
      ctx.service.markSettlementPaid('set-1', { paymentReference: 'DUP1' }),
    ).rejects.toThrow(/already recorded against another settlement/);
  });
});

describe('FranchiseSettlementService.approveSettlement — approval audit', () => {
  it('stamps approvedByAdminId + approvedAt', async () => {
    let approveData: any = null;
    const tx: any = {
      franchiseSettlement: {
        update: jest.fn(async ({ data }: any) => {
          approveData = data;
          return { id: 'set-1', status: 'APPROVED' };
        }),
      },
      discountLiabilityLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const financeRepo: any = {
      findSettlementById: jest
        .fn()
        .mockResolvedValue({ ...BASE_SETTLEMENT, status: 'PENDING' }),
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const tdsHook: any = {
      applyToFranchiseSettlementOnApprove: jest.fn().mockResolvedValue({}),
    };
    const tcsHook: any = {
      applyToFranchiseSettlementOnApprove: jest.fn().mockResolvedValue({}),
    };
    const service = new FranchiseSettlementService(
      financeRepo,
      {} as any,
      eventBus,
      logger,
      prisma,
      tdsHook,
      tcsHook,
    );

    await service.approveSettlement('set-1', { approvedByAdminId: 'admin-7' });

    expect(approveData.status).toBe('APPROVED');
    expect(approveData.approvedByAdminId).toBe('admin-7');
    expect(approveData.approvedAt).toBeInstanceOf(Date);
  });
});
