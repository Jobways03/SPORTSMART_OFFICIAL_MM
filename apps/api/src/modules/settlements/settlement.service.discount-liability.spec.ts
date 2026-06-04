/**
 * Phase 247 (discount-LIABILITY audit) — focused coverage for the
 * seller-funded discount-deduction reads on SettlementService.
 *
 * #17 (the money bug): a returned item writes a NEW DiscountLiabilityLedger
 * row with a NEGATIVE amount_in_paise and status REVERSED, leaving the
 * original APPLIED row intact. The three seller-deduction reads previously
 * filtered status IN ('APPLIED','SETTLED'), which EXCLUDED the REVERSED
 * credit — so a seller kept eating the full discount even on returned items.
 * These tests pin that the reads now include REVERSED and net the signed
 * amount (APPLIED positive + REVERSED negative = net after returns), without
 * any abs().
 *
 * Mirrors the table-level Prisma mock + $transaction shim + 6-arg constructor
 * used by settlement.service.approve.spec.ts so the dependency surface stays
 * in lock-step.
 */
import 'reflect-metadata';
import { SettlementService } from './settlement.service';

function buildService(ledgerRows: any[]) {
  // Aggregate over the SIGNED amount_in_paise for the rows the where-clause
  // would have matched — the production code relies on Prisma summing the
  // signed column, so the mock reproduces that (no abs()).
  const ledgerAggregate = jest.fn(async ({ where }: any) => {
    const matched = ledgerRows.filter((r) =>
      where.status.in.includes(r.status),
    );
    const sum = matched.reduce((acc, r) => acc + BigInt(r.amountInPaise), 0n);
    return { _sum: { amountInPaise: sum }, _count: matched.length };
  });
  const ledgerFindMany = jest.fn(async ({ where }: any) =>
    ledgerRows.filter((r) => where.status.in.includes(r.status)),
  );
  const ledgerCount = jest.fn(async ({ where }: any) =>
    ledgerRows.filter((r) => where.status.in.includes(r.status)).length,
  );

  const client: any = {
    commissionRecord: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalSettlementAmount: null },
      }),
    },
    sellerSettlement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    discountLiabilityLedger: {
      aggregate: ledgerAggregate,
      findMany: ledgerFindMany,
      count: ledgerCount,
    },
  };
  client.$transaction = jest.fn(async (cb: any) => cb(client));

  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const moneyDualWrite = {
    applyPaise: jest.fn((_t: string, d: any) => d),
  } as any;
  const tcsHook = {} as any;
  const tdsHook = {} as any;
  const commissionInvoice = {} as any;

  const service = new SettlementService(
    client,
    audit,
    moneyDualWrite,
    tcsHook,
    tdsHook,
    commissionInvoice,
  );
  return { service, ledgerAggregate, ledgerFindMany, ledgerCount };
}

// One ₹100 seller-funded discount (10000 paise APPLIED) and a full return
// that credited it back (−10000 paise REVERSED). Net seller deduction = 0.
const APPLIED_ROW = {
  sellerId: 's-1',
  status: 'APPLIED',
  amountInPaise: 10000n,
  masterOrderId: 'mo-1',
  subOrderId: 'so-1',
  orderItemId: 'oi-1',
  discountId: 'd-1',
  discountCode: 'SAVE100',
  fundingType: 'SELLER',
  reason: null,
  createdAt: new Date('2026-05-10T00:00:00Z'),
};
const REVERSED_ROW = {
  sellerId: 's-1',
  status: 'REVERSED',
  amountInPaise: -10000n, // negative = credit back (proven negative in source)
  masterOrderId: 'mo-1',
  subOrderId: 'so-1',
  orderItemId: 'oi-1',
  discountId: 'd-1',
  discountCode: 'SAVE100',
  fundingType: 'SELLER',
  reason: 'RETURN_REFUND',
  createdAt: new Date('2026-05-12T00:00:00Z'),
};

describe('SettlementService — discount-liability nets REVERSED (Phase 247 #17)', () => {
  describe('getSellerEarningsSummary', () => {
    it('nets the REVERSED credit-back to zero on a fully-returned discount', async () => {
      const { service, ledgerAggregate } = buildService([
        APPLIED_ROW,
        REVERSED_ROW,
      ]);
      const res = await service.getSellerEarningsSummary('s-1');
      // 10000 (APPLIED) + (−10000) (REVERSED) = 0 — the seller no longer eats it.
      expect(res.discountDeductions.totalAmountInPaise).toBe('0');
      // The read must include REVERSED in the status filter.
      expect(ledgerAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
          }),
        }),
      );
    });

    it('keeps the full deduction when there is no return (APPLIED only)', async () => {
      const { service } = buildService([APPLIED_ROW]);
      const res = await service.getSellerEarningsSummary('s-1');
      expect(res.discountDeductions.totalAmountInPaise).toBe('10000');
    });

    it('nets a PARTIAL return (−4000 of a 10000 deduction → 6000)', async () => {
      const { service } = buildService([
        APPLIED_ROW,
        { ...REVERSED_ROW, amountInPaise: -4000n },
      ]);
      const res = await service.getSellerEarningsSummary('s-1');
      expect(res.discountDeductions.totalAmountInPaise).toBe('6000');
    });
  });

  describe('getSellerDiscountDeductions', () => {
    it('lists the REVERSED row and reports a net of zero', async () => {
      const { service, ledgerFindMany } = buildService([
        APPLIED_ROW,
        REVERSED_ROW,
      ]);
      const res = await service.getSellerDiscountDeductions('s-1', 1, 50);
      // Both rows surface (gross + the credit-back), and the net is zero.
      expect(res.items).toHaveLength(2);
      expect(res.netDeductionInPaise).toBe('0');
      // Signed amount preserved on the wire (negative for REVERSED).
      const reversed = res.items.find((i: any) => i.status === 'REVERSED');
      expect(reversed?.amountInPaise).toBe('-10000');
      expect(ledgerFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
          }),
        }),
      );
    });
  });
});
