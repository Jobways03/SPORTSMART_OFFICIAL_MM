// Phase 138 — admin manual commission adjustment. Transactional: re-read +
// re-validate + version-CAS update + recompute (keeps the row-math invariant
// totalPlatformAmount = platformMargin + totalSettlementAmount) + an immutable
// history row + a transactional commission.record_adjusted event + audit. The
// platform earning is capped at the order's platform amount, the reason is
// HTML-stripped and length-bounded, and a concurrent adjust 409s.

import { CommissionProcessorService } from '../../src/modules/commission/application/services/commission-processor.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

function build(
  record: any,
  opts: { claimCount?: number; settlement?: any; cycle?: any } = {},
) {
  const adjustmentCreate = jest.fn().mockResolvedValue({});
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.claimCount ?? 1 });
  const findUnique = jest.fn().mockResolvedValue(record);
  const tx = {
    commissionRecord: { findUnique, updateMany },
    commissionAdjustmentHistory: { create: adjustmentCreate },
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
    },
    settlementCycle: {
      findUnique: jest.fn().mockResolvedValue(opts.cycle ?? null),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  // Passthrough — the registry-based paise mirror is no-op in this unit test, so
  // we assert directly on the decimal-string fields the service writes.
  const moneyDualWrite = { applyPaise: (_k: string, d: any) => d };
  const svc = new CommissionProcessorService(
    {} as any, // commissionRepo
    {} as any, // redis
    prisma as any,
    eventBus as any,
    {} as any, // ordersFacade
    moneyDualWrite as any,
    {} as any, // env
    audit as any,
    { wrap: jest.fn((_n: string, fn: () => unknown) => fn()) } as any, // instr (Phase 174 @Cron migration)
  );
  return { svc, eventBus, audit, updateMany, adjustmentCreate };
}

const pending = {
  id: 'cr1',
  status: 'PENDING',
  settlementId: null,
  sellerId: 's1',
  orderNumber: 'O1',
  adminEarning: '80.00',
  platformMargin: '80.00',
  totalPlatformAmount: '100.00',
  productEarning: '20.00',
  totalSettlementAmount: '20.00',
  originalAdminEarning: null,
  version: 3,
};

describe('CommissionProcessorService.adjustCommissionRecord (Phase 138)', () => {
  it('adjusts a PENDING record: version-CAS + recompute + history + txn event + audit', async () => {
    const { svc, updateMany, adjustmentCreate, eventBus, audit } = build(pending);
    await svc.adjustCommissionRecord('cr1', {
      newAdminEarning: 30,
      reason: 'dispute partial refund',
      adminId: 'admin1',
    });

    // CAS is on (id, current version, non-terminal status); version bumps.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'cr1',
          version: 3,
          status: { notIn: ['SETTLED', 'REFUNDED'] },
        },
        data: expect.objectContaining({
          adminEarning: '30.00',
          platformMargin: '30.00',
          // 100 platform − 30 commission = 70 to the seller (invariant held).
          productEarning: '70.00',
          totalSettlementAmount: '70.00',
          isAdjusted: true,
          adjustedBy: 'admin1',
          version: { increment: 1 },
          // first adjustment preserves the processor's original earning.
          originalAdminEarning: '80.00',
        }),
      }),
    );
    expect(adjustmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commissionRecordId: 'cr1',
          fromAdminEarning: '80.00',
          toAdminEarning: '30.00',
          fromPlatformMargin: '80.00',
          toPlatformMargin: '30.00',
          adminId: 'admin1',
          reason: 'dispute partial refund',
        }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'commission.record_adjusted' }),
      expect.objectContaining({ tx: expect.anything() }), // in-txn outbox
    );
    expect(audit.writeAuditLog).toHaveBeenCalled();
  });

  it('does NOT overwrite originalAdminEarning on a second adjustment', async () => {
    const { svc, updateMany } = build({
      ...pending,
      originalAdminEarning: '80.00',
      adminEarning: '50.00',
    });
    await svc.adjustCommissionRecord('cr1', {
      newAdminEarning: 40,
      reason: 'second tweak',
      adminId: 'admin1',
    });
    const data = updateMany.mock.calls[0][0].data;
    expect(data.originalAdminEarning).toBeUndefined();
  });

  it('strips HTML tags from the reason before persisting', async () => {
    const { svc, updateMany, adjustmentCreate } = build(pending);
    await svc.adjustCommissionRecord('cr1', {
      newAdminEarning: 30,
      reason: '<img src=x onerror=alert(1)>refund per ticket',
      adminId: 'admin1',
    });
    expect(updateMany.mock.calls[0][0].data.adjustmentReason).not.toContain('<');
    expect(adjustmentCreate.mock.calls[0][0].data.reason).not.toContain('<');
  });

  it('rejects a reason shorter than 3 chars', async () => {
    const { svc, updateMany } = build(pending);
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'no',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a reason longer than 2000 chars', async () => {
    const { svc } = build(pending);
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'x'.repeat(2001),
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects a negative newAdminEarning', async () => {
    const { svc } = build(pending);
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: -5,
        reason: 'should fail',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects newAdminEarning above the order platform amount (upper bound)', async () => {
    const { svc, updateMany } = build(pending); // totalPlatformAmount = 100
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 150,
        reason: 'exceeds the platform cut',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['SETTLED', 'REFUNDED'])('rejects adjusting a %s record', async (status) => {
    const { svc, updateMany } = build({ ...pending, status });
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'too late',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects adjusting a record inside an APPROVED settlement (frozen totals)', async () => {
    const { svc, updateMany } = build(
      { ...pending, settlementId: 'set1' },
      { settlement: { status: 'APPROVED', cycleId: null } },
    );
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'cycle already approved',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('409 when the version-CAS loses (concurrent adjust)', async () => {
    const { svc } = build(pending, { claimCount: 0 });
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'concurrent',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('404 when the record is missing', async () => {
    const { svc } = build(null);
    await expect(
      svc.adjustCommissionRecord('cr1', {
        newAdminEarning: 30,
        reason: 'missing record',
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});
