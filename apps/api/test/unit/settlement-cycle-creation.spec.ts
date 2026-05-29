// Phase 141 — settlement cycle creation/preview/cancel hardening.
//   createCycle: rejects an overlapping non-cancelled cycle, stamps
//     createdByAdminId, writes an audit row.
//   previewCycle: read-only aggregate, never opens a transaction.
//   cancelCycle: DRAFT/PREVIEWED-only; releases claimed records + audits.

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettlementService } from '../../src/modules/settlements/settlement.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';
import { CreateCycleDto } from '../../src/modules/settlements/dtos/create-cycle.dto';

function build(opts: {
  overlap?: any;
  pending?: any[];
  cancelCycle?: any;
  pendingDebits?: any[];
} = {}) {
  const tx = {
    settlementCycle: {
      create: jest.fn().mockResolvedValue({ id: 'cyc1', totalAmount: '70.00' }),
      findUnique: jest.fn().mockResolvedValue(opts.cancelCycle ?? null),
      update: jest.fn(async (args: any) => ({ id: 'cyc1', ...args?.data })),
    },
    sellerSettlement: {
      create: jest.fn().mockResolvedValue({ id: 'ss1', sellerId: 's1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    commissionRecord: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.pending?.length ?? 3 }),
    },
    // Phase 150 — post-settlement claw-back netting.
    sellerDebit: {
      findMany: jest.fn().mockResolvedValue(opts.pendingDebits ?? []),
      // count always matches the ids being flipped so the CAS guard passes.
      updateMany: jest.fn(async (args: any) => ({
        count: args?.where?.id?.in?.length ?? 0,
      })),
    },
    settlementAdjustment: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    settlementCycle: {
      findFirst: jest.fn().mockResolvedValue(opts.overlap ?? null),
    },
    commissionRecord: { findMany: jest.fn().mockResolvedValue(opts.pending ?? []) },
    platformGstProfile: { findFirst: jest.fn().mockResolvedValue({ gstStateCode: '29' }) },
    // Phase 150 — previewCycle reads pending debits for the claw-back preview.
    sellerDebit: { findMany: jest.fn().mockResolvedValue(opts.pendingDebits ?? []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const moneyDualWrite = { applyPaise: (_k: string, d: any) => d };
  const svc = new SettlementService(
    prisma as any,
    audit as any,
    moneyDualWrite as any,
    {} as any, // tcsHook
    {} as any, // tdsHook
  );
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, prisma, tx, audit };
}

const oneRecord = [
  {
    id: 'cr1',
    sellerId: 's1',
    sellerName: 'Shop',
    subOrderId: 'so1',
    quantity: 1,
    totalPlatformAmount: '100.00',
    totalSettlementAmount: '70.00',
    platformMargin: '30.00',
    seller: { id: 's1', sellerShopName: 'Shop', gstStateCode: '29' },
  },
];

const start = new Date('2026-05-01T00:00:00Z');
const end = new Date('2026-05-31T23:59:59Z');

describe('SettlementService.createCycle (Phase 141)', () => {
  it('rejects a period that overlaps an existing non-cancelled cycle', async () => {
    const { svc, prisma } = build({ overlap: { id: 'old', status: 'DRAFT' } });
    await expect(svc.createCycle(start, end, { adminId: 'a1' })).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    // Must fail before scanning records.
    expect(prisma.commissionRecord.findMany).not.toHaveBeenCalled();
  });

  it('stamps createdByAdminId and writes a cycle_created audit row', async () => {
    const { svc, tx, audit } = build({ pending: oneRecord });
    await svc.createCycle(start, end, { adminId: 'admin1' });
    expect(tx.settlementCycle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdByAdminId: 'admin1' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settlement.cycle_created',
        resourceId: 'cyc1',
        newValue: expect.objectContaining({ sellerCount: 1, recordCount: 1 }),
      }),
    );
  });

  it('returns {cycle:null} when no pending records match', async () => {
    const { svc, prisma } = build({ pending: [] });
    const res = await svc.createCycle(start, end, { adminId: 'a1' });
    expect(res.cycle).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SettlementService.createCycle — post-settlement claw-back netting (Phase 150)', () => {
  const debit = (over: any = {}) => ({
    id: 'd1',
    sellerId: 's1',
    amountInPaise: 1000n, // ₹10
    sourceType: 'RETURN',
    sourceId: 'ret-1',
    reason: 'POST_SETTLEMENT_RETURN: claw-back',
    ...over,
  });

  it('nets a PENDING debit off the payout: net < gross, approved stays gross', async () => {
    const { svc, tx } = build({ pending: oneRecord, pendingDebits: [debit()] });
    await svc.createCycle(start, end, { adminId: 'a1' });
    const data = tx.sellerSettlement.create.mock.calls[0][0].data;
    expect(data.totalSettlementAmount).toBe('60.00'); // 70 − 10
    expect(data.approvedSettlementAmount).toBe('70.00'); // gross snapshot
  });

  it('marks the debit APPLIED with the settlementId + writes a negative CLAWBACK adjustment', async () => {
    const { svc, tx } = build({ pending: oneRecord, pendingDebits: [debit()] });
    await svc.createCycle(start, end, { adminId: 'a1' });
    expect(tx.sellerDebit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['d1'] }, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'APPLIED',
          settlementId: 'ss1',
        }),
      }),
    );
    expect(tx.settlementAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settlementId: 'ss1',
          adjustmentType: 'CLAWBACK',
          amountInPaise: -1000n,
          amount: '-10.00',
        }),
      }),
    );
  });

  it('reduces the cycle headline total by the netted claw-back', async () => {
    const { svc, tx } = build({ pending: oneRecord, pendingDebits: [debit()] });
    await svc.createCycle(start, end, { adminId: 'a1' });
    expect(tx.settlementCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cyc1' },
        data: expect.objectContaining({ totalAmount: '60.00' }),
      }),
    );
  });

  it('floors at zero + carries forward: a debit larger than the payout stays PENDING', async () => {
    // ₹100 debit vs ₹70 payout → can't be absorbed → left PENDING (no apply).
    const { svc, tx } = build({
      pending: oneRecord,
      pendingDebits: [debit({ amountInPaise: 10000n })],
    });
    await svc.createCycle(start, end, { adminId: 'a1' });
    const data = tx.sellerSettlement.create.mock.calls[0][0].data;
    expect(data.totalSettlementAmount).toBe('70.00'); // unchanged — nothing applied
    expect(tx.sellerDebit.updateMany).not.toHaveBeenCalled();
    expect(tx.settlementAdjustment.create).not.toHaveBeenCalled();
    expect(tx.settlementCycle.update).not.toHaveBeenCalled();
  });

  it('greedily applies what fits and carries the rest: [₹50, ₹30] vs ₹70 → applies ₹50', async () => {
    const { svc, tx } = build({
      pending: oneRecord,
      pendingDebits: [
        debit({ id: 'd1', amountInPaise: 5000n }),
        debit({ id: 'd2', amountInPaise: 3000n }),
      ],
    });
    await svc.createCycle(start, end, { adminId: 'a1' });
    const data = tx.sellerSettlement.create.mock.calls[0][0].data;
    expect(data.totalSettlementAmount).toBe('20.00'); // 70 − 50
    expect(tx.sellerDebit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['d1'] }, status: 'PENDING' } }),
    );
  });

  it('no debits → unchanged gross payout, no adjustment, no cycle-total update', async () => {
    const { svc, tx } = build({ pending: oneRecord, pendingDebits: [] });
    await svc.createCycle(start, end, { adminId: 'a1' });
    const data = tx.sellerSettlement.create.mock.calls[0][0].data;
    expect(data.totalSettlementAmount).toBe('70.00');
    expect(tx.settlementAdjustment.create).not.toHaveBeenCalled();
    expect(tx.settlementCycle.update).not.toHaveBeenCalled();
  });
});

