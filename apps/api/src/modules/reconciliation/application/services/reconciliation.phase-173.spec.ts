import { ReconciliationService } from './reconciliation.service';
import { ConflictAppException, NotFoundAppException } from '../../../../core/exceptions';

// Phase 173 — Finance Reconciliation Runs audit remediation.

function makeService(overrides: Record<string, any> = {}) {
  const discrepancies: any[] = [];
  const prisma: any = {
    reconciliationRun: {
      create: jest.fn().mockResolvedValue({ id: 'run-1', runNumber: 'RECON-2026-X', status: 'QUEUED', kind: 'PAYMENT' }),
      update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'run-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    reconciliationDiscrepancy: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        discrepancies.push(data);
        return { id: `disc-${discrepancies.length}`, ...data };
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Phase 174 — transition now writes a history row inside a $transaction.
    discrepancyStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    masterOrder: { findMany: jest.fn().mockResolvedValue([]) },
    subOrder: { findMany: jest.fn().mockResolvedValue([]) },
    sellerSettlement: { findMany: jest.fn().mockResolvedValue([]) },
    return: { findMany: jest.fn().mockResolvedValue([]) },
    affiliatePayoutRequest: { findMany: jest.fn().mockResolvedValue([]) },
    affiliateCommission: { findMany: jest.fn().mockResolvedValue([]) },
    refundInstruction: { findMany: jest.fn().mockResolvedValue([]) },
    section194OTdsLedger: { findMany: jest.fn().mockResolvedValue([]) },
    gstTcsSettlementLedger: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    // Phase 174 — run the transaction callback against the same mocked client.
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(prisma)),
    ...overrides,
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new ReconciliationService(prisma as any, eventBus as any, audit as any);
  return { svc, prisma, audit, eventBus, discrepancies };
}

const period = { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01') };

describe('#2 concurrent-run prevention', () => {
  it('refuses a second live run for the same (kind, period)', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationRun.findFirst.mockResolvedValue({ id: 'existing-run' });
    await expect(
      svc.enqueueRun({ kind: 'PAYMENT', ...period }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(prisma.reconciliationRun.create).not.toHaveBeenCalled();
  });

  it('maps a P2002 race on the partial-unique index to a 409', async () => {
    const { svc, prisma } = makeService();
    const { Prisma } = require('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.reconciliationRun.create.mockRejectedValue(p2002);
    await expect(
      svc.enqueueRun({ kind: 'PAYMENT', ...period }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects an inverted / invalid period', async () => {
    const { svc } = makeService();
    await expect(
      svc.enqueueRun({ kind: 'PAYMENT', periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-01-01') }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});

describe('#1 async lifecycle', () => {
  it('executeRun CAS-claims QUEUED→RUNNING and no-ops if already claimed', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationRun.updateMany.mockResolvedValue({ count: 0 }); // lost the claim
    await svc.executeRun('run-1');
    expect(prisma.reconciliationRun.findUnique).not.toHaveBeenCalled();
  });

  // Adversarial-review fix: runAndCollect must OWN the single executeRun (not
  // race a detached one), so the row it returns is terminal.
  it('runAndCollect creates the run then awaits exactly one executeRun (terminal row)', async () => {
    const { svc, prisma } = makeService();
    // claim succeeds; the run is found + dispatched (all runners empty → COMPLETED).
    prisma.reconciliationRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.reconciliationRun.findUnique
      .mockResolvedValueOnce({ id: 'run-1', kind: 'PAYMENT', periodStart: period.periodStart, periodEnd: period.periodEnd, startedByAdminId: null })
      .mockResolvedValueOnce({ id: 'run-1', status: 'COMPLETED' });
    const result = await svc.runAndCollect({ kind: 'PAYMENT', ...period });
    expect(result?.status).toBe('COMPLETED');
    // exactly one claim (no second racing executeRun from a detached enqueue).
    expect(prisma.reconciliationRun.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('#12/#18 CAS transition + state matrix', () => {
  it('allows OPEN→RESOLVED and stamps resolver', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique
      .mockResolvedValueOnce({ id: 'd1', status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'd1', status: 'RESOLVED' });
    await svc.transitionDiscrepancy({ id: 'd1', status: 'RESOLVED', adminId: 'a1' });
    const call = prisma.reconciliationDiscrepancy.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'd1', status: 'OPEN' });
    expect(call.data.resolvedByAdminId).toBe('a1');
  });

  it('rejects an illegal transition (RESOLVED→OPEN)', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1', status: 'RESOLVED' });
    await expect(
      svc.transitionDiscrepancy({ id: 'd1', status: 'OPEN', adminId: 'a1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(prisma.reconciliationDiscrepancy.updateMany).not.toHaveBeenCalled();
  });

  it('throws Conflict when the CAS loses the race (count 0)', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1', status: 'OPEN' });
    prisma.reconciliationDiscrepancy.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.transitionDiscrepancy({ id: 'd1', status: 'RESOLVED', adminId: 'a1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('404s a missing discrepancy', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue(null);
    await expect(
      svc.transitionDiscrepancy({ id: 'nope', status: 'RESOLVED' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('IN_REVIEW is not terminal — no resolver stamped', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique
      .mockResolvedValueOnce({ id: 'd1', status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'd1', status: 'IN_REVIEW' });
    await svc.transitionDiscrepancy({ id: 'd1', status: 'IN_REVIEW', adminId: 'a1' });
    const call = prisma.reconciliationDiscrepancy.updateMany.mock.calls[0][0];
    expect(call.data.resolvedByAdminId).toBeNull();
    expect(call.data.resolvedAt).toBeNull();
  });
});

describe('#8/#9 severity + difference', () => {
  it('a large missing-UTR settlement gets high severity', async () => {
    const { svc } = makeService();
    const sev = (svc as any).severityFor('MISSING_UTR', 6_000_000n); // ₹60k
    expect(sev).toBeGreaterThanOrEqual(80);
  });
  it('a tiny wallet drift gets lower severity than a big one', async () => {
    const { svc } = makeService();
    const small = (svc as any).severityFor('AMOUNT_MISMATCH', 1000n);
    const big = (svc as any).severityFor('AMOUNT_MISMATCH', 6_000_000n);
    expect(big).toBeGreaterThan(small);
  });
});

describe('#5 new runners', () => {
  it('AFFILIATE_PAYOUT flags PAID payout without transactionRef (MISSING_UTR)', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.affiliatePayoutRequest.findMany
      .mockResolvedValueOnce([{ id: 'ap1', affiliateId: 'aff1', netAmount: '1000.00', transactionRef: null }])
      .mockResolvedValueOnce([]);
    const r = await (svc as any).runAffiliatePayout('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(1);
    expect(discrepancies[0].kind).toBe('MISSING_UTR');
  });

  it('AFFILIATE_PAYOUT dedups a stuck-then-paid request (no double count)', async () => {
    const { svc, prisma } = makeService();
    prisma.affiliatePayoutRequest.findMany
      // paid section — has ref, matched
      .mockResolvedValueOnce([{ id: 'ap1', affiliateId: 'aff1', netAmount: '1000.00', transactionRef: 'TXN1' }])
      // stuck section — same id reappears (APPROVED updatedAt in window)
      .mockResolvedValueOnce([{ id: 'ap1', affiliateId: 'aff1', netAmount: '1000.00', updatedAt: new Date('2026-01-05') }]);
    const r = await (svc as any).runAffiliatePayout('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(0); // deduped out of the stuck section
    expect(r.totalMatched).toBe(1);
  });

  it('TDS adjusted row WITH implausible amount is still flagged (loose bound)', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.section194OTdsLedger.findMany.mockResolvedValue([
      // adjusted row, but tdsInPaise (500,000) > netSale (1,000,000)?? no — make it
      // exceed the net base to trip the loose bound: tds 2,000,000 > net 1,000,000.
      { id: 't3', sellerId: 's1', filingPeriod: '2026-Q1', status: 'WITHHELD',
        netSaleInPaise: 1_000_000n, tdsRateBps: 100, tdsInPaise: 2_000_000n, challanReference: null,
        adjustmentCarriedForwardInPaise: -50_000n, refundReversalInPaise: 0n },
    ]);
    const r = await (svc as any).runTds('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(1);
    expect(discrepancies[0].kind).toBe('AMOUNT_MISMATCH');
  });

  it('COMMISSION flags PAID commission with no payout request (ORPHAN_LEDGER_ENTRY)', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.affiliateCommission.findMany.mockResolvedValue([
      { id: 'c1', affiliateId: 'aff1', adjustedAmount: '500.00', payoutRequestId: null, payoutRequest: null },
    ]);
    const r = await (svc as any).runCommission('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(1);
    expect(discrepancies[0].kind).toBe('ORPHAN_LEDGER_ENTRY');
  });

  it('TDS flags a DEPOSITED row with no challan + amount mismatch', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.section194OTdsLedger.findMany.mockResolvedValue([
      { id: 't1', sellerId: 's1', filingPeriod: '2026-Q1', status: 'DEPOSITED',
        netSaleInPaise: 1_000_000n, tdsRateBps: 100, tdsInPaise: 5000n, challanReference: null,
        adjustmentCarriedForwardInPaise: 0n, refundReversalInPaise: 0n },
    ]);
    const r = await (svc as any).runTds('run-1', period.periodStart, period.periodEnd);
    // expected TDS = 1,000,000 * 100 / 10000 = 10,000; recorded 5,000 → mismatch
    // plus DEPOSITED-without-challan
    expect(r.totalDiscrepancies).toBe(2);
    expect(discrepancies.map((d) => d.kind)).toEqual(
      expect.arrayContaining(['PROVIDER_REFERENCE_MISSING', 'AMOUNT_MISMATCH']),
    );
  });

  // Adversarial-review fix: an adjusted row legitimately diverges from
  // netSale×rate, so the amount check must NOT fire on it.
  it('TDS does NOT flag amount mismatch on a carried-forward-adjusted row', async () => {
    const { svc, prisma } = makeService();
    prisma.section194OTdsLedger.findMany.mockResolvedValue([
      { id: 't2', sellerId: 's1', filingPeriod: '2026-Q1', status: 'WITHHELD',
        netSaleInPaise: 1_000_000n, tdsRateBps: 100, tdsInPaise: 5000n, challanReference: null,
        adjustmentCarriedForwardInPaise: -50_000n, refundReversalInPaise: 0n },
    ]);
    const r = await (svc as any).runTds('run-1', period.periodStart, period.periodEnd);
    // would be a mismatch under the naive check (10,000 vs 5,000), but the
    // adjustment suppresses it → matched, 0 discrepancies.
    expect(r.totalDiscrepancies).toBe(0);
    expect(r.totalMatched).toBe(1);
  });

  it('TCS flags component-sum mismatch', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      { id: 'tc1', sellerId: 's1', filingPeriod: '2026-01', status: 'COMPUTED',
        cgstTcsInPaise: 100n, sgstTcsInPaise: 100n, igstTcsInPaise: 0n,
        totalTcsInPaise: 500n, nicArn: null, paymentReference: null },
    ]);
    const r = await (svc as any).runTcs('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(1);
    expect(discrepancies[0].kind).toBe('AMOUNT_MISMATCH');
  });

  // #5 REFUND sub-clause — cross-check the unified RefundInstruction queue, not
  // just the legacy Return table.
  it('REFUND flags a SUCCESS instruction with no gateway/wallet reference (MISSING_REFUND)', async () => {
    const { svc, prisma, discrepancies } = makeService();
    prisma.refundInstruction.findMany.mockResolvedValue([
      { id: 'ri1', customerId: 'c1', amountInPaise: 50000n, status: 'SUCCESS',
        gatewayRefundId: null, walletTransactionId: null },
    ]);
    const r = await (svc as any).runRefund('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(1);
    expect(discrepancies[0].kind).toBe('MISSING_REFUND');
    expect(discrepancies[0].externalRef).toBe('ri1');
  });

  it('REFUND does NOT flag a SETTLED instruction that carries a wallet reference (method-agnostic)', async () => {
    const { svc, prisma } = makeService();
    prisma.refundInstruction.findMany.mockResolvedValue([
      { id: 'ri2', customerId: 'c1', amountInPaise: 50000n, status: 'SETTLED',
        gatewayRefundId: null, walletTransactionId: 'wt-1' },
    ]);
    const r = await (svc as any).runRefund('run-1', period.periodStart, period.periodEnd);
    expect(r.totalDiscrepancies).toBe(0);
    expect(r.totalMatched).toBe(1);
  });
});

describe('#15/#17 settlement period-bound + dedup', () => {
  it('does not double-count a settlement present in both paid and stuck queries', async () => {
    const { svc, prisma } = makeService();
    prisma.sellerSettlement.findMany
      // paid section
      .mockResolvedValueOnce([
        { id: 's1', sellerName: 'Acme', totalSettlementAmount: '1000.00', utrReference: 'UTR1' },
      ])
      // stuck section — same id reappears
      .mockResolvedValueOnce([
        { id: 's1', sellerName: 'Acme', totalSettlementAmount: '1000.00', updatedAt: new Date('2026-01-05') },
      ]);
    const r = await (svc as any).runSettlement('run-1', period.periodStart, period.periodEnd);
    // s1 matched in paid (has UTR); deduped out of stuck → 0 discrepancies, 1 expected
    expect(r.totalDiscrepancies).toBe(0);
    expect(r.totalExpected).toBe(1);
  });
});

describe('#14 PARTIAL', () => {
  it('records sectionFailures when one settlement section throws', async () => {
    const { svc, prisma } = makeService();
    prisma.sellerSettlement.findMany
      .mockResolvedValueOnce([]) // paid ok
      .mockRejectedValueOnce(new Error('db blip')); // stuck throws
    const r = await (svc as any).runSettlement('run-1', period.periodStart, period.periodEnd);
    expect(r.sectionFailures).toBe(1);
    expect(r.failureNotes[0]).toMatch(/stuck/);
  });
});

describe('#3/#6/#13 CSV streaming + injection guard', () => {
  it('streams a header + formula-escaped rows', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationRun.findUnique.mockResolvedValue({
      id: 'run-1', runNumber: 'RECON-2026-X', kind: 'PAYMENT',
      periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'),
    });
    prisma.reconciliationDiscrepancy.findMany
      .mockResolvedValueOnce([
        {
          id: 'd1', kind: 'MISSING_PAYMENT', severity: 70, status: 'OPEN',
          orderNumber: 'ORD-1', externalRef: null,
          expectedInPaise: 50000n, actualInPaise: null, differenceInPaise: null,
          description: '=cmd|/c calc', // formula-injection attempt
          suggestedAction: null, resolutionNotes: null, createdAt: new Date('2026-01-15'),
        },
      ])
      .mockResolvedValueOnce([]);
    const lines: string[] = [];
    for await (const line of svc.streamDiscrepancyCsv('run-1')) lines.push(line);
    expect(lines[0]).toContain('run_id');
    expect(lines[0]).toContain('difference_inr');
    expect(lines[0]).toContain('suggested_action');
    // the =cmd payload must be neutralised: escapeCsvField prefixes a leading
    // formula-trigger char with a single quote (the field has no comma/quote/
    // newline so it isn't additionally wrapped — the leading ' is what defuses
    // the formula in Excel/Sheets).
    expect(lines[1]).toContain(`'=cmd|/c calc`);
    expect(lines[1]).not.toMatch(/,=cmd/); // never an unescaped leading =
  });

  it('404s CSV for a missing run', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationRun.findUnique.mockResolvedValue(null);
    const gen = svc.streamDiscrepancyCsv('nope');
    await expect(gen.next()).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('reaper', () => {
  it('flips stale live runs to FAILED', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationRun.updateMany.mockResolvedValue({ count: 3 });
    const n = await svc.reapStaleRuns(60);
    expect(n).toBe(3);
    const call = prisma.reconciliationRun.updateMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(['QUEUED', 'RUNNING']);
    expect(call.data.status).toBe('FAILED');
  });
});
