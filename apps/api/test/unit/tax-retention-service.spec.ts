import 'reflect-metadata';
import { TaxDocumentRetentionService } from '../../src/modules/tax/application/services/tax-document-retention.service';

// Phase 21 GST — TaxDocumentRetentionService tests.
//
// Unit-level: prisma + env mocked. Verifies the aggregate summary
// shape used by the erasure outcome JSON + admin compliance UI.

function makeService(opts: { retentionYears?: number } = {}): {
  service: TaxDocumentRetentionService;
  prisma: any;
} {
  const prisma = {
    taxDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const env: any = {
    getNumber: (_k: string, fb: number) =>
      opts.retentionYears !== undefined ? opts.retentionYears : fb,
  };
  const service = new TaxDocumentRetentionService(prisma as any, env);
  return { service, prisma };
}

describe('TaxDocumentRetentionService.getRetentionSummaryForUser', () => {
  it('returns the zero summary for a user with no tax documents', async () => {
    const { service } = makeService();
    const s = await service.getRetentionSummaryForUser('u-1');
    expect(s.totalDocuments).toBe(0);
    expect(s.documentsUnderRetention).toBe(0);
    expect(s.hasActiveStatutoryHold).toBe(false);
    expect(s.earliestDocumentDate).toBeNull();
    expect(s.latestRetentionExpiry).toBeNull();
    expect(s.retentionYears).toBe(8);
  });

  it('counts documents under retention vs aged-out', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findMany.mockResolvedValue([
      // Issued 2026 → expires 2034 → under retention at "now" (2026-05).
      {
        generatedAt: new Date('2026-04-15T10:00:00.000Z'),
        createdAt: new Date('2026-04-15T10:00:00.000Z'),
      },
      // Issued 2010 → expires 2018 → aged out.
      {
        generatedAt: new Date('2010-05-01T10:00:00.000Z'),
        createdAt: new Date('2010-05-01T10:00:00.000Z'),
      },
    ]);

    const now = new Date('2026-05-15T10:00:00.000Z');
    const s = await service.getRetentionSummaryForUser('u-1', now);
    expect(s.totalDocuments).toBe(2);
    expect(s.documentsUnderRetention).toBe(1);
    expect(s.hasActiveStatutoryHold).toBe(true);
    expect(s.earliestDocumentDate?.toISOString()).toBe(
      '2010-05-01T10:00:00.000Z',
    );
    // latestRetentionExpiry should be 2026 + 8y = 2034.
    expect(s.latestRetentionExpiry?.toISOString()).toBe(
      '2034-04-15T10:00:00.000Z',
    );
  });

  it('uses createdAt when generatedAt is null (never-issued draft)', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        generatedAt: null,
        createdAt: new Date('2026-04-15T10:00:00.000Z'),
      },
    ]);
    const s = await service.getRetentionSummaryForUser(
      'u-1',
      new Date('2026-05-15T10:00:00.000Z'),
    );
    expect(s.documentsUnderRetention).toBe(1);
    expect(s.earliestDocumentDate?.toISOString()).toBe(
      '2026-04-15T10:00:00.000Z',
    );
  });

  it('honours the env-overridden retention window', async () => {
    const { service, prisma } = makeService({ retentionYears: 5 });
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        generatedAt: new Date('2018-04-15T10:00:00.000Z'),
        createdAt: new Date('2018-04-15T10:00:00.000Z'),
      },
    ]);
    // 2018 + 5y = 2023; "now" = 2026 → aged out at 5-year window.
    const s = await service.getRetentionSummaryForUser(
      'u-1',
      new Date('2026-05-15T10:00:00.000Z'),
    );
    expect(s.retentionYears).toBe(5);
    expect(s.documentsUnderRetention).toBe(0);
    expect(s.hasActiveStatutoryHold).toBe(false);
  });
});

describe('TaxDocumentRetentionService.isDocumentUnderRetention', () => {
  it('returns false on unknown documentId', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    expect(await service.isDocumentUnderRetention('nope')).toBe(false);
  });

  it('returns true for an in-window document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      generatedAt: new Date('2026-04-15T10:00:00.000Z'),
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
    });
    expect(
      await service.isDocumentUnderRetention(
        'doc-1',
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('returns false for an aged-out document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      generatedAt: new Date('2010-04-15T10:00:00.000Z'),
      createdAt: new Date('2010-04-15T10:00:00.000Z'),
    });
    expect(
      await service.isDocumentUnderRetention(
        'doc-old',
        new Date('2026-04-15T10:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('TaxDocumentRetentionService.retentionYears', () => {
  it('returns env-overridden value when set', () => {
    const { service } = makeService({ retentionYears: 10 });
    expect(service.retentionYears()).toBe(10);
  });

  it('returns default 8 when no env override', () => {
    const { service } = makeService();
    expect(service.retentionYears()).toBe(8);
  });
});
