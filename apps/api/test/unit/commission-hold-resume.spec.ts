// Phase 137 — admin commission Hold/Resume. FSM-guarded (PENDING→ON_HOLD,
// ON_HOLD→prev), CAS on the source state, writes hold-history + a
// transactional commission.held/resumed event + audit. An admin hold is
// distinct from a system return-freeze (heldByAdminId) and a cycled record
// (settlementId) can't be held.

import { CommissionProcessorService } from '../../src/modules/commission/application/services/commission-processor.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

function build(record: any, opts: { claimCount?: number } = {}) {
  const holdHistoryCreate = jest.fn().mockResolvedValue({});
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.claimCount ?? 1 });
  const findUnique = jest.fn().mockResolvedValue(record);
  const tx = {
    commissionRecord: { findUnique, updateMany },
    commissionHoldHistory: { create: holdHistoryCreate },
  };
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new CommissionProcessorService(
    {} as any, // commissionRepo
    {} as any, // redis
    prisma as any,
    eventBus as any,
    {} as any, // ordersFacade
    {} as any, // moneyDualWrite
    {} as any, // env
    audit as any,
  );
  return { svc, eventBus, audit, updateMany, holdHistoryCreate };
}

const pending = {
  id: 'cr1',
  status: 'PENDING',
  settlementId: null,
  sellerId: 's1',
  orderNumber: 'O1',
  previousStatus: null,
  heldByAdminId: null,
};

describe('CommissionProcessorService.holdCommissionRecord (Phase 137)', () => {
  it('holds a PENDING, un-cycled record: CAS + history + transactional event + audit', async () => {
    const { svc, updateMany, holdHistoryCreate, eventBus, audit } = build(pending);
    await svc.holdCommissionRecord('cr1', 'admin1', 'fraud suspicion');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr1', status: 'PENDING', settlementId: null },
        data: expect.objectContaining({
          status: 'ON_HOLD',
          previousStatus: 'PENDING',
          heldByAdminId: 'admin1',
        }),
      }),
    );
    expect(holdHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'HOLD', actorId: 'admin1' }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'commission.held' }),
      expect.objectContaining({ tx: expect.anything() }), // in-txn outbox
    );
    expect(audit.writeAuditLog).toHaveBeenCalled();
  });

  it('rejects a hold reason shorter than 5 chars', async () => {
    const { svc } = build(pending);
    await expect(
      svc.holdCommissionRecord('cr1', 'admin1', 'no'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it.each(['SETTLED', 'REFUNDED', 'ON_HOLD'])(
    'rejects holding a %s record',
    async (status) => {
      const { svc, updateMany } = build({ ...pending, status });
      await expect(
        svc.holdCommissionRecord('cr1', 'admin1', 'fraud suspicion'),
      ).rejects.toBeInstanceOf(BadRequestAppException);
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects holding a record already attached to a settlement cycle', async () => {
    const { svc, updateMany } = build({ ...pending, settlementId: 'cyc1' });
    await expect(
      svc.holdCommissionRecord('cr1', 'admin1', 'fraud suspicion'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('409 when the CAS loses (concurrent state change)', async () => {
    const { svc } = build(pending, { claimCount: 0 });
    await expect(
      svc.holdCommissionRecord('cr1', 'admin1', 'fraud suspicion'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('404 when the record is missing', async () => {
    const { svc } = build(null);
    await expect(
      svc.holdCommissionRecord('cr1', 'admin1', 'fraud suspicion'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('CommissionProcessorService.resumeCommissionRecord (Phase 137)', () => {
  const held = {
    id: 'cr1',
    status: 'ON_HOLD',
    heldByAdminId: 'admin1',
    previousStatus: 'PENDING',
    sellerId: 's1',
    orderNumber: 'O1',
  };

  it('resumes an admin-held record to its previousStatus + history + event', async () => {
    const { svc, updateMany, holdHistoryCreate, eventBus } = build(held);
    await svc.resumeCommissionRecord('cr1', 'admin2', 'cleared review');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr1', status: 'ON_HOLD', heldByAdminId: { not: null } },
        data: expect.objectContaining({
          status: 'PENDING',
          resumedByAdminId: 'admin2',
          heldByAdminId: null,
        }),
      }),
    );
    expect(holdHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESUME' }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'commission.resumed' }),
      expect.objectContaining({ tx: expect.anything() }),
    );
  });

  it('refuses to resume a SYSTEM-frozen record (heldByAdminId null) — that lifts via the returns flow', async () => {
    const { svc, updateMany } = build({ ...held, heldByAdminId: null });
    await expect(
      svc.resumeCommissionRecord('cr1', 'admin2'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects resuming a record that is not ON_HOLD', async () => {
    const { svc } = build({ ...held, status: 'PENDING' });
    await expect(
      svc.resumeCommissionRecord('cr1', 'admin2'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});
