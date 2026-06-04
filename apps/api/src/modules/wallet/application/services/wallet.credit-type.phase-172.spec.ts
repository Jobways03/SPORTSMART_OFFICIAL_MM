import {
  WalletEntity,
  WalletTransactionEntity,
} from '../../domain/repositories/wallet.repository.interface';
import { WalletPublicFacade } from '../facades/wallet-public.facade';

/**
 * Phase 172 (Goodwill Credit audit #8/#9) — facade forwarding.
 *
 * The adversarial review flagged that creditFromRefund dropped goodwill
 * metadata. This proves the facade THREADS creditType/expiresAt into the
 * underlying wallet.credit call (the repository-persistence half is covered by
 * prisma-wallet.repository.credit-type.phase-172.spec.ts; together they show
 * the value survives facade → service → repo → ledger row).
 */
describe('WalletPublicFacade.creditFromRefund — Phase 172 creditType/expiry forwarding', () => {
  const wallet = { id: 'wallet-1' } as unknown as WalletEntity;
  // createdAt is read by creditFromRefund's "justCreated" audit check — set it
  // well in the past so the facade takes the no-audit branch deterministically.
  const ledgerRow = {
    id: 'tx-1',
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
  } as unknown as WalletTransactionEntity;

  function build() {
    const credit = jest
      .fn()
      .mockResolvedValue({ wallet, transaction: ledgerRow });
    const walletSvc = { credit } as any;
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const refundSaga = { enqueueAndAttempt: jest.fn() } as any;
    const facade = new WalletPublicFacade(walletSvc, audit, refundSaga);
    return { facade, credit };
  }

  it('threads GOODWILL + expiry through to wallet.credit', async () => {
    const { facade, credit } = build();
    const expiresAt = new Date('2026-12-01T00:00:00.000Z');
    await facade.creditFromRefund({
      userId: 'cust-1',
      amountInPaise: 75000,
      refundId: 'rin-1',
      description: 'goodwill',
      creditType: 'GOODWILL',
      expiresAt,
    });
    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({ creditType: 'GOODWILL', expiresAt }),
    );
  });

  it('defaults creditType to REFUND_ORIGINAL + no expiry when unspecified', async () => {
    const { facade, credit } = build();
    await facade.creditFromRefund({
      userId: 'cust-1',
      amountInPaise: 5000,
      refundId: 'rin-2',
    });
    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({ creditType: 'REFUND_ORIGINAL' }),
    );
    const arg = credit.mock.calls[0][0];
    expect(arg.expiresAt ?? null).toBeNull();
  });
});
