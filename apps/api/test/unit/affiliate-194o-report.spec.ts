// Phase 159e — §194-O quarterly TDS report (Form 26Q roll-up).

import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';

function buildSvc(groupRows: any[], affiliates: any[], meta: any[]) {
  const prisma = {
    affiliateTds194OLedger: {
      groupBy: jest.fn().mockResolvedValue(groupRows),
      findMany: jest.fn().mockResolvedValue(meta),
    },
    affiliate: { findMany: jest.fn().mockResolvedValue(affiliates) },
  } as any;
  return new AffiliatePayoutService(prisma, {} as any, {} as any, {} as any, {} as any);
}

describe('AffiliatePayoutService.get194OTdsReport (Phase 159e)', () => {
  it('aggregates per-affiliate gross/TDS for a quarter with PAN snapshot', async () => {
    const svc = buildSvc(
      [{ affiliateId: 'a1', _sum: { grossInPaise: 100000n, tdsInPaise: 1000n }, _count: 2 }],
      [{ id: 'a1', firstName: 'Riya', lastName: 'K', email: 'r@x.com' }],
      [{ affiliateId: 'a1', panLast4: '1234', hadPanOnFile: true, tdsRateBps: 100 }],
    );
    const res = await svc.get194OTdsReport('2026-Q1');
    expect(res.filingPeriod).toBe('2026-Q1');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      affiliateId: 'a1',
      affiliateName: 'Riya K',
      panLast4: '1234',
      hadPanOnFile: true,
      tdsRateBps: 100,
      payoutCount: 2,
      grossInPaise: '100000',
      tdsInPaise: '1000',
    });
    expect(res.totals).toMatchObject({ grossInPaise: '100000', tdsInPaise: '1000', affiliates: 1 });
  });

  it('returns an empty report for a quarter with no withheld TDS', async () => {
    const svc = buildSvc([], [], []);
    const res = await svc.get194OTdsReport('2025-Q4');
    expect(res.rows).toEqual([]);
    expect(res.totals.affiliates).toBe(0);
  });
});
