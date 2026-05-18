/**
 * Phase 15 (2026-05-16) — first behavioural test for the inventory
 * module. Pre-Phase-15 the module had zero specs.
 *
 * LowStockAlertService.sweep is the hourly cron entry point that
 * surveys seller-product-mappings, opens a LowStockAlert row when
 * stock drops to/below the threshold, and resolves an existing
 * alert when stock recovers above it. The spec verifies the four
 * transitions (no-op / open-new / leave-alone / resolve) end to end.
 */
import 'reflect-metadata';
import { LowStockAlertService } from './low-stock-alert.service';

interface Mapping {
  id: string;
  sellerId: string;
  productId: string;
  stockQty: number;
  lowStockThreshold: number | null;
}

interface AlertRow {
  id: string;
  sellerProductMappingId: string;
  resolvedAt: Date | null;
}

function buildService(opts: {
  mappings?: Mapping[];
  alerts?: AlertRow[];
} = {}) {
  const mappings = opts.mappings ?? [];
  const alerts: AlertRow[] = opts.alerts ?? [];

  const prisma = {
    sellerProductMapping: {
      findMany: jest.fn().mockResolvedValue(mappings),
    },
    lowStockAlert: {
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          alerts.find(
            (a) => a.sellerProductMappingId === where.sellerProductMappingId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: AlertRow = {
          id: `alert-${alerts.length + 1}`,
          sellerProductMappingId: data.sellerProductMappingId,
          resolvedAt: null,
        };
        alerts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = alerts.find((a) => a.id === where.id);
        if (row && data.resolvedAt) row.resolvedAt = data.resolvedAt;
        return row;
      }),
    },
  } as any;
  const service = new LowStockAlertService(prisma);
  return { service, prisma, alerts };
}

const MAPPING = (overrides: Partial<Mapping> = {}): Mapping => ({
  id: 'spm-1',
  sellerId: 'seller-1',
  productId: 'prod-1',
  stockQty: 100,
  lowStockThreshold: 5,
  ...overrides,
});

describe('LowStockAlertService.sweep (Phase 15)', () => {
  it('returns {created:0, resolved:0} when no mappings need attention', async () => {
    const { service } = buildService({ mappings: [MAPPING()] });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 0 });
  });

  it('opens a new alert when stock drops to/below the mapping threshold', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 3, lowStockThreshold: 5 })],
    });
    const result = await service.sweep();
    expect(result).toEqual({ created: 1, resolved: 0 });
    expect(prisma.lowStockAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sellerProductMappingId: 'spm-1',
        currentStock: 3,
        threshold: 5,
      }),
    });
  });

  it('uses the default threshold of 5 when lowStockThreshold is null', async () => {
    const { service } = buildService({
      mappings: [MAPPING({ stockQty: 4, lowStockThreshold: null })],
    });
    const result = await service.sweep();
    expect(result.created).toBe(1);
  });

  it('does NOT open a duplicate alert when one already exists', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 2 })],
      alerts: [
        { id: 'alert-pre', sellerProductMappingId: 'spm-1', resolvedAt: null },
      ],
    });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 0 });
    expect(prisma.lowStockAlert.create).not.toHaveBeenCalled();
  });

  it('resolves an open alert when stock recovers above threshold', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 50, lowStockThreshold: 5 })],
      alerts: [
        { id: 'alert-pre', sellerProductMappingId: 'spm-1', resolvedAt: null },
      ],
    });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 1 });
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-pre' },
        data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
      }),
    );
  });

  it('does NOT re-resolve an already-resolved alert when stock is high', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 100 })],
      alerts: [
        {
          id: 'alert-old',
          sellerProductMappingId: 'spm-1',
          resolvedAt: new Date('2026-01-01'),
        },
      ],
    });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 0 });
    expect(prisma.lowStockAlert.update).not.toHaveBeenCalled();
  });

  it('processes a heterogeneous batch correctly (mixes create + resolve + no-op)', async () => {
    const { service } = buildService({
      mappings: [
        MAPPING({ id: 'spm-low', stockQty: 2 }), // -> create
        MAPPING({ id: 'spm-high', stockQty: 99 }), // -> noop (no existing)
        MAPPING({ id: 'spm-recovered', stockQty: 50 }), // -> resolve
      ],
      alerts: [
        {
          id: 'alert-old',
          sellerProductMappingId: 'spm-recovered',
          resolvedAt: null,
        },
      ],
    });
    const result = await service.sweep();
    expect(result).toEqual({ created: 1, resolved: 1 });
  });
});
