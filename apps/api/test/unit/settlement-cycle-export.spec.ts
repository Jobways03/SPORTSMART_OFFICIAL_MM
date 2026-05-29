// Phase 148 — settlement cycle Tally CSV export: formula-injection-safe (shared
// toCsv), includes franchise rows + tax/payment/approved-net columns, and
// writes a forensic audit row.

import { SettlementService } from '../../src/modules/settlements/settlement.service';
import { NotFoundAppException } from '../../src/core/exceptions';

function build(cycle: any) {
  const prisma = {
    settlementCycle: { findUnique: jest.fn().mockResolvedValue(cycle) },
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new SettlementService(
    prisma as any,
    audit as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, audit };
}

const cycle = {
  id: 'abcdef12-3456-7890-abcd-ef1234567890',
  periodStart: new Date('2026-05-01T00:00:00Z'),
  periodEnd: new Date('2026-05-31T00:00:00Z'),
  sellerSettlements: [
    {
      sellerId: 's1',
      status: 'PAID',
      totalSettlementAmount: '90.00',
      approvedSettlementAmount: '100.00',
      totalPlatformMargin: '10.00',
      totalItems: 5,
      paidAt: new Date('2026-06-01T00:00:00Z'),
      utrReference: 'HDFCUTR0001',
      tcsDeductedInPaise: 100n,
      tdsDeductedInPaise: 50n,
      cgstOnCommissionInPaise: 90n,
      sgstOnCommissionInPaise: 90n,
      igstOnCommissionInPaise: 0n,
      totalCommissionGstInPaise: 180n,
      // CSV-injection probe in the seller shop name:
      seller: {
        sellerShopName: '=cmd|calc',
        sellerName: 'Evil',
        gstin: '29ABCDE1234F1Z5',
        legalBusinessName: 'Evil Pvt Ltd',
        gstStateCode: '29',
      },
    },
  ],
  franchiseSettlements: [
    {
      franchiseId: 'f1',
      status: 'APPROVED',
      netPayableToFranchise: '500.00',
      paidAt: null,
      paymentReference: null,
      franchise: {
        businessName: 'Franchise A',
        gstNumber: '29XYZAB1234C1Z0',
        panNumber: 'XYZAB1234C',
        gstStateCode: '29',
      },
    },
  ],
};

describe('SettlementService.exportCycleToTallyCsv (Phase 148)', () => {
  it('neutralises a CSV formula-injection payload in a seller field', async () => {
    const { svc } = build(cycle);
    const csv = await svc.exportCycleToTallyCsv('abcdef12-3456-7890-abcd-ef1234567890');
    // The =cmd|calc cell is prefixed with a single quote (won't execute in Excel/Tally).
    expect(csv).toContain("'=cmd|calc");
    // …and never appears as a bare cell-start `,=cmd`.
    expect(csv).not.toMatch(/,=cmd\|calc(,|\r|\n)/);
  });

  it('includes franchise rows alongside seller rows', async () => {
    const { svc } = build(cycle);
    const csv = await svc.exportCycleToTallyCsv('abcdef12-3456-7890-abcd-ef1234567890');
    expect(csv).toMatch(/(^|,)SELLER(,|$)/m);
    expect(csv).toMatch(/(^|,)FRANCHISE(,|$)/m);
    expect(csv).toContain('Franchise A');
  });

  it('surfaces tax, approved/adjustments/net, payment status + UTR columns', async () => {
    const { svc } = build(cycle);
    const csv = await svc.exportCycleToTallyCsv('abcdef12-3456-7890-abcd-ef1234567890');
    const header = csv.split('\n')[0];
    for (const col of ['TCS Deducted', 'TDS Deducted', 'Total Commission GST', 'Approved Amount', 'Adjustments Total', 'Net Payable', 'Payment Status', 'UTR Reference', 'GSTIN', 'PAN']) {
      expect(header).toContain(col);
    }
    // paise → rupees: 100p TCS, 180p GST; approved 100, net 90, adjustment -10.
    expect(csv).toContain('1.00'); // TCS
    expect(csv).toContain('1.80'); // total commission GST
    expect(csv).toContain('-10.00'); // adjustments (net 90 − approved 100)
    expect(csv).toContain('HDFCUTR0001'); // UTR
    expect(csv).toContain('PAID');
    expect(csv).toContain('ABCDE1234F'); // PAN derived from GSTIN chars 3-12
  });

  it('writes a forensic audit row when an actor is supplied', async () => {
    const { svc, audit } = build(cycle);
    await svc.exportCycleToTallyCsv('abcdef12-3456-7890-abcd-ef1234567890', { adminId: 'admin1' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settlement.cycle_exported',
        resourceId: 'abcdef12-3456-7890-abcd-ef1234567890',
        newValue: expect.objectContaining({ sellerCount: 1, franchiseCount: 1 }),
      }),
    );
  });

  it('404s on a missing cycle', async () => {
    const { svc } = build(null);
    await expect(svc.exportCycleToTallyCsv('missing')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});
