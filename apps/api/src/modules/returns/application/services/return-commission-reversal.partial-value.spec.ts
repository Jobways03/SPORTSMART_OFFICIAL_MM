// Partial-VALUE refund coverage for ReturnCommissionReversalService.
//
// When an admin issues a partial-amount refund on a PARTIAL QC outcome, the
// CUSTOMER is refunded only that amount and the seller commission clawback
// must scale by the same fraction (give back only a slice of the margin).
// Critically, a partial-value refund must NOT mark the commission fully
// refunded even though the whole quantity is "returned" — the seller keeps
// the margin on the un-refunded value.

import { CommissionRecordStatus, Prisma } from '@prisma/client';
import { ReturnCommissionReversalService } from './return-commission-reversal.service';

function buildDeps(commissionRecord: any) {
  const db: any = {
    commissionRecord: {
      findUnique: jest.fn().mockResolvedValue(commissionRecord),
      update: jest.fn().mockResolvedValue({}),
    },
    commissionReversalRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const franchiseFacade = {
    recordReturnReversal: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const envService = { getNumber: jest.fn((_k: string, d: number) => d) };
  const service = new ReturnCommissionReversalService(
    db as any,
    franchiseFacade as any,
    logger as any,
    envService as any,
  );
  return { service, db };
}

const sellerReturn = (fraction: number | undefined) => ({
  id: 'ret1',
  returnNumber: 'RET-1',
  subOrder: { fulfillmentNodeType: 'SELLER', sellerId: 'seller-a', id: 'so1' },
  items: [
    {
      id: 'ri1',
      qcQuantityApproved: 1,
      refundValueFraction: fraction,
      orderItem: { id: 'oi1', unitPrice: 5000, quantity: 1 },
    },
  ],
});

const commissionRecord = () => ({
  id: 'cr1',
  orderItemId: 'oi1',
  platformMargin: 1000,
  refundedAdminEarning: 0,
  status: 'PENDING',
  sellerSettlement: null,
});

describe('ReturnCommissionReversalService — partial-VALUE refund', () => {
  it('scales the customer refund + seller clawback by the fraction and keeps PENDING', async () => {
    const { service, db } = buildDeps(commissionRecord());
    const total = await service.reverseCommissionForReturn(sellerReturn(0.6));

    // Customer refund total = unitPrice × qty × fraction = 5000 × 1 × 0.6.
    expect(total).toBe(3000);

    // Commission clawback = platformMargin × (1/1) × 0.6 = 600; status stays
    // PENDING because the value is not fully refunded (seller keeps the rest).
    const createArg = db.commissionReversalRecord.create.mock.calls[0][0].data;
    expect(createArg.refundedAdminEarning).toBe(600);
    expect(createArg.totalRefundAmount).toBe(3000);
    expect(createArg.reversedQty).toBe(1);
    expect(createArg.note).toContain('Partial-value');

    const updateArg = db.commissionRecord.update.mock.calls[0][0].data;
    expect(updateArg.status).toBe(CommissionRecordStatus.PENDING);
    expect(
      (updateArg.refundedAdminEarning.increment as Prisma.Decimal).toNumber(),
    ).toBe(600);
  });

  it('full refund (no fraction) reverses the entire margin and marks REFUNDED', async () => {
    const { service, db } = buildDeps(commissionRecord());
    const total = await service.reverseCommissionForReturn(sellerReturn(undefined));

    expect(total).toBe(5000);
    const createArg = db.commissionReversalRecord.create.mock.calls[0][0].data;
    expect(createArg.refundedAdminEarning).toBe(1000);
    const updateArg = db.commissionRecord.update.mock.calls[0][0].data;
    expect(updateArg.status).toBe(CommissionRecordStatus.REFUNDED);
  });
});
