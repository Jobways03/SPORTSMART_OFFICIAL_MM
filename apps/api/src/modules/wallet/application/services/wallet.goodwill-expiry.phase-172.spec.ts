import { WalletService } from './wallet.service';
import {
  WalletEntity,
  WalletTransactionEntity,
  WalletRepository,
} from '../../domain/repositories/wallet.repository.interface';
import { GOODWILL_EXPIRY_REFERENCE_TYPE } from './goodwill-ledger';

// Phase 172 (#9) — getSpendableBalance excludes expired goodwill, and the sweep
// lapses it (clamped, idempotent, marker-stamped).

const PAST = new Date('2020-01-01T00:00:00.000Z');
const PAST_EXPIRY = new Date('2020-06-01T00:00:00.000Z'); // long past `now`

function wallet(balanceInPaise: number): WalletEntity {
  return {
    id: 'w1',
    userId: 'u1',
    balanceInPaise,
    currency: 'INR',
    isBlocked: false,
    blockedReason: null,
    blockedAt: null,
    blockedByAdminId: null,
    version: 0,
    createdAt: PAST,
    updatedAt: PAST,
  } as WalletEntity;
}

function tx(p: Partial<WalletTransactionEntity>): WalletTransactionEntity {
  return {
    id: p.id ?? 't1',
    walletId: 'w1',
    userId: 'u1',
    type: (p.type ?? 'REFUND') as any,
    status: 'COMPLETED' as any,
    amountInPaise: p.amountInPaise ?? 0,
    balanceAfterInPaise: 0,
    referenceType: p.referenceType ?? null,
    referenceId: p.referenceId ?? null,
    description: 'x',
    internalNotes: null,
    createdByAdminId: null,
    creditType: (p.creditType ?? null) as any,
    expiresAt: p.expiresAt ?? null,
    createdAt: p.createdAt ?? PAST,
  } as WalletTransactionEntity;
}

function build(repoOverrides: Partial<WalletRepository>) {
  const applyMutation = jest.fn();
  const base: any = {
    findByUserId: jest.fn(),
    getOrCreate: jest.fn(),
    findAllTransactionsForUser: jest.fn().mockResolvedValue([]),
    findUserIdsWithExpiredGoodwill: jest.fn().mockResolvedValue([]),
    markGoodwillLotsLapsed: jest.fn().mockResolvedValue(0),
    findTransactionByReference: jest.fn().mockResolvedValue(null),
    applyMutation,
    listTransactions: jest.fn(),
  };
  const repo = { ...base, ...repoOverrides } as unknown as WalletRepository;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const paymentOps = { flagMismatch: jest.fn(), recordAttempt: jest.fn() } as any;
  const svc = new WalletService(repo, {} as any, eventBus, audit, paymentOps);
  return { svc, repo, applyMutation };
}

describe('getSpendableBalance (#9)', () => {
  it('excludes expired goodwill from spendable', async () => {
    const { svc } = build({
      findByUserId: jest.fn().mockResolvedValue(wallet(100000)),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: PAST_EXPIRY }),
        tx({ id: 't1', amountInPaise: 50000, type: 'TOPUP', creditType: null }),
      ]),
    });
    const r = await svc.getSpendableBalance('u1');
    expect(r.balanceInPaise).toBe(100000);
    expect(r.expiredGoodwillInPaise).toBe(50000);
    expect(r.spendableInPaise).toBe(50000);
  });

  it('clamps the exclusion to the balance (legacy: expired goodwill already spent)', async () => {
    const { svc } = build({
      findByUserId: jest.fn().mockResolvedValue(wallet(30000)),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: PAST_EXPIRY }),
      ]),
    });
    const r = await svc.getSpendableBalance('u1');
    expect(r.expiredGoodwillInPaise).toBe(30000); // clamped
    expect(r.spendableInPaise).toBe(0); // never negative
  });

  it('an active (unexpired) goodwill credit is fully spendable', async () => {
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const { svc } = build({
      findByUserId: jest.fn().mockResolvedValue(wallet(50000)),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: future }),
      ]),
    });
    const r = await svc.getSpendableBalance('u1');
    expect(r.spendableInPaise).toBe(50000);
    expect(r.expiredGoodwillInPaise).toBe(0);
  });
});

