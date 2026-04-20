import { PrismaCommissionRepository } from '../../src/modules/commission/infrastructure/repositories/prisma-commission.repository';

/**
 * Tests for the atomic-claim idempotency in the commission processor
 * background job.
 *
 * The race we're guarding against:
 *   1. Job instance A acquires the Redis lock and starts processing batch.
 *   2. Lock TTL (30s) expires while A is still processing slow sub-orders.
 *   3. Job instance B acquires the lock and re-fetches the same delivered
 *      sub-orders (because A hasn't committed yet).
 *   4. Both A and B try to insert commission records for the same orderItemId.
 *
 * The fix is two-layered:
 *   a) `subOrder.updateMany({where:{id, commissionProcessed: false}})` —
 *      atomic-claim. Only one of A and B sees count > 0 and proceeds.
 *   b) `commissionRecord.createMany({skipDuplicates: true})` — defends
 *      against partial-write recovery; the orderItemId @unique index makes
 *      conflicts a silent no-op.
 *
 * Both behaviours are testable by mocking the Prisma transaction client.
 */

describe('PrismaCommissionRepository.processSubOrderCommission — idempotency', () => {
  const buildMockTx = (claimCount: number) => {
    const subOrderUpdateMany = jest.fn().mockResolvedValue({ count: claimCount });
    const commissionCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      subOrder: { updateMany: subOrderUpdateMany },
      commissionRecord: { createMany: commissionCreateMany },
    } as any;
    return { tx, subOrderUpdateMany, commissionCreateMany };
  };

  const buildPrismaWith = (txMock: any) => {
    return {
      $transaction: jest.fn(async (fn: any) => fn(txMock)),
    } as any;
  };

  const sampleRecords = [
    { orderItemId: 'oi1' },
    { orderItemId: 'oi2' },
  ] as any[];

  it('writes commission records when the claim succeeds (count=1)', async () => {
    const { tx, subOrderUpdateMany, commissionCreateMany } = buildMockTx(1);
    const prisma = buildPrismaWith(tx);
    const mockOrdersFacade = {} as any;
    const repo = new PrismaCommissionRepository(prisma, mockOrdersFacade);

    await repo.processSubOrderCommission('so1', sampleRecords);

    expect(subOrderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'so1', commissionProcessed: false },
      data: { commissionProcessed: true },
    });
    expect(commissionCreateMany).toHaveBeenCalledWith({
      data: sampleRecords,
      skipDuplicates: true,
    });
  });

  it('silently no-ops when the claim fails (already processed by another instance)', async () => {
    const { tx, subOrderUpdateMany, commissionCreateMany } = buildMockTx(0);
    const prisma = buildPrismaWith(tx);
    const mockOrdersFacade = {} as any;
    const repo = new PrismaCommissionRepository(prisma, mockOrdersFacade);

    await repo.processSubOrderCommission('so1', sampleRecords);

    expect(subOrderUpdateMany).toHaveBeenCalledTimes(1);
    // The critical assertion: no commission rows are inserted when the
    // sub-order was already claimed by another job instance.
    expect(commissionCreateMany).not.toHaveBeenCalled();
  });

  it('skips createMany call when records list is empty even on successful claim', async () => {
    const { tx, subOrderUpdateMany, commissionCreateMany } = buildMockTx(1);
    const prisma = buildPrismaWith(tx);
    const mockOrdersFacade = {} as any;
    const repo = new PrismaCommissionRepository(prisma, mockOrdersFacade);

    await repo.processSubOrderCommission('so1', []);

    expect(subOrderUpdateMany).toHaveBeenCalledTimes(1);
    expect(commissionCreateMany).not.toHaveBeenCalled();
  });

  it('uses skipDuplicates so partial-write recovery is safe', async () => {
    const { tx, commissionCreateMany } = buildMockTx(1);
    const prisma = buildPrismaWith(tx);
    const mockOrdersFacade = {} as any;
    const repo = new PrismaCommissionRepository(prisma, mockOrdersFacade);

    await repo.processSubOrderCommission('so1', sampleRecords);

    const call = commissionCreateMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
  });
});