describe('SettlementService.previewCycle (Phase 141/142)', () => {
  it('aggregates without writing (no transaction) and surfaces overlap', async () => {
    const { svc, prisma } = build({
      pending: oneRecord,
      overlap: { id: 'old', status: 'APPROVED', periodStart: start, periodEnd: end },
    });
    const res = await svc.previewCycle(start, end);
    expect(res.isDryRun).toBe(true);
    expect(res.scope).toBe('SELLER');
    expect(res.recordCount).toBe(1);
    expect(res.sellerCount).toBe(1);
    expect(res.totalSettlementAmount).toBe('70.00');
    expect(res.totalMargin).toBe('30.00');
    expect(res.overlap?.id).toBe('old');
    expect(typeof res.asOf).toBe('string');
    // No mutation: no transaction opened.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('queries only PENDING, unclaimed (settlementId:null) commissions', async () => {
    const { svc, prisma } = build({ pending: oneRecord });
    await svc.previewCycle(start, end);
    const where = prisma.commissionRecord.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING');
    expect(where.settlementId).toBeNull();
  });

  it('per-seller breakdown sums quantity into totalItems (not row count)', async () => {
    const multiQty = [
      { ...oneRecord[0], id: 'cr1', quantity: 3 },
      { ...oneRecord[0], id: 'cr2', quantity: 2, subOrderId: 'so2' },
    ];
    const { svc } = build({ pending: multiQty });
    const res = await svc.previewCycle(start, end);
    expect(res.sellerBreakdown).toHaveLength(1);
    expect(res.sellerBreakdown[0]!.recordCount).toBe(2); // 2 rows
    expect(res.sellerBreakdown[0]!.totalItems).toBe(5); // 3 + 2 quantity
    expect(res.sellerBreakdown[0]!.totalOrders).toBe(2); // 2 distinct sub-orders
  });

  it('writes a best-effort preview audit row when an actor is supplied', async () => {
    const { svc, audit } = build({ pending: oneRecord });
    await svc.previewCycle(start, end, { adminId: 'admin1' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settlement.cycle_previewed' }),
    );
  });
});

describe('preview/create math parity (Phase 142 shared aggregator)', () => {
  it('previewCycle totals equal what createCycle writes for the same data', async () => {
    const pending = [
      { ...oneRecord[0], id: 'cr1', totalSettlementAmount: '70.00', platformMargin: '30.00' },
      { ...oneRecord[0], id: 'cr2', subOrderId: 'so2', totalSettlementAmount: '40.50', platformMargin: '9.50' },
    ];
    const previewBuild = build({ pending });
    const preview = await previewBuild.svc.previewCycle(start, end);

    const createBuild = build({ pending });
    await createBuild.svc.createCycle(start, end, { adminId: 'a1' });
    const cycleCreateData = createBuild.tx.settlementCycle.create.mock.calls[0][0].data;

    // Both run the SAME aggregator → identical totals (110.50 / 39.50).
    expect(preview.totalSettlementAmount).toBe('110.50');
    expect(preview.totalMargin).toBe('39.50');
    expect(cycleCreateData.totalAmount).toBe(preview.totalSettlementAmount);
    expect(cycleCreateData.totalMargin).toBe(preview.totalMargin);
  });
});

describe('SettlementService.cancelCycle (Phase 141)', () => {
  it('releases records + marks CANCELLED + audits a DRAFT cycle', async () => {
    const { svc, tx, audit } = build({
      cancelCycle: { id: 'cyc1', status: 'DRAFT', sellerSettlements: [{ id: 'ss1' }] },
    });
    const res = await svc.cancelCycle('cyc1', { adminId: 'admin1' }, 'created in error');
    expect(tx.commissionRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settlementId: { in: ['ss1'] } },
        data: expect.objectContaining({ settlementId: null }),
      }),
    );
    expect(tx.settlementCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(res.releasedRecordCount).toBe(3);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settlement.cycle_cancelled' }),
    );
  });

  it('refuses to cancel an APPROVED cycle', async () => {
    const { svc, tx } = build({
      cancelCycle: { id: 'cyc1', status: 'APPROVED', sellerSettlements: [] },
    });
    await expect(
      svc.cancelCycle('cyc1', { adminId: 'a1' }, 'too late'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(tx.settlementCycle.update).not.toHaveBeenCalled();
  });

  it('404s on a missing cycle', async () => {
    const { svc } = build({ cancelCycle: null });
    await expect(
      svc.cancelCycle('missing', { adminId: 'a1' }, 'reason here'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('rejects a too-short reason', async () => {
    const { svc } = build({ cancelCycle: { id: 'cyc1', status: 'DRAFT', sellerSettlements: [] } });
    await expect(
      svc.cancelCycle('cyc1', { adminId: 'a1' }, 'no'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('CreateCycleDto validation (Phase 141)', () => {
  it('rejects non-ISO dates', async () => {
    const dto = plainToInstance(CreateCycleDto, { periodStart: 'garbage', periodEnd: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'periodStart')).toBe(true);
    expect(errors.some((e) => e.property === 'periodEnd')).toBe(true);
  });

  it('accepts valid ISO dates', async () => {
    const dto = plainToInstance(CreateCycleDto, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
