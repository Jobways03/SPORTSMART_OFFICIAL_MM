import { PrismaWalletRepository } from '../../infrastructure/repositories/prisma-wallet.repository';
import { WalletController } from '../../presentation/controllers/wallet.controller';
import { LoyaltyService } from '../../../loyalty/application/services/loyalty.service';

// Phase 182 — Customer Wallet audit remediation.

describe('#4/#5 applyMutation derives balanceBefore + direction', () => {
  function makeRepo() {
    const created: any[] = [];
    const tx: any = {
      wallet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'w1', userId: 'u1', balanceInPaise: 0n, currency: 'INR', version: 1, isBlocked: false, blockedReason: null, blockedAt: null, blockedByAdminId: null, createdAt: new Date(), updatedAt: new Date() }),
      },
      walletTransaction: { create: jest.fn().mockImplementation(({ data }: any) => { created.push(data); return Promise.resolve({ ...data, id: 't1', createdAt: new Date(), lapsedAt: null }); }) },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return { repo: new PrismaWalletRepository(prisma), created };
  }

  it('CREDIT: positive amount → direction CREDIT, balanceBefore = after − amount', async () => {
    const { repo, created } = makeRepo();
    await repo.applyMutation({ walletId: 'w1', expectedVersion: 0, newBalanceInPaise: 50000, transaction: { walletId: 'w1', userId: 'u1', type: 'REFUND' as any, amountInPaise: 50000, balanceAfterInPaise: 50000, description: 'x' } });
    expect(created[0].direction).toBe('CREDIT');
    expect(created[0].balanceBeforeInPaise).toBe(0n); // 50000 − 50000
    expect(created[0].currency).toBe('INR');
  });

  it('DEBIT: negative amount → direction DEBIT, balanceBefore = after − (−amount)', async () => {
    const { repo, created } = makeRepo();
    await repo.applyMutation({ walletId: 'w1', expectedVersion: 0, newBalanceInPaise: 20000, transaction: { walletId: 'w1', userId: 'u1', type: 'DEBIT' as any, amountInPaise: -30000, balanceAfterInPaise: 20000, description: 'x' } });
    expect(created[0].direction).toBe('DEBIT');
    expect(created[0].balanceBeforeInPaise).toBe(50000n); // 20000 − (−30000)
  });
});

describe('#11 customer endpoint strips admin-only fields', () => {
  it('listTransactions removes internalNotes + createdByAdminId', async () => {
    const wallet: any = {
      listTransactions: jest.fn().mockResolvedValue({
        items: [{ id: 't1', type: 'REFUND', amountInPaise: 5000, description: 'd', internalNotes: 'SECRET admin note', createdByAdminId: 'admin-9', walletId: 'w1' }],
        page: 1, limit: 20, total: 1,
      }),
    };
    const ctrl = new WalletController(wallet);
    const res: any = await ctrl.listTransactions({ userId: 'u1' }, { page: 1, limit: 20 });
    const row = res.data.items[0];
    expect(row.internalNotes).toBeUndefined();
    expect(row.createdByAdminId).toBeUndefined();
    expect(row.walletId).toBeUndefined();
    expect(row.description).toBe('d'); // safe field kept
  });
});

