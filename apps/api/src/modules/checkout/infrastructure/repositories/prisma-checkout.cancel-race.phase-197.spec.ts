/**
 * Phase 197 (My-Orders audit #15) — cancel-race close.
 *
 * The customer-cancel blocking-status check ran against a snapshot read
 * OUTSIDE the cancel tx, so a sub-order that shipped between the read
 * and the commit could still be cancelled (unconditional stock restore
 * + commission reversal on goods already in transit). cancelOrderTransaction
 * now re-reads the live fulfillment statuses under FOR UPDATE and aborts
 * if any is blocking. These specs drive that in-tx guard.
 */
import { PrismaCheckoutRepository } from './prisma-checkout.repository';

function makeRepo(lockedSubs: Array<{ id: string; fulfillment_status: string }>) {
  // tx.$queryRaw is called twice: (1) lock the master row, (2) lock +
  // read sub-order statuses. The first returns [], the second the rows.
  let call = 0;
  const queryRaw = jest.fn(async () => {
    call += 1;
    return call === 1 ? [] : lockedSubs;
  });
  const masterUpdate = jest.fn(async () => ({}));
  const subUpdate = jest.fn(async () => ({}));
  const tx: any = {
    $queryRaw: queryRaw,
    masterOrder: { update: masterUpdate },
    subOrder: { update: subUpdate },
    productVariant: { update: jest.fn() },
    product: { update: jest.fn() },
    sellerProductMapping: { findFirst: jest.fn(), update: jest.fn() },
    commissionRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    commissionReversalRecord: { create: jest.fn() },
  };
  const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
  const moneyDualWrite: any = { applyPaise: (_k: string, d: any) => d };
  return {
    repo: new PrismaCheckoutRepository(prisma as any, moneyDualWrite),
    masterUpdate,
    subUpdate,
  };
}

const order: any = {
  id: 'mo-1',
  orderNumber: 'SM1',
  subOrders: [{ id: 'so-1', items: [] }],
};

describe('cancelOrderTransaction in-tx race guard (Phase 197 #15)', () => {
  it('aborts when a sub-order shipped between the pre-check and the tx', async () => {
    const { repo, masterUpdate } = makeRepo([
      { id: 'so-1', fulfillment_status: 'SHIPPED' },
    ]);
    await expect(repo.cancelOrderTransaction(order)).rejects.toThrow(
      /already shipped or been delivered/i,
    );
    // The cancel writes never ran.
    expect(masterUpdate).not.toHaveBeenCalled();
  });

  it('proceeds when all sub-orders are still pre-ship', async () => {
    const { repo, masterUpdate, subUpdate } = makeRepo([
      { id: 'so-1', fulfillment_status: 'UNFULFILLED' },
    ]);
    await repo.cancelOrderTransaction(order);
    expect(masterUpdate).toHaveBeenCalled();
    expect(subUpdate).toHaveBeenCalled();
  });
});
