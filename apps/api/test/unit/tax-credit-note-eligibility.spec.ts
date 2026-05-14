import 'reflect-metadata';
import { CreditNoteEligibilityService } from '../../src/modules/tax/application/services/credit-note-eligibility.service';

// Phase 12 GST — CreditNoteEligibilityService tests.
//
// Classification logic only — the DB lookups are mocked since this is
// a unit test. The cron-side persistence is exercised by integration
// tests in Phase 27.

interface MockPrisma {
  return: {
    findUnique: jest.Mock;
  };
  taxDocument: {
    findFirst: jest.Mock;
    findMany?: jest.Mock;
  };
}

function makeService(): {
  service: CreditNoteEligibilityService;
  prisma: MockPrisma;
} {
  const prisma: MockPrisma = {
    return: { findUnique: jest.fn() },
    taxDocument: { findFirst: jest.fn() },
  };
  const service = new CreditNoteEligibilityService(prisma as any);
  return { service, prisma };
}

describe('CreditNoteEligibilityService.classifyReturn', () => {
  const RETURN_ID = 'return-1';
  const SUB_ORDER_ID = 'sub-1';

  function withReturn(prisma: MockPrisma) {
    prisma.return.findUnique.mockResolvedValue({
      id: RETURN_ID,
      returnNumber: 'RET-2026-000001',
      subOrderId: SUB_ORDER_ID,
      qcCompletedAt: new Date('2026-06-20T10:00:00Z'),
      qcDecision: 'APPROVED',
    });
  }

  it('throws when the return does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.return.findUnique.mockResolvedValue(null);
    await expect(service.classifyReturn(RETURN_ID)).rejects.toThrow(
      /not found/,
    );
  });

  it('throws when QC has not completed', async () => {
    const { service, prisma } = makeService();
    prisma.return.findUnique.mockResolvedValue({
      id: RETURN_ID,
      returnNumber: 'RET-2026-000001',
      subOrderId: SUB_ORDER_ID,
      qcCompletedAt: null,
      qcDecision: null,
    });
    await expect(service.classifyReturn(RETURN_ID)).rejects.toThrow(
      /not completed QC/,
    );
  });

  it('returns REQUIRES_FINANCE_REVIEW when no source invoice + no LEGACY_RECEIPT', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    // First findFirst (real invoice) and second findFirst (legacy receipt)
    // both return null → pure mid-checkout / not-yet-generated case.
    prisma.taxDocument.findFirst.mockResolvedValue(null);

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.sourceInvoice).toBeNull();
    expect(d.reason).toMatch(/No source tax invoice/);
  });

  it('returns REQUIRES_FINANCE_REVIEW with LEGACY_RECEIPT when source invoice is absent but legacy receipt exists', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    // First call: no real invoice. Second call: a legacy receipt.
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'doc-legacy',
        documentNumber: 'SM-LR-000007',
        generatedAt: new Date('2025-12-01T10:00:00Z'),
        status: 'GENERATED',
      });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.sourceInvoice?.documentNumber).toBe('SM-LR-000007');
    expect(d.reason).toMatch(/Legacy order/);
    expect(d.reason).toMatch(/No GST output liability/);
  });

  it('returns REQUIRES_FINANCE_REVIEW when source invoice is VOIDED_DRAFT', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-01T10:00:00Z'),
      status: 'VOIDED_DRAFT',
    });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.reason).toMatch(/VOIDED_DRAFT/);
  });

  it('returns REQUIRES_FINANCE_REVIEW when source invoice is SUPERSEDED', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-01T10:00:00Z'),
      status: 'SUPERSEDED',
    });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.reason).toMatch(/SUPERSEDED/);
  });

  it('returns REQUIRES_FINANCE_REVIEW when source invoice is FULLY_REVERSED', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-01T10:00:00Z'),
      status: 'FULLY_REVERSED',
    });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.reason).toMatch(/FULLY_REVERSED/);
  });

  it('returns ELIGIBLE when comfortably within the Sec 34 window', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    // Invoice Jun 2026 (FY 2026-27) → cutoff 30 Sept 2027 IST.
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // Now: 1 Jul 2026 — 14+ months to cutoff.
    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('ELIGIBLE');
    expect(d.cutoff?.toISOString()).toBe('2027-09-30T18:29:59.999Z');
    expect(d.daysToCutoff).toBeGreaterThan(7);
  });

  it('returns ELIGIBLE when the source invoice is PARTIALLY_REVERSED', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    // PARTIALLY_REVERSED is still a valid state for further credit
    // notes — only FULLY_REVERSED blocks the auto-flow.
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'PARTIALLY_REVERSED',
    });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2026-07-01T10:00:00Z'),
    });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('flags REQUIRES_FINANCE_REVIEW within 7 days of cutoff', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    // Invoice Jun 2026 → cutoff 30 Sept 2027 IST.
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // Now: 26 Sept 2027 — 4 days to cutoff.
    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-09-26T10:00:00Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
    expect(d.daysToCutoff).toBeGreaterThanOrEqual(0);
    expect(d.daysToCutoff).toBeLessThanOrEqual(7);
    expect(d.reason).toMatch(/early-warning window/);
  });

  it('flags REQUIRES_FINANCE_REVIEW exactly at the approaching boundary', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // Now: 23 Sept 2027 — exactly 7 days from 30 Sept cutoff.
    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-09-23T18:29:59.999Z'),
    });
    expect(d.status).toBe('REQUIRES_FINANCE_REVIEW');
  });

  it('returns TIME_BARRED when past the cutoff', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // Now: 1 Oct 2027 IST = 30 Sept 2027 18:30 UTC — one minute past cutoff.
    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-09-30T18:30:00Z'),
    });
    expect(d.status).toBe('TIME_BARRED');
    expect(d.daysToCutoff).toBeLessThanOrEqual(0);
    expect(d.reason).toMatch(/Section 34 cutoff/);
    expect(d.reason).toMatch(/wallet adjustment/);
  });

  it('returns TIME_BARRED many months after the cutoff', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // Now: 1 Apr 2028 — well past the 30 Sept 2027 cutoff.
    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2028-04-01T10:00:00Z'),
    });
    expect(d.status).toBe('TIME_BARRED');
  });

  it('honours a custom approachingDays override', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00001',
      generatedAt: new Date('2026-06-15T10:00:00Z'),
      status: 'GENERATED',
    });

    // 30 days before cutoff with 30-day approaching window → review.
    const d1 = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-09-01T10:00:00Z'),
      approachingDays: 30,
    });
    expect(d1.status).toBe('REQUIRES_FINANCE_REVIEW');

    // 30 days before cutoff with 7-day approaching window → eligible.
    const d2 = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-09-01T10:00:00Z'),
      approachingDays: 7,
    });
    expect(d2.status).toBe('ELIGIBLE');
  });

  it('handles cross-FY invoice (Feb 2027 is in FY 2026-27)', async () => {
    const { service, prisma } = makeService();
    withReturn(prisma);
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'inv-1',
      documentNumber: 'INV/2026-27/AB12CD3456E1Z5/00099',
      // 15 Feb 2027 IST is still FY 2026-27 → cutoff 30 Sept 2027.
      generatedAt: new Date('2027-02-15T06:00:00Z'),
      status: 'GENERATED',
    });

    const d = await service.classifyReturn(RETURN_ID, {
      now: new Date('2027-03-01T10:00:00Z'),
    });
    expect(d.status).toBe('ELIGIBLE');
    expect(d.cutoff?.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });
});
