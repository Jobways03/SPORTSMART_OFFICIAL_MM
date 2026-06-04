/**
 * Phase 172 (Goodwill Credit audit #9) — goodwill expiry attribution.
 *
 * Goodwill wallet credits carry an `expiresAt`. The wallet balance, however,
 * is FUNGIBLE — a single `balanceInPaise` maintained transactionally with the
 * append-only `wallet_transactions` ledger. So "how much unexpired goodwill is
 * still unspent?" can't be read off a column; it has to be reconstructed from
 * the ledger with an explicit consumption policy.
 *
 * Policy (deliberate, documented):
 *   1. A spend debit consumes GOODWILL first, oldest-expiry-first, but only
 *      goodwill that was UNEXPIRED at the moment of that debit. This is
 *      customer-favourable (use-it-before-you-lose-it) and makes our expiry
 *      conservative — we lapse the least.
 *   2. Spend beyond available goodwill draws from "real money" (top-ups,
 *      genuine refunds) which we don't track here.
 *   3. A prior expiry sweep (a DEBIT_ADJUSTMENT with
 *      referenceType='goodwill_expiry', referenceId=<lot id>) has already
 *      removed its lot's remaining from the balance — so re-running the
 *      computation is idempotent.
 *
 * The function is PURE (no I/O, no clock except the injected `now`) so the
 * money-sensitive logic is exhaustively unit-testable. The caller (Wallet
 * service) is responsible for clamping the result to the actual balance before
 * moving any money — see `sweepExpiredGoodwillForUser`.
 */

export const GOODWILL_EXPIRY_REFERENCE_TYPE = 'goodwill_expiry';

export interface GoodwillLedgerTxn {
  id: string;
  /** Signed paise: credits positive, debits negative. */
  amountInPaise: number;
  type: string;
  creditType?: string | null;
  expiresAt?: Date | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: Date;
}

export interface GoodwillLotToLapse {
  lotId: string;
  amountInPaise: number;
  expiresAt: Date;
}

export interface GoodwillState {
  /** Goodwill past its expiry that is still unspent (notional, pre-clamp). */
  expiredUnspentPaise: number;
  /** Unexpired goodwill still available to spend. */
  activeGoodwillPaise: number;
  /** Expired, unspent, not-yet-swept lots — the sweep targets these. */
  lotsToLapse: GoodwillLotToLapse[];
}

function isGoodwillCredit(t: GoodwillLedgerTxn): boolean {
  return t.amountInPaise > 0 && t.creditType === 'GOODWILL' && !!t.expiresAt;
}

function isGoodwillExpirySweep(t: GoodwillLedgerTxn): boolean {
  return t.referenceType === GOODWILL_EXPIRY_REFERENCE_TYPE;
}

function isSpendDebit(t: GoodwillLedgerTxn): boolean {
  // A real spend/adjustment debit — NOT a prior expiry sweep (that one only
  // lapses its own referenced lot; it must not consume other lots).
  return t.amountInPaise < 0 && !isGoodwillExpirySweep(t);
}

/**
 * Reconstruct goodwill consumption from the ledger and report what has expired
 * unspent.
 */
export function computeGoodwillState(
  txns: GoodwillLedgerTxn[],
  now: Date,
): GoodwillState {
  // Deterministic order: by createdAt, then id (stable tie-break).
  const ordered = [...txns].sort((a, b) => {
    const dt = a.createdAt.getTime() - b.createdAt.getTime();
    return dt !== 0 ? dt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Amount already lapsed by prior sweeps, keyed by the lot they targeted.
  const sweptByLotId = new Map<string, number>();
  for (const t of ordered) {
    if (isGoodwillExpirySweep(t) && t.referenceId) {
      sweptByLotId.set(
        t.referenceId,
        (sweptByLotId.get(t.referenceId) ?? 0) + Math.abs(t.amountInPaise),
      );
    }
  }

  type Lot = { id: string; expiresAt: Date; remaining: number };
  const lots: Lot[] = [];

  for (const t of ordered) {
    if (isGoodwillCredit(t)) {
      lots.push({
        id: t.id,
        expiresAt: t.expiresAt as Date,
        remaining: t.amountInPaise,
      });
      continue;
    }
    if (isSpendDebit(t)) {
      let need = Math.abs(t.amountInPaise);
      // Consume goodwill that was unexpired at THIS debit's time, oldest-
      // expiry first.
      const spendable = lots
        .filter((l) => l.remaining > 0 && l.expiresAt.getTime() > t.createdAt.getTime())
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      for (const lot of spendable) {
        if (need <= 0) break;
        const take = Math.min(need, lot.remaining);
        lot.remaining -= take;
        need -= take;
      }
      // Any leftover `need` came from real money — not our concern.
    }
  }

  // Apply prior-sweep reductions (those lots already left the balance).
  for (const lot of lots) {
    const swept = sweptByLotId.get(lot.id) ?? 0;
    if (swept > 0) lot.remaining = Math.max(0, lot.remaining - swept);
  }

  const nowMs = now.getTime();
  const lotsToLapse: GoodwillLotToLapse[] = [];
  let expiredUnspentPaise = 0;
  let activeGoodwillPaise = 0;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    if (lot.expiresAt.getTime() <= nowMs) {
      expiredUnspentPaise += lot.remaining;
      lotsToLapse.push({
        lotId: lot.id,
        amountInPaise: lot.remaining,
        expiresAt: lot.expiresAt,
      });
    } else {
      activeGoodwillPaise += lot.remaining;
    }
  }

  return { expiredUnspentPaise, activeGoodwillPaise, lotsToLapse };
}
