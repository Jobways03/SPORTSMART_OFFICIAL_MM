import {
  computeGoodwillState,
  GoodwillLedgerTxn,
  GOODWILL_EXPIRY_REFERENCE_TYPE,
} from './goodwill-ledger';

// Phase 172 (#9) — exhaustive coverage of the goodwill-expiry attribution.
// All money lives in the ledger; these tests pin the consumption policy.

const D = (iso: string) => new Date(iso);
let seq = 0;
function tx(p: Partial<GoodwillLedgerTxn>): GoodwillLedgerTxn {
  return {
    id: p.id ?? `t${seq++}`,
    amountInPaise: p.amountInPaise ?? 0,
    type: p.type ?? 'REFUND',
    creditType: p.creditType ?? null,
    expiresAt: p.expiresAt ?? null,
    referenceType: p.referenceType ?? null,
    referenceId: p.referenceId ?? null,
    createdAt: p.createdAt ?? D('2026-01-01T00:00:00Z'),
  };
}
function goodwill(id: string, amount: number, createdAt: string, expiresAt: string) {
  return tx({ id, amountInPaise: amount, type: 'REFUND', creditType: 'GOODWILL', createdAt: D(createdAt), expiresAt: D(expiresAt) });
}
function spend(id: string, amount: number, createdAt: string) {
  return tx({ id, amountInPaise: -Math.abs(amount), type: 'DEBIT', createdAt: D(createdAt) });
}

describe('computeGoodwillState (#9)', () => {
  it('a fresh, unexpired goodwill credit is active, nothing to lapse', () => {
    const s = computeGoodwillState(
      [goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')],
      D('2026-02-01T00:00:00Z'),
    );
    expect(s.activeGoodwillPaise).toBe(50000);
    expect(s.expiredUnspentPaise).toBe(0);
    expect(s.lotsToLapse).toHaveLength(0);
  });

  it('an expired, untouched goodwill credit is fully lapse-able', () => {
    const s = computeGoodwillState(
      [goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(50000);
    expect(s.lotsToLapse).toEqual([
      { lotId: 'g1', amountInPaise: 50000, expiresAt: D('2026-02-01T00:00:00Z') },
    ]);
  });

  it('a debit consumes goodwill first (use-it-before-you-lose-it) — less lapses', () => {
    // ₹500 goodwill, then a ₹300 spend while still valid → ₹200 remains; later expires.
    const s = computeGoodwillState(
      [
        goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        spend('d1', 30000, '2026-01-10T00:00:00Z'),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(20000);
    expect(s.lotsToLapse).toHaveLength(1);
    expect(s.lotsToLapse[0]!.amountInPaise).toBe(20000);
  });

  it('a fully-spent goodwill lot lapses nothing', () => {
    const s = computeGoodwillState(
      [
        goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        spend('d1', 50000, '2026-01-10T00:00:00Z'),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(0);
    expect(s.lotsToLapse).toHaveLength(0);
  });

  it('a debit AFTER expiry does NOT consume the expired lot (it was unspendable)', () => {
    // Spend happens after the lot already expired → that spend used real money,
    // the expired lot is still fully lapse-able.
    const s = computeGoodwillState(
      [
        goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        spend('d1', 30000, '2026-02-15T00:00:00Z'),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(50000);
  });

  it('oldest-expiry goodwill is consumed first across multiple lots', () => {
    const s = computeGoodwillState(
      [
        goodwill('g1', 30000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'), // expires sooner
        goodwill('g2', 30000, '2026-01-01T00:00:00Z', '2026-09-01T00:00:00Z'), // expires later
        spend('d1', 20000, '2026-01-10T00:00:00Z'),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    // d1 drained g1 first (₹200 of its ₹300) → g1 has ₹100 left and is now
    // expired → lapse ₹100. g2 (₹300) is unexpired → active.
    expect(s.expiredUnspentPaise).toBe(10000);
    expect(s.activeGoodwillPaise).toBe(30000);
    expect(s.lotsToLapse).toEqual([
      { lotId: 'g1', amountInPaise: 10000, expiresAt: D('2026-02-01T00:00:00Z') },
    ]);
  });

  it('is idempotent: a prior expiry-sweep debit removes its lot from the result', () => {
    const s = computeGoodwillState(
      [
        goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        // the sweep we already posted for g1
        tx({
          id: 's1',
          amountInPaise: -50000,
          type: 'DEBIT_ADJUSTMENT',
          referenceType: GOODWILL_EXPIRY_REFERENCE_TYPE,
          referenceId: 'g1',
          createdAt: D('2026-02-02T00:00:00Z'),
        }),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(0);
    expect(s.lotsToLapse).toHaveLength(0);
  });

  it('non-goodwill credits (genuine refunds, top-ups) never expire', () => {
    const s = computeGoodwillState(
      [
        tx({ id: 'r1', amountInPaise: 100000, type: 'REFUND', creditType: 'REFUND_ORIGINAL', createdAt: D('2026-01-01T00:00:00Z') }),
        tx({ id: 't1', amountInPaise: 100000, type: 'TOPUP', creditType: null, createdAt: D('2026-01-01T00:00:00Z') }),
      ],
      D('2027-01-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(0);
    expect(s.activeGoodwillPaise).toBe(0);
  });

  it('a partial prior sweep still lapses the remainder', () => {
    const s = computeGoodwillState(
      [
        goodwill('g1', 50000, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        tx({
          id: 's1',
          amountInPaise: -20000,
          type: 'DEBIT_ADJUSTMENT',
          referenceType: GOODWILL_EXPIRY_REFERENCE_TYPE,
          referenceId: 'g1',
          createdAt: D('2026-02-02T00:00:00Z'),
        }),
      ],
      D('2026-03-01T00:00:00Z'),
    );
    expect(s.expiredUnspentPaise).toBe(30000);
  });
});
