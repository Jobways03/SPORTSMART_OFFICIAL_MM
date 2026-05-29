// Phase 155 — affiliate payout approval & execution: approve CAS, mark-paid
// (UTR required + no REQUESTED shortcut + paidById), mark-failed (failedById +
// status-filtered release), reject (REJECTED + rejected* columns), all with a
// status-history row + audit + event.

import { Prisma } from '@prisma/client';
import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../src/core/exceptions';

const D = (v: string | number) => new Prisma.Decimal(v);

function build(opts: { status?: string; approveCasCount?: number } = {}) {
  const row = {
    id: 'p1',
    affiliateId: 'a1',
    status: opts.status ?? 'REQUESTED',
    financialYear: '2026-27',
    grossAmount: D(1000),
    tdsAmount: D(0),
    netAmount: D(1000),
    processedAt: null,
    // Phase 159h — markPaid now re-checks the affiliate is ACTIVE.
    affiliate: { status: 'ACTIVE' },
  };
  const requestUpdate = jest.fn(async (args: any) => ({ ...row, ...args.data }));
  const requestUpdateMany = jest.fn().mockResolvedValue({ count: opts.approveCasCount ?? 1 });
  const findUniqueOrThrow = jest.fn(async () => ({ ...row, status: 'APPROVED' }));
  const commissionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tdsUpsert = jest.fn().mockResolvedValue({});
  const historyCreate = jest.fn().mockResolvedValue({});

  const tx = {
    affiliatePayoutRequest: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: requestUpdate,
      updateMany: requestUpdateMany,
      findUniqueOrThrow,
    },
    affiliateCommission: { updateMany: commissionUpdateMany },
    affiliateTdsRecord: { upsert: tdsUpsert },
    // Phase 159e — §194-O ledger lifecycle (WITHHELD at mark-paid; dropped on
    // fail/reject). Best-effort mocks; the assertions here don't depend on them.
    affiliateTds194OLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    affiliatePayoutRequestStatusHistory: { create: historyCreate },
  };
  const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) } as any;
  const env = { getBoolean: jest.fn(() => true) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;

  const svc = new AffiliatePayoutService(prisma, {} as any, env, audit, eventBus);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, requestUpdate, requestUpdateMany, commissionUpdateMany, tdsUpsert, historyCreate, audit, eventBus };
}

describe('AffiliatePayoutService.approve (Phase 155)', () => {
  it('flips REQUESTED → APPROVED via a status-CAS + history + audit/event', async () => {
    const { svc, requestUpdateMany, historyCreate, audit, eventBus } = build();
    await svc.approve({ payoutRequestId: 'p1', adminId: 'admin1' });
    expect(requestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', status: 'REQUESTED' },
        data: expect.objectContaining({ status: 'APPROVED', approvedById: 'admin1' }),
      }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'APPROVED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'affiliate.payout.approved' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'affiliate.payout.approved' }),
    );
  });

  it('throws Conflict when the CAS affects 0 rows (concurrent approve)', async () => {
    const { svc } = build({ approveCasCount: 0 });
    await expect(svc.approve({ payoutRequestId: 'p1', adminId: 'admin1' })).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });
});

describe('AffiliatePayoutService.markPaid (Phase 155)', () => {
  it('requires a UTR (transactionRef)', async () => {
    const { svc } = build({ status: 'APPROVED' });
    await expect(
      svc.markPaid({ payoutRequestId: 'p1', adminId: 'admin1', transactionRef: '' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('refuses to mark paid straight from REQUESTED (must be APPROVED first)', async () => {
    const { svc } = build({ status: 'REQUESTED' });
    await expect(
      svc.markPaid({ payoutRequestId: 'p1', adminId: 'admin1', transactionRef: 'UTR12345' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('APPROVED → PAID persists paidById + UTR + cascades + TDS + history + audit', async () => {
    const { svc, requestUpdate, commissionUpdateMany, tdsUpsert, historyCreate, audit } = build({
      status: 'APPROVED',
    });
    await svc.markPaid({ payoutRequestId: 'p1', adminId: 'admin1', transactionRef: 'UTR12345' });
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID', paidById: 'admin1', transactionRef: 'UTR12345' }),
      }),
    );
    expect(commissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
    expect(tdsUpsert).toHaveBeenCalled();
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'PAID' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'affiliate.payout.paid' }),
    );
  });
});

describe('AffiliatePayoutService.markFailed (Phase 155)', () => {
  it('persists failedById + releases only non-PAID commissions + history', async () => {
    const { svc, requestUpdate, commissionUpdateMany, historyCreate } = build({ status: 'APPROVED' });
    await svc.markFailed({ payoutRequestId: 'p1', adminId: 'admin1', reason: 'bank rejected' });
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failedById: 'admin1' }) }),
    );
    expect(commissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'PAID' } }),
        data: { payoutRequestId: null },
      }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'FAILED' }) }),
    );
  });

  it('cannot fail a PAID payout', async () => {
    const { svc } = build({ status: 'PAID' });
    await expect(
      svc.markFailed({ payoutRequestId: 'p1', adminId: 'admin1', reason: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('AffiliatePayoutService.reject (Phase 155)', () => {
  it('writes REJECTED status + rejected* columns (not the bank-FAILED columns)', async () => {
    const { svc, requestUpdate, historyCreate, audit } = build({ status: 'REQUESTED' });
    await svc.reject({ payoutRequestId: 'p1', adminId: 'admin1', reason: 'invalid claim' });
    const data = requestUpdate.mock.calls[0]![0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.rejectedById).toBe('admin1');
    expect(data.rejectionReason).toBe('invalid claim');
    expect(data.failedAt).toBeUndefined();
    expect(data.failureReason).toBeUndefined();
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'REJECTED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'affiliate.payout.rejected' }),
    );
  });

  it('only rejects from REQUESTED', async () => {
    const { svc } = build({ status: 'APPROVED' });
    await expect(
      svc.reject({ payoutRequestId: 'p1', adminId: 'admin1', reason: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('strips HTML from the reason', async () => {
    const { svc, requestUpdate } = build({ status: 'REQUESTED' });
    await svc.reject({ payoutRequestId: 'p1', adminId: 'admin1', reason: '<b>spam</b>fraud' });
    expect(requestUpdate.mock.calls[0]![0].data.rejectionReason).toBe('spamfraud');
  });
});
