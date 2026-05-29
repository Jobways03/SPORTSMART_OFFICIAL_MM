import { PayoutService } from './payout.service';
import { BadRequestAppException, ConflictAppException } from '../../core/exceptions';

/**
 * Phase 0 (PR 0.3) — payout bank-response amount-check (silent-money-loss
 * guard) + Phase 151 — bank-details gate, settlement payout lock, enriched +
 * injection-safe bank file with file hash, TCS/TDS compliance on ingest,
 * cycle auto-flip, and cancelBatch.
 */

// Shared cross-cutting deps (audit / tax hooks / bank decrypt / event bus).
function makeDeps() {
  return {
    moneyDualWrite: {
      applyPaise: (_m: string, d: any) => d,
      applyPaiseMany: (_m: string, rs: any[]) => rs,
      isApplicable: () => false,
    } as any,
    audit: { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any,
    tcsHook: { markCollectedOnPay: jest.fn().mockResolvedValue(undefined) } as any,
    tdsHook: { markWithheldOnPay: jest.fn().mockResolvedValue(undefined) } as any,
    bankDetails: { decrypt: jest.fn((enc: string) => `ACCT-${enc}`) } as any,
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ingestBankResponse — amount-check + Phase 151 lock-release / hooks / rollup
// ─────────────────────────────────────────────────────────────────────────

const settlementA = { id: 'set-A', cycleId: 'cyc-1', totalSettlementAmountInPaise: 1_000_000n };
const settlementB = { id: 'set-B', cycleId: 'cyc-1', totalSettlementAmountInPaise: 250_000n };

function buildIngest(opts: {
  batchPayouts: Array<{ id: string; settlementId: string; status?: string }>;
  settlements: Array<{ id: string; cycleId: string; totalSettlementAmountInPaise: bigint }>;
  sellerPendingAfter?: number;
  franchisePendingAfter?: number;
  payoutUpdateCount?: number;
  existingImport?: { id: string; importedAt: Date } | null;
}) {
  const batch = {
    id: 'batch-1',
    batchNumber: 'PB-X',
    status: 'EXPORTED' as const,
    payouts: opts.batchPayouts.map((p) => ({
      status: 'EXPORTED' as const,
      ...p,
    })),
  };
  // Phase 152 — the payout write is a status-CAS updateMany (count configurable
  // to exercise the ALREADY_FINALISED skip).
  const payoutUpdateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.payoutUpdateCount ?? 1 });
  const settlementUpdate = jest.fn().mockResolvedValue(undefined);
  const batchUpdate = jest.fn().mockResolvedValue(undefined);
  const cycleUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const importCreate = jest.fn().mockResolvedValue({ id: 'imp-1' });
  const rowCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const deps = makeDeps();

  const prisma = {
    payoutBatch: { findUnique: jest.fn().mockResolvedValue(batch), update: batchUpdate },
    sellerSettlement: {
      findMany: jest.fn().mockResolvedValue(opts.settlements),
      update: settlementUpdate,
    },
    payout: { findMany: jest.fn().mockResolvedValue([]) },
    // Phase 152 — file-hash dedup pre-check (null = not previously ingested).
    bankResponseImport: {
      findFirst: jest.fn().mockResolvedValue(opts.existingImport ?? null),
    },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        payout: { updateMany: payoutUpdateMany, findMany: jest.fn().mockResolvedValue([]) },
        sellerSettlement: {
          update: settlementUpdate,
          count: jest.fn().mockResolvedValue(opts.sellerPendingAfter ?? 1),
        },
        franchiseSettlement: {
          count: jest.fn().mockResolvedValue(opts.franchisePendingAfter ?? 0),
        },
        payoutBatch: { update: batchUpdate },
        settlementCycle: { updateMany: cycleUpdateMany },
        bankResponseImport: { create: importCreate },
        bankResponseRow: { createMany: rowCreateMany },
      }),
    ),
  } as any;

  const service = new PayoutService(
    prisma,
    deps.moneyDualWrite,
    deps.audit,
    deps.tcsHook,
    deps.tdsHook,
    deps.bankDetails,
    deps.eventBus,
  );
  return {
    service,
    prisma,
    payoutUpdateMany,
    settlementUpdate,
    cycleUpdateMany,
    importCreate,
    rowCreateMany,
    deps,
  };
}

