import { WalletPublicFacade } from './wallet-public.facade';
import { RefundSplitCalculatorService } from '../../../refund-instructions/application/services/refund-split-calculator.service';
import { WalletRefundSagaAbandonedHandler } from '../event-handlers/wallet-refund-saga-abandoned.handler';

// Phase 184 — Wallet Usage at Checkout audit remediation.

describe('#4/#13 debitForCheckout', () => {
  function make() {
    const wallet: any = { debit: jest.fn().mockResolvedValue({ wallet: { balanceInPaise: 100 }, transaction: { id: 'wtx-1' } }) };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    return { facade: new WalletPublicFacade(wallet, audit, {} as any), wallet, audit };
  }

  it('uses ORDER_REDEMPTION + referenceType ORDER (#4) and returns the tx', async () => {
    const { facade, wallet } = make();
    const r = await facade.debitForCheckout({ userId: 'u1', amountInPaise: 5000, orderId: 'o1', orderNumber: 'ORD-1' });
    const arg = wallet.debit.mock.calls[0][0];
    expect(arg.type).toBe('ORDER_REDEMPTION');
    expect(arg.referenceType).toBe('ORDER');
    expect(arg.referenceId).toBe('o1');
    expect(r.transaction.id).toBe('wtx-1');
  });

  it('writes a wallet.checkout.debited audit row (#13)', async () => {
    const { facade, audit } = make();
    await facade.debitForCheckout({ userId: 'u1', amountInPaise: 5000, orderId: 'o1' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'wallet.checkout.debited' }));
  });
});

describe('#12 RefundSplitCalculator prefers the order snapshot', () => {
  it('uses MasterOrder.walletAmountUsedInPaise without scanning the wallet ledger', async () => {
    const prisma: any = {
      masterOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', totalAmountInPaise: 100000n, paymentMethod: 'ONLINE', walletAmountUsedInPaise: 30000n }) },
      walletTransaction: { findMany: jest.fn() },
    };
    const svc = new RefundSplitCalculatorService(prisma);
    const legs = await svc.calculateSplit({ masterOrderId: 'o1', totalRefundAmountInPaise: 100000n } as any);
    // ledger scan is NOT used when the snapshot is present.
    expect(prisma.walletTransaction.findMany).not.toHaveBeenCalled();
    // 30% wallet-paid → wallet leg present.
    expect(legs.some((l: any) => l.method === 'WALLET')).toBe(true);
  });

  it('falls back to the ledger scan only for legacy orders (snapshot = 0)', async () => {
    const prisma: any = {
      masterOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', totalAmountInPaise: 100000n, paymentMethod: 'ONLINE', walletAmountUsedInPaise: 0n }) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([{ amountInPaise: -20000n }]) },
    };
    const svc = new RefundSplitCalculatorService(prisma);
    await svc.calculateSplit({ masterOrderId: 'o1', totalRefundAmountInPaise: 100000n } as any);
    expect(prisma.walletTransaction.findMany).toHaveBeenCalled();
    // the fallback query includes the new ORDER_REDEMPTION type + both ref cases.
    const where = prisma.walletTransaction.findMany.mock.calls[0][0].where;
    expect(where.type.in).toContain('ORDER_REDEMPTION');
    expect(where.referenceType.in).toEqual(expect.arrayContaining(['ORDER', 'order']));
  });
});

describe('#6 abandoned-saga → finance alert', () => {
  it('raises a sev-95 PaymentMismatchAlert for the owed wallet amount', async () => {
    const paymentOps: any = { flagMismatch: jest.fn().mockResolvedValue(undefined) };
    const handler = new WalletRefundSagaAbandonedHandler(paymentOps);
    await handler.onAbandoned({ payload: { sagaId: 's1', orderId: 'o1', customerId: 'c1', amountInPaise: '50000' } });
    const arg = paymentOps.flagMismatch.mock.calls[0][0];
    expect(arg.severity).toBe(95);
    expect(arg.masterOrderId).toBe('o1');
    expect(arg.description).toContain('ABANDONED');
  });

  it('no-ops when the payload has no customer', async () => {
    const paymentOps: any = { flagMismatch: jest.fn() };
    await new WalletRefundSagaAbandonedHandler(paymentOps).onAbandoned({ payload: {} });
    expect(paymentOps.flagMismatch).not.toHaveBeenCalled();
  });
});
