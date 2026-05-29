import 'reflect-metadata';
import { PrismaFranchisePosRepository } from '../../src/modules/franchise/infrastructure/repositories/prisma-franchise-pos.repository';
import { FranchisePosService } from '../../src/modules/franchise/application/services/franchise-pos.service';
import { BadRequestAppException } from '../../src/core/exceptions';

/**
 * Phase 159s — Daily POS Report audit.
 *   #1 net is refund-adjusted; #2 void/return counts; #6 GST; #9/#14 DB-side
 *   Decimal aggregation; #4 IST day boundaries; #7 CSV.
 */
describe('PrismaFranchisePosRepository.getDailyReport', () => {
  function repoWith() {
    const prisma: any = { franchisePosSale: { groupBy: jest.fn(), aggregate: jest.fn() } };
    prisma.franchisePosSale.groupBy
      .mockResolvedValueOnce([
        { status: 'COMPLETED', _count: { _all: 3 }, _sum: { netAmount: 300 } },
        { status: 'RETURNED', _count: { _all: 1 }, _sum: { netAmount: 100 } },
        { status: 'VOIDED', _count: { _all: 2 }, _sum: { netAmount: 200 } },
      ]) // by status
      .mockResolvedValueOnce([
        { paymentMethod: 'CASH', _count: { _all: 3 }, _sum: { netAmount: 300, refundedAmount: 100 } },
        { paymentMethod: 'UPI', _count: { _all: 1 }, _sum: { netAmount: 100, refundedAmount: 0 } },
      ]) // by paymentMethod
      .mockResolvedValueOnce([
        { saleType: 'WALK_IN', _count: { _all: 4 }, _sum: { netAmount: 400, refundedAmount: 100 } },
      ]); // by saleType
    prisma.franchisePosSale.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _sum: {
        grossAmount: 450, discountAmount: 50, netAmount: 400, refundedAmount: 100,
        cgstAmount: 18, sgstAmount: 18, igstAmount: 0,
      },
    });
    return new PrismaFranchisePosRepository(prisma);
  }
  const range = { gte: new Date('2026-05-22T18:30:00.000Z'), lte: new Date('2026-05-23T18:29:59.999Z') };

  it('#1 — net revenue excludes refunds (net − refunded)', async () => {
    const r = await repoWith().getDailyReport('fr-1', range);
    expect(r.totalNetAmount).toBe(300); // 400 net − 100 refunded
    expect(r.refundTotal).toBe(100);
    expect(r.salesByPaymentMethod['CASH']).toEqual({ count: 3, amount: 200 }); // 300 − 100
  });

  it('#2 — void + return counts are reported', async () => {
    const r = await repoWith().getDailyReport('fr-1', range);
    expect(r.voidedSales).toEqual({ count: 2, amount: 200 });
    expect(r.returnedSales).toEqual({ count: 1 });
  });

  it('#6 — GST breakdown is aggregated', async () => {
    const r = await repoWith().getDailyReport('fr-1', range);
    expect(r.tax).toEqual({ cgst: 18, sgst: 18, igst: 0, total: 36 });
  });
});

describe('FranchisePosService — IST day boundaries (#4) + CSV (#7)', () => {
  function build() {
    const posRepo: any = {
      getDailyReport: jest.fn().mockResolvedValue({
        totalSales: 4, totalGrossAmount: 450, totalDiscountAmount: 50, totalNetAmount: 300,
        salesByPaymentMethod: { CASH: { count: 3, amount: 200 } }, salesByType: { WALK_IN: { count: 4, amount: 300 } },
        refundTotal: 100, voidedSales: { count: 2, amount: 200 }, returnedSales: { count: 1 },
        tax: { cgst: 18, sgst: 18, igst: 0, total: 36 },
      }),
    };
    const env: any = { getNumber: jest.fn().mockReturnValue(330) }; // IST
    const logger: any = { setContext: jest.fn() };
    const service = new FranchisePosService(
      posRepo, {} as any, {} as any, {} as any, {} as any, {} as any, logger, {} as any, {} as any, env,
    );
    return { service, posRepo };
  }

  it('resolves an IST calendar date to the correct UTC window (no wrong-day bleed)', async () => {
    const { service, posRepo } = build();
    await service.getDailyReport('fr-1', '2026-05-23');
    const range = posRepo.getDailyReport.mock.calls[0][1];
    // IST 2026-05-23 00:00 = UTC 2026-05-22 18:30; end = UTC 2026-05-23 18:29:59.999.
    expect(range.gte.toISOString()).toBe('2026-05-22T18:30:00.000Z');
    expect(range.lte.toISOString()).toBe('2026-05-23T18:29:59.999Z');
    // A 2026-05-24 00:15 IST sale = 2026-05-23 18:45 UTC is AFTER the upper bound → excluded.
    expect(new Date('2026-05-23T18:45:00.000Z').getTime()).toBeGreaterThan(range.lte.getTime());
  });

  it('rejects a future report date', async () => {
    const { service } = build();
    const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(service.getDailyReport('fr-1', tomorrow)).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#7 — CSV export carries the refund-adjusted net + headers', async () => {
    const { service } = build();
    const csv = await service.getDailyReportCsv('fr-1', '2026-05-23');
    expect(csv).toContain('metric,value');
    expect(csv).toContain('Net Revenue (after refunds),300');
    expect(csv).toContain('Voided Count,2');
    expect(csv).toContain('Tax Total,36');
  });
});