/** Calls to sellerSettlement.update whose data flips status to PAID. */
const paidFlips = (m: jest.Mock) =>
  m.mock.calls.filter((c: any) => c[0]?.data?.status === 'PAID');

describe('PayoutService.ingestBankResponse — amount-check', () => {
  it('marks payout COMPLETED (CAS) + settlement PAID + persists bank amount on an exact match', async () => {
    const { service, payoutUpdateMany, settlementUpdate, importCreate } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });
    const { mismatches, skipped } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n, utrReference: 'UTR123' }],
    });
    expect(mismatches).toEqual([]);
    expect(skipped).toEqual([]);
    expect(payoutUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-A', status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        data: expect.objectContaining({
          status: 'COMPLETED',
          utrReference: 'UTR123',
          bankPaidAmountInPaise: 1_000_000n,
        }),
      }),
    );
    expect(paidFlips(settlementUpdate)).toHaveLength(1);
    // Phase 152 — an import audit row is always written.
    expect(importCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ successCount: 1, source: 'MANUAL_ENTRY' }),
      }),
    );
  });

  it('allows ±1 paise tolerance', async () => {
    const { service, settlementUpdate } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });
    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 999_999n }],
    });
    expect(mismatches).toEqual([]);
    expect(paidFlips(settlementUpdate)).toHaveLength(1);
  });

  it('demotes a mismatched row to FAILED, surfaces the reason on the settlement, no PAID flip', async () => {
    const { service, payoutUpdateMany, settlementUpdate } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });
    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 100_000n, utrReference: 'UTR_OOPS' }],
    });
    expect(mismatches).toEqual([
      { settlementId: settlementA.id, expectedInPaise: '1000000', actualInPaise: '100000' },
    ]);
    expect(payoutUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringMatching(/^BANK_AMOUNT_MISMATCH:expected=1000000 actual=100000$/),
        }),
      }),
    );
    expect(paidFlips(settlementUpdate)).toHaveLength(0);
    // Phase 151/152 — failed row releases the lock + surfaces the reason.
    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: settlementA.id },
        data: expect.objectContaining({
          payoutBatchId: null,
          paymentFailureReason: expect.stringContaining('BANK_AMOUNT_MISMATCH'),
        }),
      }),
    );
  });

  it('rejects a PAID row missing paidAmountInPaise', async () => {
    const { service, payoutUpdateMany, settlementUpdate } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });
    await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID' }],
    });
    expect(payoutUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('BANK_AMOUNT_MISSING') }) }),
    );
    expect(paidFlips(settlementUpdate)).toHaveLength(0);
  });

  it('soft-fails per row (good + bad together)', async () => {
    const { service, settlementUpdate } = buildIngest({
      batchPayouts: [
        { id: 'pay-A', settlementId: settlementA.id },
        { id: 'pay-B', settlementId: settlementB.id },
      ],
      settlements: [settlementA, settlementB],
    });
    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        { settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n },
        { settlementId: settlementB.id, status: 'PAID', paidAmountInPaise: 1n },
      ],
    });
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.settlementId).toBe(settlementB.id);
    // Only A flipped to PAID.
    expect(paidFlips(settlementUpdate)).toHaveLength(1);
    expect(paidFlips(settlementUpdate)[0]![0].where).toEqual({ id: settlementA.id });
  });

  it('reports an unknown settlement row as SKIPPED:NOT_IN_BATCH (not silently dropped)', async () => {
    const { service, payoutUpdateMany } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });
    const { skipped } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: 'not-in-batch', status: 'PAID', paidAmountInPaise: 1n }],
    });
    expect(skipped).toEqual([{ settlementId: 'not-in-batch', reason: 'NOT_IN_BATCH' }]);
    expect(payoutUpdateMany).not.toHaveBeenCalled();
  });

  it('skips an already-COMPLETED payout row (per-row idempotency)', async () => {
    const { service, payoutUpdateMany } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id, status: 'COMPLETED' }],
      settlements: [settlementA],
    });
    const { skipped } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n }],
    });
    expect(skipped).toEqual([{ settlementId: settlementA.id, reason: 'ALREADY_COMPLETED' }]);
    expect(payoutUpdateMany).not.toHaveBeenCalled();
  });

  it('blocks re-ingesting the same file (fileHash already imported)', async () => {
    const { service } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
      existingImport: { id: 'imp-old', importedAt: new Date('2026-05-26') },
    });
    await expect(
      service.ingestBankResponse({
        batchId: 'batch-1',
        rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n }],
        source: 'FILE_UPLOAD',
        fileHash: 'abc',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('fires TCS + TDS hooks and the cycle auto-flip on a successful PAID flip', async () => {
    const { service, deps, cycleUpdateMany } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
      sellerPendingAfter: 0,
      franchisePendingAfter: 0,
    });
    await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n }],
    });
    expect(deps.tcsHook.markCollectedOnPay).toHaveBeenCalledWith({ settlementId: settlementA.id });
    expect(deps.tdsHook.markWithheldOnPay).toHaveBeenCalledWith({ settlementId: settlementA.id });
    // All children paid → cycle flips to PAID.
    expect(cycleUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAID' } }),
    );
    expect(deps.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYOUT_BATCH_INGESTED' }),
    );
  });

  it('does NOT flip the cycle while a sibling settlement is still pending', async () => {
    const { service, cycleUpdateMany } = buildIngest({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
      sellerPendingAfter: 1, // another seller still unpaid
    });
    await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [{ settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n }],
    });
    expect(cycleUpdateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createBatch — bank-details gate + settlement lock
// ─────────────────────────────────────────────────────────────────────────

function buildCreate(opts: {
  settlements: any[];
  sellers: any[];
  bankRows: any[];
  lockCount?: number;
}) {
  const deps = makeDeps();
  const batchCreate = jest.fn().mockResolvedValue({ id: 'batch-new' });
  const settlementUpdateMany = jest.fn().mockResolvedValue({
    count: opts.lockCount ?? opts.settlements.length,
  });
  const payoutCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    sellerSettlement: { findMany: jest.fn().mockResolvedValue(opts.settlements) },
    seller: { findMany: jest.fn().mockResolvedValue(opts.sellers) },
    sellerBankDetails: { findMany: jest.fn().mockResolvedValue(opts.bankRows) },
    dispute: { findMany: jest.fn().mockResolvedValue([]) },
    subOrder: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        payoutBatch: {
          create: batchCreate,
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'batch-new', batchNumber: 'PB-N', settlementCount: 0, payouts: [] }),
        },
        sellerSettlement: { updateMany: settlementUpdateMany },
        payout: { createMany: payoutCreateMany },
      }),
    ),
  } as any;
  const service = new PayoutService(
    prisma, deps.moneyDualWrite, deps.audit, deps.tcsHook, deps.tdsHook, deps.bankDetails, deps.eventBus,
  );
  return { service, settlementUpdateMany, payoutCreateMany, deps };
}

