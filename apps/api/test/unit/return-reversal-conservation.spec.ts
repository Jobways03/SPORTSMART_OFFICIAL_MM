import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { ReturnCommissionReversalService } from '../../src/modules/returns/application/services/return-commission-reversal.service';

/**
 * Regression test for proportional refund drift in seller returns.
 *
 * Before: refundedMargin was computed as
 *   Math.round(Number(platformMargin) * (approvedQty / totalQty) * 100) / 100
 * which, for platformMargin values that don't divide cleanly (e.g. 10.00 /
 * totalQty 3), produces 3.33 per unit. Three separate partial returns of 1
 * unit each accumulated to 9.99 — one paise short of the original 10.00.
 *
 * After: the service computes cumulative approved qty from CommissionReversalRecord,
 * and when the final partial return completes the item it uses
 * `platformMargin − alreadyRefunded` as the tail refund — restoring the
 * conservation invariant ∑(refunds) == platformMargin.
 */

describe('ReturnCommissionReversalService — refund conservation across partial returns', () => {
  const makeTx = (state: {
    commissionRecord: {
      id: string;
      platformMargin: number | string;
      refundedAdminEarning: number | string;
      status: 'PENDING' | 'SETTLED' | 'REFUNDED';
      sellerSettlement: { paidAt: Date | null } | null;
    };
    priorReversals: Array<{ reversedQty: number }>;
  }) => {
    const tx: any = {
      commissionRecord: {
        findUnique: jest.fn().mockResolvedValue(state.commissionRecord),
        update: jest.fn().mockImplementation(async (args: any) => {
          if (args.data.refundedAdminEarning?.increment !== undefined) {
            const current = new Prisma.Decimal(
              state.commissionRecord.refundedAdminEarning,
            );
            const inc = new Prisma.Decimal(args.data.refundedAdminEarning.increment);
            state.commissionRecord.refundedAdminEarning = current
              .add(inc)
              .toNumber();
          }
          if (args.data.status) {
            state.commissionRecord.status = args.data.status;
          }
        }),
      },
      commissionReversalRecord: {
        findMany: jest.fn().mockResolvedValue(state.priorReversals),
        create: jest.fn().mockImplementation(async (args: any) => {
          state.priorReversals.push({ reversedQty: args.data.reversedQty });
        }),
      },
    };
    return tx;
  };

  const makeService = () => {
    const prisma: any = {
      franchiseFinanceLedger: { findFirst: jest.fn() },
    };
    const franchiseFacade: any = {};
    const logger: any = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), setContext: jest.fn() };
    const envService: any = {
      getNumber: (_k: string, d: number) => d,
    };
    return new ReturnCommissionReversalService(
      prisma,
      franchiseFacade,
      logger,
      envService,
    );
  };

  const reverseOne = async (
    svc: ReturnCommissionReversalService,
    tx: any,
    opts: { approvedQty: number; orderItemQty: number; unitPrice: number },
    returnNumber: string,
  ) => {
    const returnRecord = {
      id: `ret-${returnNumber}`,
      returnNumber,
      subOrder: { fulfillmentNodeType: 'SELLER', franchiseId: null },
      items: [
        {
          qcQuantityApproved: opts.approvedQty,
          orderItem: {
            id: 'oi-1',
            quantity: opts.orderItemQty,
            unitPrice: opts.unitPrice,
          },
        },
      ],
    };
    return svc.reverseCommissionForReturn(returnRecord, tx);
  };

  it('single full refund matches platformMargin exactly', async () => {
    const state = {
      commissionRecord: {
        id: 'cr-1',
        platformMargin: 10,
        refundedAdminEarning: 0,
        status: 'PENDING' as const,
        sellerSettlement: null,
      },
      priorReversals: [],
    };
    const tx = makeTx(state);
    const svc = makeService();

    await reverseOne(svc, tx, { approvedQty: 3, orderItemQty: 3, unitPrice: 5 }, 'R1');

    expect(state.commissionRecord.refundedAdminEarning).toBeCloseTo(10, 10);
    expect(state.commissionRecord.status).toBe('REFUNDED');
  });

  it('three partial refunds of 1/3 conserve platformMargin (no 0.01 drift)', async () => {
    const state = {
      commissionRecord: {
        id: 'cr-2',
        platformMargin: 10,
        refundedAdminEarning: 0,
        status: 'PENDING' as const,
        sellerSettlement: null,
      },
      priorReversals: [] as Array<{ reversedQty: number }>,
    };
    const tx = makeTx(state);
    const svc = makeService();

    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R1');
    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R2');
    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R3');

    // Critical assertion: cumulative refund == original platformMargin.
    expect(state.commissionRecord.refundedAdminEarning).toBeCloseTo(10, 10);
    expect(state.commissionRecord.status).toBe('REFUNDED');
  });

  it('asymmetric partials (1 + 2) conserve platformMargin', async () => {
    const state = {
      commissionRecord: {
        id: 'cr-3',
        platformMargin: 10,
        refundedAdminEarning: 0,
        status: 'PENDING' as const,
        sellerSettlement: null,
      },
      priorReversals: [] as Array<{ reversedQty: number }>,
    };
    const tx = makeTx(state);
    const svc = makeService();

    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R1');
    await reverseOne(svc, tx, { approvedQty: 2, orderItemQty: 3, unitPrice: 5 }, 'R2');

    expect(state.commissionRecord.refundedAdminEarning).toBeCloseTo(10, 10);
    expect(state.commissionRecord.status).toBe('REFUNDED');
  });

  it('single partial refund uses proportional share (not marked REFUNDED)', async () => {
    const state = {
      commissionRecord: {
        id: 'cr-4',
        platformMargin: 10,
        refundedAdminEarning: 0,
        status: 'PENDING' as const,
        sellerSettlement: null,
      },
      priorReversals: [] as Array<{ reversedQty: number }>,
    };
    const tx = makeTx(state);
    const svc = makeService();

    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R1');

    expect(state.commissionRecord.refundedAdminEarning).toBeCloseTo(3.33, 2);
    expect(state.commissionRecord.status).toBe('PENDING');
  });

  it('hard-to-divide margin (7/3) still conserves to exactly platformMargin', async () => {
    const state = {
      commissionRecord: {
        id: 'cr-5',
        platformMargin: 7,
        refundedAdminEarning: 0,
        status: 'PENDING' as const,
        sellerSettlement: null,
      },
      priorReversals: [] as Array<{ reversedQty: number }>,
    };
    const tx = makeTx(state);
    const svc = makeService();

    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R1');
    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R2');
    await reverseOne(svc, tx, { approvedQty: 1, orderItemQty: 3, unitPrice: 5 }, 'R3');

    expect(state.commissionRecord.refundedAdminEarning).toBeCloseTo(7, 10);
    expect(state.commissionRecord.status).toBe('REFUNDED');
  });
});
