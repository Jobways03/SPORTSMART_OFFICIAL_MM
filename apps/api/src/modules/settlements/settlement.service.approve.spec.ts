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
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettlementService } from './settlement.service';
import { MarkPaidDto } from './dtos/create-cycle.dto';

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
  // Phase 144 — approval now flips via updateMany (version-CAS).
  const settlementCycleUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
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
      updateMany: settlementCycleUpdateMany,
    },
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
      update: sellerSettlementUpdate,
      updateMany: sellerSettlementUpdateMany,
      count: sellerSettlementCount,
    },
    // Phase 146 — the mark-paid cycle rollup now counts franchise children too.
    franchiseSettlement: {
      count: jest.fn().mockResolvedValue(0),
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

  // Phase 159aa — SettlementService now also takes CommissionInvoiceService
  // (per-settlement commission tax invoice issuance at approve time).
  const commissionInvoice: any = {
    applyToCycleOnApprove: jest.fn().mockResolvedValue({
      cycleId: 'cyc-test',
      invoicesIssued: 0,
      invoicesSkipped: 0,
      invoicesFailed: 0,
      failedSettlementIds: [],
    }),
    issueForSettlement: jest.fn(),
  };
  // Phase 252 — tax config (commission-GST rate/base; only read at createCycle,
  // not approve — a default-returning stub is enough here).
  const taxConfig: any = {
    getSettlementTaxConfig: jest.fn().mockResolvedValue({
      gst: { rateBps: 1800, baseType: 'COMMISSION', enabled: true },
      tcs: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD', enabled: true },
      tds: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD', enabled: true },
    }),
  };
  const service = new SettlementService(
    prisma,
    audit,
    moneyDualWrite,
    tcsHook,
    tdsHook,
    commissionInvoice,
    taxConfig,
  );
  return {
    service,
    prisma,
    settlementCycleUpdate,
    settlementCycleUpdateMany,
    sellerSettlementUpdate,
    sellerSettlementUpdateMany,
    commissionRecordUpdateMany,
    tcsHook,
  };
}

// Phase 144 — a cycle whose stored totals match its live PENDING commission
// state, so the approve re-validation passes (no drift → no rejection).
const cleanCycle = (id: string, status: string) => ({
  id,
  status,
  totalAmount: '30.00',
  sellerSettlements: [
    {
      id: `${id}-ss1`,
      sellerName: 'Acme',
      totalPlatformMargin: '30.00',
      commissionRecords: [
        { id: 'cr1', status: 'PENDING', platformMargin: '30.00' },
      ],
    },
  ],
});

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

  it('flips DRAFT → APPROVED (version-CAS) and cascades to SellerSettlement rows', async () => {
    const {
      service,
      settlementCycleUpdateMany,
      sellerSettlementUpdateMany,
      tcsHook,
    } = buildService({
      cycle: cleanCycle('c-1', 'DRAFT'),
    });

    const result = await service.approveCycle('c-1', 'admin-1', 'looks good');

    expect(result.success).toBe(true);
    // Phase 144 — version-CAS flip: updateMany guarded on the source status,
    // stamping the approving admin + timestamp + notes.
    expect(settlementCycleUpdateMany).toHaveBeenCalledWith({
      where: { id: 'c-1', status: { in: ['DRAFT', 'PREVIEWED'] } },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedByAdminId: 'admin-1',
        approvedAt: expect.any(Date),
        approvalNotes: 'looks good',
      }),
    });
    // Status-guarded cascade — only PENDING settlements flip.
    expect(sellerSettlementUpdateMany).toHaveBeenCalledWith({
      where: { cycleId: 'c-1', status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
    expect(tcsHook.applyToCycleOnApprove).toHaveBeenCalledWith({
      cycleId: 'c-1',
      actorId: 'admin-1',
    });
  });

  it('also accepts a PREVIEWED cycle (the typical happy path)', async () => {
    const { service, settlementCycleUpdateMany } = buildService({
      cycle: cleanCycle('c-1', 'PREVIEWED'),
    });
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(true);
    expect(settlementCycleUpdateMany).toHaveBeenCalled();
  });

  it('swallows TCS hook failures — cycle stays APPROVED', async () => {
    const { service, settlementCycleUpdateMany, tcsHook } = buildService({
      cycle: cleanCycle('c-1', 'PREVIEWED'),
    });
    (tcsHook.applyToCycleOnApprove as jest.Mock).mockRejectedValueOnce(
      new Error('TCS upstream timeout'),
    );
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(true);
    expect(settlementCycleUpdateMany).toHaveBeenCalled();
  });

  it('rejects an empty cycle (no seller settlements)', async () => {
    const { service, settlementCycleUpdateMany } = buildService({
      cycle: { id: 'c-1', status: 'DRAFT', sellerSettlements: [] },
    });
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/empty cycle/i);
    expect(settlementCycleUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects when stored totals drifted from live commission state', async () => {
    const { service, settlementCycleUpdateMany } = buildService({
      cycle: {
        id: 'c-1',
        status: 'DRAFT',
        totalAmount: '30.00',
        sellerSettlements: [
          {
            id: 'c-1-ss1',
            sellerName: 'Acme',
            totalPlatformMargin: '30.00',
            // a record was held since creation → live PENDING margin is 20, not 30
            commissionRecords: [
              { id: 'cr1', status: 'PENDING', platformMargin: '20.00' },
              { id: 'cr2', status: 'ON_HOLD', platformMargin: '10.00' },
            ],
          },
        ],
      },
    });
    const result = await service.approveCycle('c-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/stale/i);
    expect(settlementCycleUpdateMany).not.toHaveBeenCalled();
  });

  it('409s when the version-CAS loses (concurrent approve)', async () => {
    const { service, settlementCycleUpdateMany } = buildService({
      cycle: cleanCycle('c-1', 'DRAFT'),
    });
    settlementCycleUpdateMany.mockResolvedValueOnce({ count: 0 });
    // ConflictAppException — the CAS lost; no double TCS/TDS run.
    await expect(service.approveCycle('c-1', 'admin-1')).rejects.toThrow(
      /changed concurrently/i,
    );
  });

  it('stamps a cycle_approved audit row', async () => {
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const { service } = (() => {
      const built = buildService({ cycle: cleanCycle('c-1', 'DRAFT') });
      (built.service as any).audit = audit;
      return built;
    })();
    await service.approveCycle('c-1', 'admin-9');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settlement.cycle_approved', actorId: 'admin-9' }),
    );
  });
});

