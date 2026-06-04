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

  // Phase 160 (§194-O affiliate audit #16) — correction flow.
  function buildReverseSvc(
    currentStatus: string | null,
    opts: { txCount?: number } = {},
  ) {
    const row =
      currentStatus === null
        ? null
        : {
            id: 'l1',
            status: currentStatus,
            affiliateId: 'aff1',
            filingPeriod: '2026-Q1',
            grossInPaise: 2_000_000n, // ₹20,000
            tdsInPaise: 10_000n, // ₹100
          };
    const findUnique = jest.fn().mockResolvedValue(row);
    const txCount = opts.txCount ?? (currentStatus && currentStatus !== 'REVERSED' ? 1 : 0);
    const ledgerUpdateMany = jest.fn().mockResolvedValue({ count: txCount });
    const tdsRecordUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      affiliateTds194OLedger: { updateMany: ledgerUpdateMany },
      affiliateTdsRecord: { updateMany: tdsRecordUpdateMany },
    };
    const prisma = {
      affiliateTds194OLedger: { findUnique, updateMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new AffiliatePayoutService(prisma, {} as any, {} as any, audit, {} as any);
    (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    return { svc, findUnique, ledgerUpdateMany, tdsRecordUpdateMany, audit };
  }

  it('reverseTds194O flips a WITHHELD row to REVERSED + audits + decrements cumulative', async () => {
    const { svc, ledgerUpdateMany, tdsRecordUpdateMany, audit } = buildReverseSvc('WITHHELD');
    const res = await svc.reverseTds194O({
      ledgerId: 'l1',
      reversedBy: 'admin1',
      reason: 'duplicate deduction',
    });
    expect(res).toEqual({ reversed: true, previousStatus: 'WITHHELD', wasAlreadyReversed: false });
    expect(ledgerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // CAS on the previously-read status so a concurrent transition can't be clobbered.
        where: { id: 'l1', status: 'WITHHELD' },
        data: expect.objectContaining({ status: 'REVERSED', reversalReason: 'duplicate deduction', reversedBy: 'admin1' }),
      }),
    );
    // Review fix — WITHHELD means markPaid bumped the cumulative, so the
    // reversal must decrement it (FY derived from the 2026-Q1 quarter).
    expect(tdsRecordUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { affiliateId: 'aff1', financialYear: '2026-27' },
        data: expect.objectContaining({
          cumulativeGross: { decrement: expect.anything() },
          cumulativeTds: { decrement: expect.anything() },
          cumulativeNet: { decrement: expect.anything() },
        }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFILIATE_TDS_REVERSED' }),
    );
  });

  it('reverseTds194O does NOT decrement the cumulative for a COMPUTED row (never bumped)', async () => {
    const { svc, tdsRecordUpdateMany } = buildReverseSvc('COMPUTED');
    const res = await svc.reverseTds194O({ ledgerId: 'l1', reversedBy: 'admin1', reason: 'wrong compute' });
    expect(res.reversed).toBe(true);
    // A COMPUTED payout was never PAID → markPaid never bumped the cumulative
    // → nothing to subtract. Decrementing would wrongly push it negative.
    expect(tdsRecordUpdateMany).not.toHaveBeenCalled();
  });

  it('reverseTds194O is idempotent on an already-REVERSED row (no write)', async () => {
    const { svc, ledgerUpdateMany } = buildReverseSvc('REVERSED');
    const res = await svc.reverseTds194O({ ledgerId: 'l1', reversedBy: 'admin1', reason: 'already done' });
    expect(res).toEqual({ reversed: false, previousStatus: 'REVERSED', wasAlreadyReversed: true });
    expect(ledgerUpdateMany).not.toHaveBeenCalled();
  });

  it('reverseTds194O reports a lost CAS race without decrementing', async () => {
    const { svc, tdsRecordUpdateMany } = buildReverseSvc('WITHHELD', { txCount: 0 });
    const res = await svc.reverseTds194O({ ledgerId: 'l1', reversedBy: 'admin1', reason: 'race condition' });
    expect(res.reversed).toBe(false);
    expect(tdsRecordUpdateMany).not.toHaveBeenCalled();
  });

  it('reverseTds194O rejects a too-short reason', async () => {
    const { svc } = buildReverseSvc('WITHHELD');
    await expect(
      svc.reverseTds194O({ ledgerId: 'l1', reversedBy: 'admin1', reason: 'x' }),
    ).rejects.toThrow(/reason/i);
  });

  it('reverseTds194O 404s on a missing ledger row', async () => {
    const { svc } = buildReverseSvc(null);
    await expect(
      svc.reverseTds194O({ ledgerId: 'ghost', reversedBy: 'admin1', reason: 'valid reason' }),
    ).rejects.toThrow(/not found/i);
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
