// Phase 127 — liability-ledger reversal on refund rejection.
//
// When finance rejects a dispute refund, the money never moves, so the cost
// attribution booked at decision time (SellerDebit / LogisticsClaim /
// PlatformExpense) must be reversed. Reversal is idempotent and refuses to
// silently undo an already-applied debit / in-flight claim (those need ops).

import { SellerDebitService } from './seller-debit.service';
import { LogisticsClaimService } from './logistics-claim.service';
import { PlatformExpenseService } from './platform-expense.service';
import { LiabilityLedgerPublicFacade } from '../facades/liability-ledger-public.facade';

const ARGS = { sourceType: 'DISPUTE' as any, sourceId: 'd-1', reason: 'rejected' };

describe('SellerDebitService.reverseForSource (Phase 127)', () => {
  const build = (row: any) => {
    const prisma: any = {
      sellerDebit: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { svc: new SellerDebitService(prisma), prisma };
  };

  it('reverses a PENDING debit (→ CANCELLED)', async () => {
    const { svc, prisma } = build({ id: 'sd-1', status: 'PENDING' });
    expect(await svc.reverseForSource(ARGS)).toBe('reversed');
    expect(prisma.sellerDebit.update).toHaveBeenCalledWith({
      where: { id: 'sd-1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('refuses to touch an APPLIED debit (needs a settlement reversal)', async () => {
    const { svc, prisma } = build({ id: 'sd-1', status: 'APPLIED' });
    expect(await svc.reverseForSource(ARGS)).toBe('needs_manual');
    expect(prisma.sellerDebit.update).not.toHaveBeenCalled();
  });

  it('is replay-safe on an already-CANCELLED debit', async () => {
    const { svc, prisma } = build({ id: 'sd-1', status: 'CANCELLED' });
    expect(await svc.reverseForSource(ARGS)).toBe('already_reversed');
    expect(prisma.sellerDebit.update).not.toHaveBeenCalled();
  });

  it('returns "none" when no debit exists for the source', async () => {
    const { svc } = build(null);
    expect(await svc.reverseForSource(ARGS)).toBe('none');
  });
});

describe('LogisticsClaimService.reverseForSource (Phase 127)', () => {
  const build = (row: any) => {
    const prisma: any = {
      logisticsClaim: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { svc: new LogisticsClaimService(prisma), prisma };
  };

  it('cancels a PENDING claim', async () => {
    const { svc, prisma } = build({ id: 'lc-1', status: 'PENDING' });
    expect(await svc.reverseForSource(ARGS)).toBe('reversed');
    expect(prisma.logisticsClaim.update).toHaveBeenCalled();
  });

  it('refuses to cancel a SUBMITTED claim (already with the courier)', async () => {
    const { svc, prisma } = build({ id: 'lc-1', status: 'SUBMITTED' });
    expect(await svc.reverseForSource(ARGS)).toBe('needs_manual');
    expect(prisma.logisticsClaim.update).not.toHaveBeenCalled();
  });
});

describe('PlatformExpenseService.reverseForSource (Phase 127)', () => {
  const build = (row: any) => {
    const prisma: any = {
      platformExpense: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { svc: new PlatformExpenseService(prisma), prisma };
  };

  it('soft-reverses a fresh expense (stamps reversedAt)', async () => {
    const { svc, prisma } = build({ id: 'pe-1', reversedAt: null });
    expect(await svc.reverseForSource(ARGS)).toBe('reversed');
    expect(prisma.platformExpense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pe-1' },
        data: expect.objectContaining({ reversalReason: 'rejected' }),
      }),
    );
  });

  it('is replay-safe on an already-reversed expense', async () => {
    const { svc, prisma } = build({ id: 'pe-1', reversedAt: new Date() });
    expect(await svc.reverseForSource(ARGS)).toBe('already_reversed');
    expect(prisma.platformExpense.update).not.toHaveBeenCalled();
  });
});

describe('LiabilityLedgerPublicFacade.reverseForSource aggregation (Phase 127)', () => {
  const build = (sd: string, lc: string, pe: string) => {
    const sellerDebit: any = { reverseForSource: jest.fn().mockResolvedValue(sd) };
    const logisticsClaim: any = { reverseForSource: jest.fn().mockResolvedValue(lc) };
    const platformExpense: any = { reverseForSource: jest.fn().mockResolvedValue(pe) };
    return new LiabilityLedgerPublicFacade(
      sellerDebit,
      logisticsClaim,
      platformExpense,
      {} as any,
    );
  };

  it('flags reversedAny when one row flips', async () => {
    const res = await build('reversed', 'none', 'none').reverseForSource(ARGS);
    expect(res.reversedAny).toBe(true);
    expect(res.needsManual).toBe(false);
  });

  it('flags needsManual when a debit was already applied', async () => {
    const res = await build('needs_manual', 'none', 'none').reverseForSource(ARGS);
    expect(res.reversedAny).toBe(false);
    expect(res.needsManual).toBe(true);
  });

  it('flags neither on a pure replay (everything already reversed / none)', async () => {
    const res = await build('already_reversed', 'none', 'already_reversed').reverseForSource(ARGS);
    expect(res.reversedAny).toBe(false);
    expect(res.needsManual).toBe(false);
  });
});
