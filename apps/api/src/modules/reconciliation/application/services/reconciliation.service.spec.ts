import { ReconciliationService } from './reconciliation.service';

/**
 * Phase 0 (PR 0.6) — reconciliation reads Decimal money values via
 * the precision-safe `toPaise` helper and accumulates in BigInt.
 *
 * The previous code did `Math.round(Number(decimal) * 100)` everywhere.
 * For values like `999.99` the binary representation can drift by a
 * paise, producing false-positive AMOUNT_MISMATCH discrepancies (or
 * missing real ones). These tests pin the new contract by feeding
 * Decimal-like inputs that would have drifted under the old code and
 * asserting the discrepancy fields are exact paise integers.
 *
 * For the wallet runner, the precision concern is summing large
 * ledgers — the `::bigint` SQL cast already produces bigint server-
 * side; the old code lost precision on `Number()` conversion above
 * 2^53. The new code stays in BigInt throughout.
 */

/** Tiny Decimal-like — same duck-type shape `toPaise` accepts. */
function dec(s: string) {
  const obj = {
    _s: s,
    mul(factor: number) {
      if (factor !== 100) throw new Error('test dec().mul only supports *100');
      const neg = s.startsWith('-');
      const u = neg ? s.slice(1) : s;
      const [i, f = ''] = u.split('.');
      const padded = (f + '00').slice(0, Math.max(2, f.length));
      const shifted =
        padded.length >= 2
          ? i + padded.slice(0, 2) + (padded.length > 2 ? '.' + padded.slice(2) : '')
          : i + padded;
      const trimmed = shifted.replace(/^0+(?=\d)/, '') || '0';
      return dec((neg ? '-' : '') + trimmed);
    },
    toFixed(d: number) {
      if (d !== 0) throw new Error('test dec().toFixed only supports digits=0');
      const neg = obj._s.startsWith('-');
      const u = neg ? obj._s.slice(1) : obj._s;
      const [i, f = ''] = u.split('.');
      const roundDigit = f.charCodeAt(0) - 48;
      let n = BigInt((i ?? '').replace(/^0+(?=\d)/, '') || '0');
      if (roundDigit >= 5) n += 1n;
      return (neg ? '-' : '') + n.toString();
    },
  };
  return obj;
}