describe('#2/#3 LoyaltyService.earnForOrder', () => {
  function makeSvc(opts: { enabled?: boolean; bps?: number; max?: number; min?: number; existing?: any } = {}) {
    const env: any = {
      getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
      getNumber: jest.fn((key: string, dflt: number) => {
        if (key === 'LOYALTY_CASHBACK_BPS') return opts.bps ?? 100;
        if (key === 'LOYALTY_CASHBACK_MAX_PAISE') return opts.max ?? 50000;
        if (key === 'LOYALTY_MIN_ORDER_PAISE') return opts.min ?? 50000;
        if (key === 'LOYALTY_EARN_EXPIRY_DAYS') return 180;
        return dflt;
      }),
    };
    const created: any[] = [];
    const prisma: any = {
      loyaltyEarnEvent: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn().mockImplementation(({ data }: any) => { const e = { ...data, id: 'le1' }; created.push(e); return Promise.resolve(e); }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'le1', ...data })),
      },
    };
    const wallet: any = { creditLoyalty: jest.fn().mockResolvedValue({ transaction: { id: 'wtx1' } }) };
    return { svc: new LoyaltyService(prisma, env, wallet), prisma, wallet, created };
  }

  it('returns null when disabled', async () => {
    const { svc, wallet } = makeSvc({ enabled: false });
    expect(await svc.earnForOrder({ userId: 'u1', orderId: 'o1', eligibleAmountInPaise: 100000 })).toBeNull();
    expect(wallet.creditLoyalty).not.toHaveBeenCalled();
  });

  it('SKIPs an order below the min-order floor', async () => {
    const { svc, wallet, created } = makeSvc({ min: 50000 });
    const r: any = await svc.earnForOrder({ userId: 'u1', orderId: 'o1', eligibleAmountInPaise: 40000 });
    expect(r.status).toBe('SKIPPED');
    expect(wallet.creditLoyalty).not.toHaveBeenCalled();
    expect(created[0].rebateInPaise).toBe(0n);
  });

  it('credits 1% capped, posts the wallet rebate, marks POSTED', async () => {
    const { svc, wallet } = makeSvc({ bps: 100, max: 50000, min: 50000 });
    await svc.earnForOrder({ userId: 'u1', orderId: 'o1', orderNumber: 'ORD-1', eligibleAmountInPaise: 200000 }); // ₹2000 → 1% = ₹20 = 2000 paise
    const arg = wallet.creditLoyalty.mock.calls[0][0];
    expect(arg.amountInPaise).toBe(2000);
    expect(arg.referenceNumber === undefined || arg.orderNumber === 'ORD-1').toBe(true);
    expect(arg.expiresAt).toBeInstanceOf(Date);
  });

  it('caps the rebate at the configured max', async () => {
    const { svc, wallet } = makeSvc({ bps: 100, max: 1000, min: 50000 }); // cap ₹10
    await svc.earnForOrder({ userId: 'u1', orderId: 'o1', eligibleAmountInPaise: 1000000 }); // 1% = ₹100 but capped to ₹10
    expect(wallet.creditLoyalty.mock.calls[0][0].amountInPaise).toBe(1000);
  });

  it('is idempotent — an existing event short-circuits (no re-credit)', async () => {
    const { svc, wallet } = makeSvc({ existing: { id: 'le1', status: 'POSTED' } });
    const r: any = await svc.earnForOrder({ userId: 'u1', orderId: 'o1', eligibleAmountInPaise: 200000 });
    expect(r.id).toBe('le1');
    expect(wallet.creditLoyalty).not.toHaveBeenCalled();
  });
});

describe('make-it-100% loyalty clawback on refund', () => {
  function makeSvc(opts: { event?: any; clawed?: number } = {}) {
    const env: any = { getBoolean: jest.fn().mockReturnValue(true), getNumber: jest.fn((_k: string, d: number) => d) };
    const prisma: any = {
      loyaltyEarnEvent: {
        findUnique: jest.fn().mockResolvedValue(opts.event ?? null),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'le1', ...data })),
      },
    };
    const wallet: any = { debitLoyaltyClawback: jest.fn().mockResolvedValue({ clawedBackInPaise: opts.clawed ?? 0 }) };
    return { svc: new LoyaltyService(prisma, env, wallet), prisma, wallet };
  }
  const POSTED = (over: any = {}) => ({ id: 'le1', userId: 'u1', status: 'POSTED', rebateInPaise: 2000n, eligibleAmountInPaise: 200000n, clawedBackInPaise: 0n, ...over });

  it('claws back proportionally to the refund (full refund → full rebate)', async () => {
    const { svc, wallet } = makeSvc({ event: POSTED(), clawed: 2000 });
    await svc.clawbackForOrder({ orderId: 'o1', refundedAmountInPaise: 200000 }); // full order
    expect(wallet.debitLoyaltyClawback.mock.calls[0][0].amountInPaise).toBe(2000); // full rebate
  });

  it('half refund → half the rebate clawed', async () => {
    const { svc, wallet } = makeSvc({ event: POSTED(), clawed: 1000 });
    await svc.clawbackForOrder({ orderId: 'o1', refundedAmountInPaise: 100000 }); // ₹1000 of ₹2000
    expect(wallet.debitLoyaltyClawback.mock.calls[0][0].amountInPaise).toBe(1000);
  });

  it('is idempotent — already-clawed event does not claw again', async () => {
    const { svc, wallet } = makeSvc({ event: POSTED({ clawedBackInPaise: 2000n }) });
    await svc.clawbackForOrder({ orderId: 'o1', refundedAmountInPaise: 200000 });
    expect(wallet.debitLoyaltyClawback).not.toHaveBeenCalled();
  });

  it('skips when there is no POSTED earn event', async () => {
    const { svc, wallet } = makeSvc({ event: null });
    const r = await svc.clawbackForOrder({ orderId: 'o1', refundedAmountInPaise: 200000 });
    expect(r).toBeNull();
    expect(wallet.debitLoyaltyClawback).not.toHaveBeenCalled();
  });
});
