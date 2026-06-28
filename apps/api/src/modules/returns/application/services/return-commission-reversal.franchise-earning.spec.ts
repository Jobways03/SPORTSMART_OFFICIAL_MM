// Franchise online-return commission reversal must claw back the franchise's
// ACTUAL EARNING (proportionally), NOT the gross customer refund.
//
// Bug (staging, screenshot SM-FR-000001): a returned online order booked a
// RETURN_REVERSAL of ₹909 — the GST-inclusive customer price (unitPrice × qty)
// — while the franchise had only ever been credited its net earning ₹654.78
// (₹770.33 taxable − 15% commission). Reversing the gross bundled in the 18%
// GST + the platform's commission the franchise never received, leaving a
// fully-returned order at a NET LOSS for the franchise and driving the
// settlement's payable negative (then floored to ₹0).
//
// After the fix the reversal mirrors the franchise-orders counter-return path:
// proportion = returnedGross / subOrderGross, applied to the ORIGINAL
// franchiseEarning, so a full return nets the franchise to ₹0.

import { ReturnCommissionReversalService } from './return-commission-reversal.service';

function buildDeps(args: {
  originalLedger: any;
  subOrderItems: Array<{ unitPrice: any; quantity: number }>;
}) {
  const db: any = {
    franchiseFinanceLedger: {
      findFirst: jest.fn().mockResolvedValue(args.originalLedger),
    },
    orderItem: {
      findMany: jest.fn().mockResolvedValue(args.subOrderItems),
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
  return { service, franchiseFacade };
}

// One returned line: gross unitPrice ₹909 (= ₹770.33 taxable × 1.18).
const franchiseReturn = (returnedItems: any[]) => ({
  id: 'ret-fr-1',
  returnNumber: 'RET-FR-1',
  subOrder: {
    fulfillmentNodeType: 'FRANCHISE',
    sellerId: null,
    franchiseId: 'fr-vijay',
    id: 'so-fr-1',
  },
  items: returnedItems,
});

describe('ReturnCommissionReversalService — franchise earning (not gross) reversal', () => {
  it('reverses the franchise EARNING (₹654.78), not the gross refund (₹909), on a full return', async () => {
    const { service, franchiseFacade } = buildDeps({
      // The order's ONLINE_ORDER ledger row: net taxable ₹770.33, earning ₹654.78.
      originalLedger: {
        id: 'led-1',
        franchiseEarning: '654.78',
        baseAmount: '770.33',
        settlementBatch: null,
      },
      // Whole sub-order is this single ₹909-gross line.
      subOrderItems: [{ unitPrice: '909', quantity: 1 }],
    });

    await service.reverseCommissionForReturn(
      franchiseReturn([
        {
          id: 'ri1',
          qcQuantityApproved: 1,
          refundValueFraction: 1,
          orderItem: { id: 'oi1', unitPrice: '909', quantity: 1 },
        },
      ]),
    );

    expect(franchiseFacade.recordReturnReversal).toHaveBeenCalledTimes(1);
    const arg = franchiseFacade.recordReturnReversal.mock.calls[0][0];
    expect(arg.reversalAmount).toBeCloseTo(654.78, 2); // NOT 909
    expect(arg.subOrderId).toBe('so-fr-1');
    expect(arg.franchiseId).toBe('fr-vijay');
  });

  it('reverses only the returned share of the earning on a partial return', async () => {
    const { service, franchiseFacade } = buildDeps({
      // Two ₹909-gross lines; total taxable ₹1,540.66, total earning ₹1,309.56.
      originalLedger: {
        id: 'led-2',
        franchiseEarning: '1309.56',
        baseAmount: '1540.66',
        settlementBatch: null,
      },
      subOrderItems: [
        { unitPrice: '909', quantity: 1 },
        { unitPrice: '909', quantity: 1 },
      ],
    });

    await service.reverseCommissionForReturn(
      franchiseReturn([
        {
          id: 'ri1',
          qcQuantityApproved: 1,
          refundValueFraction: 1,
          orderItem: { id: 'oi1', unitPrice: '909', quantity: 1 },
        },
      ]),
    );

    // returnedGross 909 / subOrderGross 1818 = 0.5 → 1309.56 × 0.5 = 654.78.
    const arg = franchiseFacade.recordReturnReversal.mock.calls[0][0];
    expect(arg.reversalAmount).toBeCloseTo(654.78, 2);
  });

  it('falls back to the gross refund only when no original ONLINE_ORDER ledger row exists', async () => {
    const { service, franchiseFacade } = buildDeps({
      originalLedger: null, // return landed before commission was recorded
      subOrderItems: [],
    });

    await service.reverseCommissionForReturn(
      franchiseReturn([
        {
          id: 'ri1',
          qcQuantityApproved: 1,
          refundValueFraction: 1,
          orderItem: { id: 'oi1', unitPrice: '909', quantity: 1 },
        },
      ]),
    );

    const arg = franchiseFacade.recordReturnReversal.mock.calls[0][0];
    expect(arg.reversalAmount).toBeCloseTo(909, 2); // standalone fallback
  });
});