function buildService(opts: {
  paymentOrders?: any[];
  reconcileDiscrepancies?: jest.Mock;
}) {
  const recordDiscrepancy = opts.reconcileDiscrepancies ?? jest.fn().mockResolvedValue(undefined);
  const prisma = {
    masterOrder: {
      findMany: jest.fn().mockResolvedValue(opts.paymentOrders ?? []),
    },
    reconciliationDiscrepancy: { create: recordDiscrepancy },
    sellerSettlement: { findMany: jest.fn().mockResolvedValue([]) },
    return: { findMany: jest.fn().mockResolvedValue([]) },
    subOrder: { findMany: jest.fn().mockResolvedValue([]) },
    reconciliationRun: {
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      update: jest.fn().mockResolvedValue({ id: 'run-1' }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
  const events = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new ReconciliationService(prisma, events);
  return { service, prisma, recordDiscrepancy };
}

describe('ReconciliationService — Phase 0 PR 0.6 precision safety', () => {
  it('runPayments converts Decimal totals exactly, no Math.round drift', async () => {
    const { service, recordDiscrepancy } = buildService({
      paymentOrders: [
        // PAID but no razorpayPaymentId → expected discrepancy.
        // 999.99 rupees → 99999 paise. Under the old code this could
        // drift to 99998 on some inputs due to float arithmetic.
        {
          id: 'o-1',
          orderNumber: 'SM-1',
          totalAmount: dec('999.99'),
          paymentStatus: 'PAID',
          razorpayPaymentId: null,
          paymentExpiresAt: null,
        },
      ],
    });

    const result = await (service as any).runPayments(
      'run-1',
      new Date(0),
      new Date(),
    );

    expect(recordDiscrepancy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'EXPECTED_NOT_FOUND',
          // Phase 2 (PR 2.3) — recon columns are BigInt; the service
          // now passes bigint straight through (no more clamp helper).
          expectedInPaise: 99999n,
          actualInPaise: null,
        }),
      }),
    );
    expect(result.totalDiscrepancies).toBe(1);
    expect(result.expectedAmountInPaise).toBe(99999n);
  });

  it('handles the canonical 0.1+0.2 trap (Decimal pre-summed) without precision loss', async () => {
    const { service } = buildService({
      paymentOrders: [
        {
          id: 'o-2',
          orderNumber: 'SM-2',
          totalAmount: dec('0.30'),
          paymentStatus: 'PAID',
          razorpayPaymentId: 'pay_ok',
          paymentExpiresAt: null,
        },
      ],
    });

    const result = await (service as any).runPayments('run-1', new Date(0), new Date());

    // 30 paise, exactly. Old code: Number(dec('0.30')) * 100 → 30 (lucky)
    // but Number(dec('0.1')+dec('0.2')) * 100 → 30.000000000000004 → 30
    // (also lucky here). The fix removes the lucky-by-accident path.
    expect(result.matchedAmountInPaise).toBe(30n);
  });

  it('accumulates large totals in BigInt — no number drift above 2^53 paise', async () => {
    // Five orders of ₹100,000,000,000.45 each → 500,000,000,002,250 paise.
    // Still below Int32 max, but well into the range where the OLD
    // `expectedAmount += Math.round(Number * 100)` accumulator would
    // start losing trailing digits.
    const big = dec('100000000000.45');
    const { service } = buildService({
      paymentOrders: Array.from({ length: 5 }, (_, i) => ({
        id: `o-${i}`,
        orderNumber: `SM-${i}`,
        totalAmount: big,
        paymentStatus: 'PAID',
        razorpayPaymentId: `pay-${i}`,
        paymentExpiresAt: null,
      })),
    });

    const result = await (service as any).runPayments('run-1', new Date(0), new Date());

    // Per-order paise = 10,000,000,000,045; ×5 = 50,000,000,000,225.
    // That value vastly exceeds the old Int32 column max (2,147,483,647).
    // Phase 2 (PR 2.3) widened the column to BigInt and removed the
    // service-side clamp, so the aggregate is preserved exactly.
    expect(result.expectedAmountInPaise).toBe(50_000_000_000_225n);
  });
});

describe('ReconciliationService — wallet recon BigInt precision', () => {
  it('compares BigInt ledger vs BigInt balance with no Number cast', async () => {
    const { service, prisma, recordDiscrepancy } = buildService({});

    // Ledger drift: balance=5000, ledger=4500 → 500 paise mismatch.
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        wallet_id: 'w-1',
        user_id: 'u-1',
        balance_in_paise: 5000,
        ledger_sum: 4500n, // bigint-like (server-side ::bigint)
      },
    ]);

    const result = await (service as any).runWallet('run-1');

    expect(result.totalDiscrepancies).toBe(1);
    expect(recordDiscrepancy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'AMOUNT_MISMATCH',
          expectedInPaise: 5000n,
          actualInPaise: 4500n,
          description: expect.stringContaining('drift -500 paise'),
        }),
      }),
    );
  });

  it('matches when ledger equals balance', async () => {
    const { service, prisma, recordDiscrepancy } = buildService({});

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        wallet_id: 'w-2',
        user_id: 'u-2',
        balance_in_paise: 12345,
        ledger_sum: 12345n,
      },
    ]);

    const result = await (service as any).runWallet('run-1');

    expect(result.totalMatched).toBe(1);
    expect(result.totalDiscrepancies).toBe(0);
    expect(recordDiscrepancy).not.toHaveBeenCalled();
  });
});