describe('sweepExpiredGoodwillForUser (#9)', () => {
  it('posts a clamped DEBIT_ADJUSTMENT for the expired lot and stamps the marker', async () => {
    const w = wallet(50000);
    const markGoodwillLotsLapsed = jest.fn().mockResolvedValue(1);
    const applyMutation = jest
      .fn()
      .mockResolvedValue({ wallet: w, transaction: tx({}) });
    const { svc } = build({
      getOrCreate: jest.fn().mockResolvedValue(w),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: PAST_EXPIRY }),
      ]),
      findTransactionByReference: jest.fn().mockResolvedValue(null),
      applyMutation,
      markGoodwillLotsLapsed,
    });
    const r = await svc.sweepExpiredGoodwillForUser('u1', new Date());
    expect(r.lapsedLots).toBe(1);
    expect(r.lapsedPaise).toBe(50000);
    const arg = applyMutation.mock.calls[0][0];
    expect(arg.transaction.type).toBe('DEBIT_ADJUSTMENT');
    expect(arg.transaction.amountInPaise).toBe(-50000);
    expect(arg.transaction.referenceType).toBe(GOODWILL_EXPIRY_REFERENCE_TYPE);
    expect(arg.transaction.referenceId).toBe('g1');
    expect(markGoodwillLotsLapsed).toHaveBeenCalledWith({ userId: 'u1', now: expect.any(Date) });
  });

  it('is idempotent — skips a lot that already has a sweep row', async () => {
    const applyMutation = jest.fn();
    const { svc } = build({
      getOrCreate: jest.fn().mockResolvedValue(wallet(50000)),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: PAST_EXPIRY }),
      ]),
      findTransactionByReference: jest
        .fn()
        .mockResolvedValue(tx({ id: 's1', referenceType: GOODWILL_EXPIRY_REFERENCE_TYPE, referenceId: 'g1' })),
      applyMutation,
    });
    const r = await svc.sweepExpiredGoodwillForUser('u1', new Date());
    expect(r.lapsedLots).toBe(0);
    expect(applyMutation).not.toHaveBeenCalled();
  });

  it('never lapses more than the live balance (clamp guards against negative)', async () => {
    const w = wallet(20000); // only ₹200 left though lot is ₹500
    const applyMutation = jest
      .fn()
      .mockResolvedValue({ wallet: w, transaction: tx({}) });
    const { svc } = build({
      getOrCreate: jest.fn().mockResolvedValue(w),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([
        tx({ id: 'g1', amountInPaise: 50000, type: 'REFUND', creditType: 'GOODWILL', expiresAt: PAST_EXPIRY }),
      ]),
      applyMutation,
    });
    const r = await svc.sweepExpiredGoodwillForUser('u1', new Date());
    expect(r.lapsedPaise).toBe(20000);
    expect(applyMutation.mock.calls[0][0].transaction.amountInPaise).toBe(-20000);
  });
});

describe('sweepExpiredGoodwill (batch, #9)', () => {
  it('processes each candidate user', async () => {
    const w = wallet(50000);
    const { svc } = build({
      findUserIdsWithExpiredGoodwill: jest.fn().mockResolvedValue(['u1', 'u2']),
      getOrCreate: jest.fn().mockResolvedValue(w),
      findAllTransactionsForUser: jest.fn().mockResolvedValue([]), // nothing to lapse
      markGoodwillLotsLapsed: jest.fn().mockResolvedValue(1),
    });
    const r = await svc.sweepExpiredGoodwill();
    expect(r.usersProcessed).toBe(2);
  });
});
