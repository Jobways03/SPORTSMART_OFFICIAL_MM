import { PayoutService } from './payout.service';

/**
 * Phase 0 (PR 0.3) — payout bank-response amount-check.
 *
 * The bank CSV is the source of truth that the operator uploads after
 * the export. Without an amount check, a CSV typo (extra zero, missing
 * decimal, wrong row) would flip the settlement to PAID with no
 * verification that the bank actually disbursed the right amount. The
 * service must now compare each PAID row's `paidAmountInPaise` against
 * the settlement's stored `totalSettlementAmountInPaise` and demote
 * any drift > 1 paise to a FAILED row, leaving the settlement APPROVED
 * for re-upload after correction.
 */

const settlementA = {
  id: 'set-A',
  totalSettlementAmountInPaise: 1_000_000n,        // ₹10,000
};
const settlementB = {
  id: 'set-B',
  totalSettlementAmountInPaise: 250_000n,          // ₹2,500
};

function makeBatch(payouts: Array<{ id: string; settlementId: string }>) {
  return {
    id: 'batch-1',
    status: 'EXPORTED' as const,
    payouts: payouts.map((p) => ({
      ...p,
      status: 'EXPORTED' as const,
    })),
  };
}

function buildService(opts: {
  batchPayouts: Array<{ id: string; settlementId: string }>;
  settlements: Array<{ id: string; totalSettlementAmountInPaise: bigint }>;
}) {
  const batch = makeBatch(opts.batchPayouts);

  const payoutUpdate = jest.fn().mockResolvedValue(undefined);
  const settlementUpdate = jest.fn().mockResolvedValue(undefined);
  const batchUpdate = jest.fn().mockResolvedValue(undefined);
  const payoutFindMany = jest.fn();

  const prisma = {
    payoutBatch: {
      findUnique: jest.fn().mockResolvedValue(batch),
      update: batchUpdate,
    },
    sellerSettlement: {
      findMany: jest.fn().mockResolvedValue(opts.settlements),
      update: settlementUpdate,
    },
    payout: {
      update: payoutUpdate,
      findMany: payoutFindMany.mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        payout: { update: payoutUpdate, findMany: payoutFindMany },
        sellerSettlement: { update: settlementUpdate },
        payoutBatch: { update: batchUpdate },
      }),
    ),
  } as any;

  // Pass-through stub: matches the production helper's flag-off behaviour.
  const moneyDualWrite = {
    applyPaise: (_m: string, d: any) => d,
    applyPaiseMany: (_m: string, rs: any[]) => rs,
    isApplicable: () => false,
  } as any;
  const service = new PayoutService(prisma, moneyDualWrite);
  return { service, prisma, payoutUpdate, settlementUpdate, batchUpdate };
}

describe('PayoutService.ingestBankResponse — Phase 0 amount-check', () => {
  it('marks the payout COMPLETED and the settlement PAID when paidAmountInPaise matches exactly', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'PAID',
          paidAmountInPaise: 1_000_000n,
          utrReference: 'UTR123',
        },
      ],
    });

    expect(mismatches).toEqual([]);
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-A' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          utrReference: 'UTR123',
          failureReason: null,
        }),
      }),
    );
    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: settlementA.id },
        data: expect.objectContaining({ status: 'PAID', utrReference: 'UTR123' }),
      }),
    );
  });

  it('allows ±1 paise rounding tolerance on the bank side', async () => {
    const { service, settlementUpdate, payoutUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'PAID',
          paidAmountInPaise: 999_999n, // -1 paise
        },
      ],
    });

    expect(mismatches).toEqual([]);
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(settlementUpdate).toHaveBeenCalled();
  });

  // ── Headline silent-loss case ──────────────────────────────────────

  it('REJECTS a mismatched row by demoting to FAILED and leaving the settlement APPROVED (the headline CSV-typo case)', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'PAID',                          // operator claims paid
          paidAmountInPaise: 100_000n,             // but the bank actually disbursed ₹1,000, not ₹10,000
          utrReference: 'UTR_OOPS',
        },
      ],
    });

    expect(mismatches).toEqual([
      {
        settlementId: settlementA.id,
        expectedInPaise: '1000000',
        actualInPaise: '100000',
      },
    ]);
    // Payout is FAILED with explicit reason
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-A' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringMatching(/^BANK_AMOUNT_MISMATCH:expected=1000000 actual=100000$/),
          paidAt: null,
        }),
      }),
    );
    // Settlement MUST NOT be flipped to PAID — operator must fix and re-upload
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('rejects when paidAmountInPaise is missing on a PAID row', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'PAID',
          // paidAmountInPaise intentionally omitted
        },
      ],
    });

    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringContaining('BANK_AMOUNT_MISSING'),
        }),
      }),
    );
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('processes good rows alongside bad rows (soft-fail per row)', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [
        { id: 'pay-A', settlementId: settlementA.id },
        { id: 'pay-B', settlementId: settlementB.id },
      ],
      settlements: [settlementA, settlementB],
    });

    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        // A: good
        { settlementId: settlementA.id, status: 'PAID', paidAmountInPaise: 1_000_000n },
        // B: typo
        { settlementId: settlementB.id, status: 'PAID', paidAmountInPaise: 1n },
      ],
    });

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].settlementId).toBe(settlementB.id);

    // A's payout is COMPLETED
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-A' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    // B's payout is FAILED
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-B' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringMatching(/^BANK_AMOUNT_MISMATCH/),
        }),
      }),
    );

    // Only A's settlement is flipped to PAID
    expect(settlementUpdate).toHaveBeenCalledTimes(1);
    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: settlementA.id } }),
    );
  });

  it('passes through FAILED rows unchanged (the verifier only gates PAID rows)', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'FAILED',
          failureReason: 'BENEFICIARY_NAME_MISMATCH',
        },
      ],
    });

    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'BENEFICIARY_NAME_MISMATCH',
        }),
      }),
    );
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('rejects an over-payment outside the ±1 paise tolerance', async () => {
    const { service, payoutUpdate, settlementUpdate } = buildService({
      batchPayouts: [{ id: 'pay-A', settlementId: settlementA.id }],
      settlements: [settlementA],
    });

    const { mismatches } = await service.ingestBankResponse({
      batchId: 'batch-1',
      rows: [
        {
          settlementId: settlementA.id,
          status: 'PAID',
          paidAmountInPaise: 1_000_010n, // +10 paise — outside tolerance
        },
      ],
    });

    expect(mismatches).toHaveLength(1);
    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(settlementUpdate).not.toHaveBeenCalled();
  });
});