describe('SettlementService.markSettlementPaid (Phase 15)', () => {
  const APPROVED_SETTLEMENT = {
    id: 'ss-1',
    cycleId: 'c-1',
    status: 'APPROVED',
    cycle: { id: 'c-1', status: 'APPROVED' },
    // markSettlementPaid derives the wired net from the gross settlement
    // (Decimal rupees + paise sibling) minus TCS/TDS/commission-GST. Provide a
    // coherent gross so that derivation reads a real number, not NaN/undefined.
    totalSettlementAmount: '1000.00',
    totalSettlementAmountInPaise: 100000n,
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

  it('flips the settlement to PAID (version-CAS) with UTR + actor + time', async () => {
    const {
      service,
      sellerSettlementUpdateMany,
      commissionRecordUpdateMany,
    } = buildService({
      settlement: APPROVED_SETTLEMENT,
    });

    await service.markSettlementPaid('ss-1', 'HDFC-UTR-12345', {
      adminId: 'admin-7',
      paymentMethod: 'NEFT',
    });

    // Phase 145 — version-CAS: updateMany guarded on a payable source status,
    // stamping the actor + payment metadata onto the row.
    expect(sellerSettlementUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ss-1', status: { in: ['APPROVED', 'FAILED'] } },
      data: expect.objectContaining({
        status: 'PAID',
        utrReference: 'HDFC-UTR-12345',
        paidAt: expect.any(Date),
        paidByAdminId: 'admin-7',
        paymentMethod: 'NEFT',
      }),
    });
    // Linked commission records flip to SETTLED in the same transaction.
    // Phase 137 — guarded on status PENDING so a record held/refunded after
    // cycle attach is never marked SETTLED.
    expect(commissionRecordUpdateMany).toHaveBeenCalledWith({
      where: { settlementId: 'ss-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'SETTLED' }),
    });
  });

  it('surfaces a friendly message on a duplicate UTR (P2002)', async () => {
    const { service, sellerSettlementUpdateMany } = buildService({
      settlement: APPROVED_SETTLEMENT,
    });
    sellerSettlementUpdateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await service.markSettlementPaid('ss-1', 'DUPUTR123456', {
      adminId: 'admin-7',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already recorded/i);
  });
});

describe('SettlementService.markSettlementFailed (Phase 145)', () => {
  const APPROVED = {
    id: 'ss-1',
    cycleId: 'c-1',
    sellerId: 's-1',
    status: 'APPROVED',
    cycle: { id: 'c-1', status: 'APPROVED' },
  };

  it('flips an APPROVED settlement to FAILED with the reason', async () => {
    const { service, sellerSettlementUpdateMany } = buildService({
      settlement: APPROVED,
    });
    const result = await service.markSettlementFailed('ss-1', 'bank reversed NEFT', {
      adminId: 'admin-7',
    });
    expect(result.success).toBe(true);
    expect(sellerSettlementUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ss-1', status: { in: ['APPROVED', 'FAILED'] } },
      data: { status: 'FAILED', paymentFailureReason: 'bank reversed NEFT' },
    });
  });

  it('rejects a too-short reason', async () => {
    const { service } = buildService({ settlement: APPROVED });
    const result = await service.markSettlementFailed('ss-1', 'no');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/reason/i);
  });

  it('refuses to fail an already-PAID settlement', async () => {
    const { service } = buildService({
      settlement: { ...APPROVED, status: 'PAID' },
    });
    const result = await service.markSettlementFailed('ss-1', 'too late now');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already-paid|reversal/i);
  });
});

describe('MarkPaidDto validation (Phase 145)', () => {
  it('rejects a UTR with markup / illegal chars (XSS-safe)', async () => {
    const dto = plainToInstance(MarkPaidDto, { utrReference: '<script>x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'utrReference')).toBe(true);
  });

  it('rejects a too-short UTR', async () => {
    const dto = plainToInstance(MarkPaidDto, { utrReference: 'abc' });
    expect((await validate(dto)).some((e) => e.property === 'utrReference')).toBe(true);
  });

  it('accepts a valid NEFT UTR + gateway payout id', async () => {
    for (const utr of ['HDFC0001234567890', 'pout_Nx9a-bc_123']) {
      const dto = plainToInstance(MarkPaidDto, { utrReference: utr });
      expect(await validate(dto)).toHaveLength(0);
    }
  });
});
