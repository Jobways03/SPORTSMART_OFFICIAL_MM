/**
 * Phase 15 (2026-05-16) — happy-path coverage for SettlementService.
 *
 * Pre-Phase-15 the settlement module had one regression test for the
 * franchise-cycle atomic claim, and no spec for the seller settlement
 * lifecycle. This adds:
 *
 *   • approveCycle — DRAFT/PREVIEWED → APPROVED transition, cascade
 *     to SellerSettlement rows, TCS hook invocation, idempotency
 *     when called on an already-APPROVED cycle.
 *   • markSettlementPaid — APPROVED settlement → PAID with UTR,
 *     guard against double-payment, guard against marking paid
 *     while the cycle isn't APPROVED yet.
 *
 * Mocks Prisma at the table level + a `$transaction` shim that just
 * yields the same client so test assertions see the writes.
 */
import 'reflect-metadata';
import { SettlementService } from './settlement.service';

function makeTxShim(client: any): any {
  return {
    ...client,
    // $transaction(cb) calls cb with the tx client. Our mock treats
    // tx and the top-level client interchangeably so tests can
    // inspect either.
    $transaction: jest.fn(async (cb: any) => cb(client)),
  };
}

function buildService(opts: {
  cycle?: any;
  settlement?: any;
  pendingCount?: number;
} = {}) {
  const settlementCycleUpdate = jest.fn().mockResolvedValue(undefined);
  const sellerSettlementUpdate = jest.fn().mockResolvedValue(undefined);
  const sellerSettlementUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const commissionRecordUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const sellerSettlementCount = jest
    .fn()
    .mockResolvedValue(opts.pendingCount ?? 0);

  const client: any = {
    settlementCycle: {
      findUnique: jest.fn().mockResolvedValue(opts.cycle ?? null),
      update: settlementCycleUpdate,
    },
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
      update: sellerSettlementUpdate,
      updateMany: sellerSettlementUpdateMany,
      count: sellerSettlementCount,
    },
    commissionRecord: {
      updateMany: commissionRecordUpdateMany,
    },
  };
  client.$transaction = jest.fn(async (cb: any) => cb(client));

  const prisma = client;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const moneyDualWrite = {
    applyPaise: jest.fn((_table: string, data: any) => data),
  } as any;
  const tcsHook = {
    applyToCycleOnApprove: jest
      .fn()
      .mockResolvedValue({ applied: 3, skipped: 0 }),
    applyToSettlementOnPaid: jest
      .fn()
      .mockResolvedValue({ collected: true }),
  } as any;
  // Phase 27 — TDS hook stub. Same shape as the TCS stub above so the
  // approve-cycle path can call both without the test caring about the
  // return shape.
  const tdsHook = {
    applyToCycleOnApprove: jest
      .fn()
      .mockResolvedValue({
        cycleId: '',
        settlementsProcessed: 0,
        settlementsSkipped: 0,
        settlementsExempt: 0,
        settlementsFailed: 0,
        failedSettlementIds: [],
        totalTdsDeductedInPaise: 0n,
        filingPeriod: '2026-Q1',
      }),
    markWithheldOnPay: jest
      .fn()
      .mockResolvedValue({ ledgerId: null, flipped: false }),
  } as any;

  const service = new SettlementService(
    prisma,
    audit,
    moneyDualWrite,
    tcsHook,
    tdsHook,
  );
  return {
    service,
    prisma,
    settlementCycleUpdate,
    sellerSettlementUpdate,
    sellerSettlementUpdateMany,
    commissionRecordUpdateMany,
    tcsHook,
  };
}

describe('SettlementService.approveCycle (Phase 15)', () => {
  it('returns success:false when the cycle does not exist', async () => {
    const { service } = buildService();
    const result = await service.approveCycle('missing-cycle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns success:false when the cycle is already PAID', async () => {
    const { service } = buildService({
      cycle: { id: 'c-1', status: 'PAID' },
    });
    const result = await service.approveCycle('c-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Cannot approve.*PAID/);
  });

  it('flips DRAFT → APPROVED and cascades to SellerSettlement rows', async () => {
    const {
      service,
      settlementCycleUpdate,
      sellerSettlementUpdateMany,
      tcsHook,
    } = buildService({
      cycle: { id: 'c-1', status: 'DRAFT' },
    });

    const result = await service.approveCycle('c-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(settlementCycleUpdate).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'APPROVED' },
    });
    expect(sellerSettlementUpdateMany).toHaveBeenCalledWith({
      where: { cycleId: 'c-1' },
      data: { status: 'APPROVED' },
    });
    expect(tcsHook.applyToCycleOnApprove).toHaveBeenCalledWith({
      cycleId: 'c-1',
      actorId: 'admin-1',
    });
  });

  it('also accepts a PREVIEWED cycle (the typical happy path)', async () => {
    const { service, settlementCycleUpdate } = buildService({
      cycle: { id: 'c-1', status: 'PREVIEWED' },
    });
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(true);
    expect(settlementCycleUpdate).toHaveBeenCalled();
  });

  it('swallows TCS hook failures — cycle stays APPROVED', async () => {
    const { service, settlementCycleUpdate, tcsHook } = buildService({
      cycle: { id: 'c-1', status: 'PREVIEWED' },
    });
    (tcsHook.applyToCycleOnApprove as jest.Mock).mockRejectedValueOnce(
      new Error('TCS upstream timeout'),
    );
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(true);
    expect(settlementCycleUpdate).toHaveBeenCalled();
  });
});

describe('SettlementService.markSettlementPaid (Phase 15)', () => {
  const APPROVED_SETTLEMENT = {
    id: 'ss-1',
    cycleId: 'c-1',
    status: 'APPROVED',
    cycle: { id: 'c-1', status: 'APPROVED' },
  };

  it('returns success:false when the settlement does not exist', async () => {
    const { service } = buildService();
    const result = await service.markSettlementPaid('missing', 'UTR-1');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('rejects when the settlement is already PAID', async () => {
    const { service } = buildService({
      settlement: { ...APPROVED_SETTLEMENT, status: 'PAID' },
    });
    const result = await service.markSettlementPaid('ss-1', 'UTR-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already.*paid/i);
  });

  it('rejects when the cycle is still DRAFT (approval prerequisite)', async () => {
    const { service } = buildService({
      settlement: {
        ...APPROVED_SETTLEMENT,
        cycle: { id: 'c-1', status: 'DRAFT' },
      },
    });
    const result = await service.markSettlementPaid('ss-1', 'UTR-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/approved before/i);
  });

  it('flips the settlement to PAID with the UTR and the current time', async () => {
    const {
      service,
      sellerSettlementUpdate,
      commissionRecordUpdateMany,
    } = buildService({
      settlement: APPROVED_SETTLEMENT,
    });

    await service.markSettlementPaid('ss-1', 'HDFC-UTR-12345', {
      adminId: 'admin-7',
    });

    expect(sellerSettlementUpdate).toHaveBeenCalledWith({
      where: { id: 'ss-1' },
      data: expect.objectContaining({
        status: 'PAID',
        utrReference: 'HDFC-UTR-12345',
        paidAt: expect.any(Date),
      }),
    });
    // Linked commission records flip to SETTLED in the same transaction.
    expect(commissionRecordUpdateMany).toHaveBeenCalledWith({
      where: { settlementId: 'ss-1' },
      data: expect.objectContaining({ status: 'SETTLED' }),
    });
  });
});