const okSeller = (id: string) => ({ id, verificationStatus: 'VERIFIED', isDeleted: false, status: 'ACTIVE' });
const okBank = (sellerId: string) => ({ sellerId, ifscCode: 'HDFC0001234', accountNumberLast4: '4321' });
const sett = (id: string, sellerId: string) => ({
  id, sellerId, totalSettlementAmount: '100.00', totalSettlementAmountInPaise: 10_000n,
});

describe('PayoutService.createBatch — Phase 151 gates + lock', () => {
  it('skips a seller with missing / invalid bank details (INVALID_BANK_DETAILS)', async () => {
    const { service } = buildCreate({
      settlements: [sett('s1', 'sel1'), sett('s2', 'sel2')],
      sellers: [okSeller('sel1'), okSeller('sel2')],
      // sel2 has a bad IFSC.
      bankRows: [okBank('sel1'), { sellerId: 'sel2', ifscCode: 'BAD', accountNumberLast4: '1111' }],
      lockCount: 1,
    });
    const { skipped } = await service.createBatch({ cycleId: 'cyc-1', actor: { adminId: 'a1' } });
    expect(skipped).toEqual([
      expect.objectContaining({ sellerId: 'sel2', reason: expect.stringContaining('INVALID_BANK_DETAILS') }),
    ]);
  });

  it('locks the eligible settlements into the batch (payoutBatchId, CAS on null)', async () => {
    const { service, settlementUpdateMany } = buildCreate({
      settlements: [sett('s1', 'sel1')],
      sellers: [okSeller('sel1')],
      bankRows: [okBank('sel1')],
    });
    await service.createBatch({ cycleId: 'cyc-1', actor: { adminId: 'a1' } });
    expect(settlementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['s1'] }, payoutBatchId: null, status: 'APPROVED' },
        data: { payoutBatchId: 'batch-new' },
      }),
    );
  });

  it('aborts (409) if the lock count drops (a settlement was claimed concurrently)', async () => {
    const { service } = buildCreate({
      settlements: [sett('s1', 'sel1'), sett('s2', 'sel2')],
      sellers: [okSeller('sel1'), okSeller('sel2')],
      bankRows: [okBank('sel1'), okBank('sel2')],
      lockCount: 1, // only 1 of 2 locked → race
    });
    await expect(
      service.createBatch({ cycleId: 'cyc-1', actor: { adminId: 'a1' } }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('throws when every settlement is blocked', async () => {
    const { service } = buildCreate({
      settlements: [sett('s1', 'sel1')],
      sellers: [okSeller('sel1')],
      bankRows: [], // no bank details → all blocked
    });
    await expect(
      service.createBatch({ cycleId: 'cyc-1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateExport — enriched, injection-safe bank file + hash
// ─────────────────────────────────────────────────────────────────────────

describe('PayoutService.generateExport — bank file (Phase 151/153)', () => {
  function buildExport(opts: {
    beneficiaryName?: string;
    status?: 'DRAFT' | 'EXPORTED' | 'COMPLETED';
    fileHash?: string | null;
    preferred?: string | null;
  } = {}) {
    const deps = makeDeps();
    const batch = {
      id: 'batch-1',
      batchNumber: 'PB-EXP',
      status: opts.status ?? 'DRAFT',
      fileHash: opts.fileHash ?? null,
      payouts: [
        { id: 'p1', settlementId: 'set-A', sellerId: 'sel1', amount: '100.00', amountInPaise: 10_000n },
      ],
    };
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const payoutUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      payoutBatch: { findUnique: jest.fn().mockResolvedValue(batch) },
      sellerBankDetails: {
        findMany: jest.fn().mockResolvedValue([
          {
            sellerId: 'sel1',
            accountHolderName: opts.beneficiaryName ?? 'Acme Sports',
            accountNumberEnc: 'ENC1',
            ifscCode: 'HDFC0001234',
            preferredPayoutMethod: opts.preferred ?? null,
          },
        ]),
      },
      sellerSettlement: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'set-A', cycle: { periodStart: new Date('2026-05-01'), periodEnd: new Date('2026-05-31') } },
        ]),
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          payoutBatch: { updateMany: batchUpdateMany },
          payout: { updateMany: payoutUpdateMany },
        }),
      ),
    } as any;
    const service = new PayoutService(
      prisma, deps.moneyDualWrite, deps.audit, deps.tcsHook, deps.tdsHook, deps.bankDetails, deps.eventBus,
    );
    return { service, batchUpdateMany, payoutUpdateMany, deps };
  }

  it('emits beneficiary / decrypted account / IFSC / narration columns', async () => {
    const { service, deps } = buildExport({ beneficiaryName: 'Acme Sports' });
    const csv = await service.generateExport('batch-1', { adminId: 'a1' });
    expect(csv).toContain('batch_reference,settlement_id,seller_id,beneficiary_name,account_number,ifsc,amount,method,narration');
    expect(csv).toContain('Acme Sports');
    expect(csv).toContain('ACCT-ENC1'); // decrypt() output
    expect(csv).toContain('HDFC0001234');
    expect(deps.bankDetails.decrypt).toHaveBeenCalledWith('ENC1');
  });

  it('neutralises a formula-injection beneficiary name', async () => {
    const { service } = buildExport({ beneficiaryName: '=cmd|/c calc' });
    const csv = await service.generateExport('batch-1');
    expect(csv).toContain("'=cmd|/c calc");
  });

  it('first export (DRAFT) flips via a status-CAS + stores the hash + audits EXPORTED', async () => {
    const { service, batchUpdateMany, deps } = buildExport({ status: 'DRAFT' });
    await service.generateExport('batch-1', { adminId: 'a1' });
    expect(batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1', status: 'DRAFT' },
        data: expect.objectContaining({
          status: 'EXPORTED',
          fileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(deps.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYOUT_BATCH_EXPORTED' }),
    );
  });

  it('re-download (EXPORTED) returns the file WITHOUT mutating + audits RE_DOWNLOADED', async () => {
    const { service, batchUpdateMany, payoutUpdateMany, deps } = buildExport({
      status: 'EXPORTED',
    });
    const csv = await service.generateExport('batch-1', { adminId: 'a1' });
    expect(csv).toContain('beneficiary_name');
    expect(batchUpdateMany).not.toHaveBeenCalled();
    expect(payoutUpdateMany).not.toHaveBeenCalled();
    expect(deps.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYOUT_BATCH_RE_DOWNLOADED' }),
    );
  });

  it('flags drift on re-download when the regenerated file differs from the stored hash', async () => {
    const { service, deps } = buildExport({ status: 'EXPORTED', fileHash: 'stale-hash' });
    await service.generateExport('batch-1', { adminId: 'a1' });
    expect(deps.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ driftDetected: true }),
      }),
    );
  });

  it('honours a seller preferred payout method within RBI caps', async () => {
    // ₹100 would route UPI by amount; the seller prefers NEFT.
    const { service } = buildExport({ preferred: 'NEFT' });
    const csv = await service.generateExport('batch-1');
    expect(csv).toContain(',NEFT,');
  });

  it('refuses to export a COMPLETED batch', async () => {
    const { service } = buildExport({ status: 'COMPLETED' });
    await expect(service.generateExport('batch-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});

describe('PayoutService.routePayoutMethod (Phase 153 preference)', () => {
  const deps = makeDeps();
  const svc = new PayoutService(
    {} as any, deps.moneyDualWrite, deps.audit, deps.tcsHook, deps.tdsHook, deps.bankDetails, deps.eventBus,
  );
  const UPI = 50_00n; // ₹50
  const MID = 150_000_00n; // ₹1.5L
  const BIG = 300_000_00n; // ₹3L

  it('routes by amount when no preference', () => {
    expect(svc.routePayoutMethod(UPI)).toBe('UPI');
    expect(svc.routePayoutMethod(MID)).toBe('IMPS');
    expect(svc.routePayoutMethod(BIG)).toBe('NEFT');
  });

  it('honours a valid preference (NEFT for a small amount)', () => {
    expect(svc.routePayoutMethod(UPI, 'NEFT')).toBe('NEFT');
    expect(svc.routePayoutMethod(MID, 'NEFT')).toBe('NEFT');
  });

  it('ignores a preference the amount exceeds (UPI on ₹3L → amount-based NEFT)', () => {
    expect(svc.routePayoutMethod(BIG, 'UPI')).toBe('NEFT');
    expect(svc.routePayoutMethod(BIG, 'IMPS')).toBe('NEFT');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// cancelBatch
// ─────────────────────────────────────────────────────────────────────────

describe('PayoutService.cancelBatch — Phase 151', () => {
  function buildCancel(status: string) {
    const deps = makeDeps();
    const settlementUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const payoutUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const batchUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      payoutBatch: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'b', status, payouts: [] })
          .mockResolvedValue({ id: 'b', status: 'CANCELLED', payouts: [] }),
        update: batchUpdate,
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          sellerSettlement: { updateMany: settlementUpdateMany },
          payout: { updateMany: payoutUpdateMany },
          payoutBatch: { update: batchUpdate },
        }),
      ),
    } as any;
    const service = new PayoutService(
      prisma, deps.moneyDualWrite, deps.audit, deps.tcsHook, deps.tdsHook, deps.bankDetails, deps.eventBus,
    );
    return { service, settlementUpdateMany, payoutUpdateMany, batchUpdate, deps };
  }

  it('cancels a DRAFT batch + releases the settlement lock + audits', async () => {
    const { service, settlementUpdateMany, payoutUpdateMany, batchUpdate, deps } = buildCancel('DRAFT');
    await service.cancelBatch('b', 'created in error', { adminId: 'a1' });
    expect(settlementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { payoutBatchId: 'b' }, data: { payoutBatchId: null } }),
    );
    expect(payoutUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(deps.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYOUT_BATCH_CANCELLED' }),
    );
  });

  it('refuses to cancel a COMPLETED batch (money already moved)', async () => {
    const { service } = buildCancel('COMPLETED');
    await expect(service.cancelBatch('b', 'too late')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('requires a reason (min 3 chars)', async () => {
    const { service } = buildCancel('DRAFT');
    await expect(service.cancelBatch('b', 'no')).rejects.toBeInstanceOf(BadRequestAppException);
  });
});
