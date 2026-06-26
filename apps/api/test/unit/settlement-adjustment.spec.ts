// Phase 147 — settlement adjustments: transactional (row + settlement net +
// cycle aggregate move together), typed, idempotent, XSS-stripped, bounded,
// cycle-status-guarded; void reverses the effect; approved gross is immutable.

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettlementService } from '../../src/modules/settlements/settlement.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';
import { CreateAdjustmentDto } from '../../src/modules/settlements/dtos/create-cycle.dto';

function build(opts: { settlement?: any; existing?: any; adj?: any } = {}) {
  const tx = {
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    settlementAdjustment: {
      create: jest.fn().mockResolvedValue({ id: 'adj1' }),
      findUnique: jest.fn().mockResolvedValue(opts.adj ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    settlementCycle: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    settlementAdjustment: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const moneyDualWrite = { applyPaise: (_k: string, d: any) => d };
  const svc = new SettlementService(
    prisma as any,
    audit as any,
    moneyDualWrite as any,
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
  return { svc, prisma, tx, audit };
}

const approvedSettlement = {
  id: 'ss1',
  status: 'APPROVED',
  sellerId: 's1',
  cycleId: 'c1',
  totalSettlementAmount: '100.00',
  cycle: { status: 'APPROVED' },
};

describe('SettlementService.recordAdjustment (Phase 147)', () => {
  it('creates a typed adjustment + increments BOTH settlement net and cycle aggregate', async () => {
    const { svc, tx, audit } = build({ settlement: approvedSettlement });
    await svc.recordAdjustment({
      settlementId: 'ss1',
      amount: 50,
      reason: 'courier penalty for late RTO',
      adjustmentType: 'COURIER_PENALTY' as any,
      adminId: 'admin1',
    });
    expect(tx.settlementAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: '50.00',
          adjustmentType: 'COURIER_PENALTY',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(tx.sellerSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalSettlementAmount: { increment: 50 } }) }),
    );
    // The key fix — the parent cycle aggregate is kept in sync.
    expect(tx.settlementCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmount: { increment: 50 } }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settlement.adjust', oldValue: { totalSettlementAmount: 100 } }),
    );
  });

  it('replays an existing adjustment for the same idempotency key (no double-apply)', async () => {
    const { svc, prisma, tx } = build({
      settlement: approvedSettlement,
      existing: { id: 'adj-prev' },
    });
    const res = await svc.recordAdjustment({
      settlementId: 'ss1',
      amount: 50,
      reason: 'retry',
      idempotencyKey: 'key-123',
      adminId: 'admin1',
    });
    expect((res as any).id).toBe('adj-prev');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.settlementAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects an adjustment on a settlement whose cycle is PAID', async () => {
    const { svc, tx } = build({
      settlement: { ...approvedSettlement, cycle: { status: 'PAID' } },
    });
    await expect(
      svc.recordAdjustment({ settlementId: 'ss1', amount: 50, reason: 'too late', adminId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(tx.settlementAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects an adjustment on a settlement locked into an active payout batch (Phase 153 §5)', async () => {
    const { svc, tx } = build({
      settlement: { ...approvedSettlement, payoutBatchId: 'batch-99' },
    });
    await expect(
      svc.recordAdjustment({ settlementId: 'ss1', amount: 50, reason: 'mid-payout', adminId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(tx.settlementAdjustment.create).not.toHaveBeenCalled();
  });

  it('strips HTML from the reason', async () => {
    const { svc, tx } = build({ settlement: approvedSettlement });
    await svc.recordAdjustment({
      settlementId: 'ss1',
      amount: 50,
      reason: '<b>fraud</b> penalty',
      adminId: 'a',
    });
    expect(tx.settlementAdjustment.create.mock.calls[0][0].data.reason).not.toContain('<');
  });

  it('rejects an amount over the ±1,000,000 bound', async () => {
    const { svc } = build({ settlement: approvedSettlement });
    await expect(
      svc.recordAdjustment({ settlementId: 'ss1', amount: 2_000_000, reason: 'fat finger', adminId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('SettlementService.voidAdjustment (Phase 147)', () => {
  const activeAdj = {
    id: 'adj1',
    status: 'ACTIVE',
    amount: '50.00',
    settlementId: 'ss1',
    settlement: { id: 'ss1', status: 'APPROVED', cycleId: 'c1', cycle: { status: 'APPROVED' } },
  };

  it('voids an ACTIVE adjustment + reverses settlement net and cycle aggregate', async () => {
    const { svc, tx, audit } = build({ adj: activeAdj });
    const res = await svc.voidAdjustment('adj1', { adminId: 'admin1', voidReason: 'duplicate entry' });
    expect(res.success).toBe(true);
    expect(tx.settlementAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'adj1', status: 'ACTIVE' }, data: expect.objectContaining({ status: 'VOIDED' }) }),
    );
    expect(tx.sellerSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalSettlementAmount: { decrement: 50 } }) }),
    );
    expect(tx.settlementCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmount: { decrement: 50 } }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settlement.adjust_void' }),
    );
  });

  it('is idempotent on an already-VOIDED adjustment (no reversal twice)', async () => {
    const { svc, tx } = build({ adj: { ...activeAdj, status: 'VOIDED' } });
    const res = await svc.voidAdjustment('adj1', { adminId: 'a', voidReason: 'again' });
    expect(res.success).toBe(true);
    expect(tx.sellerSettlement.update).not.toHaveBeenCalled();
  });

  it('refuses to void on a PAID settlement', async () => {
    const { svc } = build({
      adj: { ...activeAdj, settlement: { ...activeAdj.settlement, status: 'PAID' } },
    });
    await expect(
      svc.voidAdjustment('adj1', { adminId: 'a', voidReason: 'too late' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('404s on a missing adjustment', async () => {
    const { svc } = build({ adj: null });
    await expect(
      svc.voidAdjustment('missing', { adminId: 'a', voidReason: 'reason here' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('CreateAdjustmentDto validation (Phase 147)', () => {
  it('rejects amount 0 and out-of-range', async () => {
    expect((await validate(plainToInstance(CreateAdjustmentDto, { amount: 0, reason: 'x x x' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateAdjustmentDto, { amount: 2_000_000, reason: 'x x x' }))).length).toBeGreaterThan(0);
  });

  it('rejects an invalid adjustmentType', async () => {
    const dto = plainToInstance(CreateAdjustmentDto, { amount: 50, reason: 'valid reason', adjustmentType: 'BOGUS' });
    expect((await validate(dto)).some((e) => e.property === 'adjustmentType')).toBe(true);
  });

  it('accepts a valid typed adjustment', async () => {
    const dto = plainToInstance(CreateAdjustmentDto, {
      amount: -250.5,
      reason: 'SLA breach fine',
      adjustmentType: 'SLA_FINE',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
