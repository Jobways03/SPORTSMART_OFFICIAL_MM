// Phase 159f — Affiliate TDS deposit + Form 16A certificate lifecycle.

import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';

function buildSvc(over: {
  updateManyCount?: number;
  ledgerRows?: any[];
} = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: over.updateManyCount ?? 2 });
  const findMany = jest.fn().mockResolvedValue(over.ledgerRows ?? []);
  const prisma = {
    affiliateTds194OLedger: { updateMany, findMany },
    platformGstProfile: {
      findFirst: jest.fn().mockResolvedValue({
        legalBusinessName: 'Sportsmart Pvt Ltd',
        panNumber: 'AAAAA0000A',
        registeredAddressJson: { line1: '1 Main St', city: 'Mumbai', state: 'MH', pincode: '400001' },
      }),
    },
  } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliatePayoutService(prisma, {} as any, {} as any, audit, {} as any);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, updateMany, findMany, audit };
}

describe('AffiliatePayoutService — §194-O deposit/certificate (Phase 159f)', () => {
  it('markTds194ODeposited flips only WITHHELD rows + writes audit', async () => {
    const { svc, updateMany, audit } = buildSvc({ updateManyCount: 3 });
    const res = await svc.markTds194ODeposited({
      ledgerIds: ['l1', 'l2', 'l3'],
      depositedBy: 'admin1',
      challanReference: 'CHL-123',
    });
    expect(res.flipped).toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['l1', 'l2', 'l3'] }, status: 'WITHHELD' },
        data: expect.objectContaining({ status: 'DEPOSITED', challanReference: 'CHL-123' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFILIATE_TDS_DEPOSITED' }),
    );
  });

  it('markTds194OCertificateIssued flips only DEPOSITED rows', async () => {
    const { svc, updateMany } = buildSvc({ updateManyCount: 1 });
    await svc.markTds194OCertificateIssued({
      ledgerIds: ['l1'],
      issuedBy: 'admin1',
      certificateNumber: 'FORM16A-2026-Q1-007',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['l1'] }, status: 'DEPOSITED' },
        data: expect.objectContaining({ status: 'CERTIFICATE_ISSUED', certificateNumber: 'FORM16A-2026-Q1-007' }),
      }),
    );
  });

  it('empty ledgerIds is a no-op (no DB write)', async () => {
    const { svc, updateMany } = buildSvc();
    const res = await svc.markTds194ODeposited({ ledgerIds: [], depositedBy: 'a', challanReference: 'c' });
    expect(res.flipped).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('renderAffiliateForm16A → null when no CERTIFICATE_ISSUED rows', async () => {
    const { svc } = buildSvc({ ledgerRows: [] });
    expect(await svc.renderAffiliateForm16A('aff1', '2026-Q1')).toBeNull();
  });

  it('renderAffiliateForm16A aggregates the quarter + masks PAN from the snapshot', async () => {
    const { svc } = buildSvc({
      ledgerRows: [
        {
          affiliate: { firstName: 'Riya', lastName: 'K' },
          grossInPaise: 100000n,
          tdsInPaise: 1000n,
          tdsRateBps: 100,
          panLast4: '1234',
          certificateNumber: 'FORM16A-2026-Q1-007',
          challanReference: 'CHL-9',
          depositedAt: new Date('2026-07-01'),
          certificateIssuedAt: new Date('2026-07-10'),
        },
        {
          affiliate: { firstName: 'Riya', lastName: 'K' },
          grossInPaise: 50000n,
          tdsInPaise: 500n,
          tdsRateBps: 100,
          panLast4: '1234',
          certificateNumber: 'FORM16A-2026-Q1-007',
          challanReference: 'CHL-9',
          depositedAt: new Date('2026-07-01'),
          certificateIssuedAt: new Date('2026-07-10'),
        },
      ],
    });
    const html = await svc.renderAffiliateForm16A('aff1', '2026-Q1');
    expect(typeof html).toBe('string');
    expect(html).toContain('FORM16A-2026-Q1-007'); // certificate number rendered
    expect(html).toContain('1234'); // affiliate PAN shown masked (last4 from the frozen snapshot)
    expect(html).toContain('Riya'); // deductee name
  });

  it('getAffiliateTaxSummary: download enabled only when the whole quarter is CERTIFICATE_ISSUED', async () => {
    const { svc } = buildSvc({
      ledgerRows: [
        { filingPeriod: '2026-Q1', status: 'CERTIFICATE_ISSUED', grossInPaise: 100000n, tdsInPaise: 1000n },
        { filingPeriod: '2026-Q1', status: 'CERTIFICATE_ISSUED', grossInPaise: 50000n, tdsInPaise: 500n },
        { filingPeriod: '2026-Q2', status: 'WITHHELD', grossInPaise: 20000n, tdsInPaise: 200n },
      ],
    });
    const out = await svc.getAffiliateTaxSummary('aff1');
    const q1 = out.find((q) => q.filingPeriod === '2026-Q1')!;
    const q2 = out.find((q) => q.filingPeriod === '2026-Q2')!;
    expect(q1.canDownloadForm16A).toBe(true);
    expect(q1.tdsInPaise).toBe('1500');
    expect(q2.canDownloadForm16A).toBe(false);
    expect(q2.status).toBe('Pending deposit');
  });
});
