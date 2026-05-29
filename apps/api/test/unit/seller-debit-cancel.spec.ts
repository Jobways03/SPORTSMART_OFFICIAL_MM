// Phase 150 — SellerDebitService.cancel is now status-guarded: PENDING →
// CANCELLED (CAS), CANCELLED is idempotent, APPLIED is rejected (the debit was
// already netted into a settlement — void the adjustment instead).

import { SellerDebitService } from '../../src/modules/liability-ledger/application/services/seller-debit.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

function build(row: any) {
  const prisma = {
    sellerDebit: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...(row ?? {}), status: 'CANCELLED' }),
    },
  };
  const svc = new SellerDebitService(prisma as any);
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { svc, prisma };
}

describe('SellerDebitService.cancel (Phase 150)', () => {
  it('cancels a PENDING debit via a status CAS', async () => {
    const { svc, prisma } = build({ id: 'd1', status: 'PENDING' });
    const res = await svc.cancel('d1', 'seller contested successfully');
    expect(prisma.sellerDebit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),
    );
    expect(res.status).toBe('CANCELLED');
  });

  it('rejects cancelling an APPLIED debit (already netted into a settlement)', async () => {
    const { svc, prisma } = build({ id: 'd1', status: 'APPLIED', settlementId: 'ss1' });
    await expect(svc.cancel('d1', 'too late')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(prisma.sellerDebit.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent on an already-CANCELLED debit (no second write)', async () => {
    const { svc, prisma } = build({ id: 'd1', status: 'CANCELLED' });
    const res = await svc.cancel('d1', 'again');
    expect(res.status).toBe('CANCELLED');
    expect(prisma.sellerDebit.updateMany).not.toHaveBeenCalled();
  });

  it('404s on a missing debit', async () => {
    const { svc } = build(null);
    await expect(svc.cancel('missing', 'reason')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('409s when the CAS affects 0 rows (raced to APPLIED concurrently)', async () => {
    const { svc, prisma } = build({ id: 'd1', status: 'PENDING' });
    prisma.sellerDebit.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.cancel('d1', 'reason')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });
});
