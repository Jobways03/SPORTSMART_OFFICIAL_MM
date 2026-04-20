import 'reflect-metadata';
import { PrismaCheckoutRepository } from '../../src/modules/checkout/infrastructure/repositories/prisma-checkout.repository';

/**
 * Regression test for the customer-cancel audit trail gap.
 *
 * Before: prisma-checkout.repository.ts#cancelOrderTransaction updated
 * commissionRecord.refundedAdminEarning to the full adminEarning WITHOUT
 * (a) flipping status to REFUNDED and (b) writing a CommissionReversalRecord
 * audit row. Settlement reconciliation had no trace of the reversal event.
 *
 * After: the cancel path flips status to REFUNDED and writes one
 * CommissionReversalRecord with source=MANUAL, actorType=SYSTEM, and a
 * human-readable note. Mirrors the seller-path in the return-reversal
 * service so downstream reports treat both reversal flows identically.
 */

describe('PrismaCheckoutRepository.cancelOrderTransaction — commission audit', () => {
  const buildFixture = (hasCommission: boolean) => {
    const commissionRecord = hasCommission
      ? {
          id: 'cr-1',
          adminEarning: 75.25,
          totalPrice: 200,
        }
      : null;

    const tx: any = {
      masterOrder: { update: jest.fn().mockResolvedValue({}) },
      subOrder: { update: jest.fn().mockResolvedValue({}) },
      productVariant: { update: jest.fn().mockResolvedValue({}) },
      product: { update: jest.fn().mockResolvedValue({}) },
      commissionRecord: {
        findUnique: jest.fn().mockResolvedValue(commissionRecord),
        update: jest.fn().mockResolvedValue({}),
      },
      commissionReversalRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };

    const repo = new PrismaCheckoutRepository(prisma);

    const order: any = {
      id: 'order-1',
      orderNumber: 'ORD-00001',
      subOrders: [
        {
          id: 'so-1',
          items: [
            {
              id: 'oi-1',
              productId: 'p1',
              variantId: 'v1',
              quantity: 2,
            },
          ],
        },
      ],
    };
    return { repo, tx, order };
  };

  it('writes a MANUAL-source reversal audit row when commission exists', async () => {
    const { repo, tx, order } = buildFixture(true);

    await repo.cancelOrderTransaction(order);

    expect(tx.commissionReversalRecord.create).toHaveBeenCalledTimes(1);
    const args = tx.commissionReversalRecord.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      commissionRecordId: 'cr-1',
      source: 'MANUAL',
      reversedQty: 2,
      totalRefundAmount: 200,
      refundedAdminEarning: 75.25,
      actorType: 'SYSTEM',
    });
    expect(args.data.note).toContain('ORD-00001');
  });

  it('flips commission status to REFUNDED alongside running total', async () => {
    const { repo, tx, order } = buildFixture(true);

    await repo.cancelOrderTransaction(order);

    expect(tx.commissionRecord.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' },
      data: {
        refundedAdminEarning: 75.25,
        status: 'REFUNDED',
      },
    });
  });

  it('no-op when commission record does not exist', async () => {
    const { repo, tx, order } = buildFixture(false);

    await repo.cancelOrderTransaction(order);

    expect(tx.commissionRecord.update).not.toHaveBeenCalled();
    expect(tx.commissionReversalRecord.create).not.toHaveBeenCalled();
  });
});
