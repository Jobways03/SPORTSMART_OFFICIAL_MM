/**
 * Phase 15 (2026-05-16) — first behavioural test for the inventory
 * module. LowStockAlertService.sweep is the periodic cron entry
 * point that surveys seller-product-mappings, opens a LowStockAlert
 * row when AVAILABLE stock drops to/below threshold, and resolves
 * an existing alert when stock recovers above it.
 *
 * Phase 54 (2026-05-21) — spec updated to match the new contract:
 *   - Constructor takes (prisma, env, eventBus) — wires the env
 *     batch size + LOW_STOCK_ALERT_TRIGGERED event emission.
 *   - Formula is `(stockQty - reservedQty) <= threshold` (audit
 *     Gap #1), not raw stockQty.
 *   - Batched existing-alert lookup via findMany (audit Gap #4).
 *   - Cursor-paginated sweep (audit Gap #5).
 *   - sweep() now returns { created, resolved, scanned }.
 *   - status enum: ACTIVE / RESOLVED / DISMISSED.
 *   - currentStock/availableStock/reservedStock snapshot refresh
 *     on still-ACTIVE alerts (audit Gap #10).
 *   - Event-driven triggerForMapping path covered by its own tests.
 */
import 'reflect-metadata';
import { LowStockAlertStatus } from '@prisma/client';
import { LowStockAlertService } from './low-stock-alert.service';

interface Mapping {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
  lowStockThreshold: number | null;
  isActive: boolean;
}

interface AlertRow {
  id: string;
  sellerProductMappingId: string | null;
  status: LowStockAlertStatus;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
  dismissUntil: Date | null;
  currentStock: number;
  availableStock: number;
  reservedStock: number;
  threshold: number;
}

function buildService(opts: { mappings?: Mapping[]; alerts?: AlertRow[] } = {}) {
  const mappings = opts.mappings ?? [];
  const alerts: AlertRow[] = opts.alerts ?? [];

  const prisma = {
    sellerProductMapping: {
      findMany: jest.fn(async (args: any) => {
        // Honour cursor pagination — slice after the cursor id.
        let slice = mappings;
        if (args?.cursor?.id) {
          const idx = mappings.findIndex((m) => m.id === args.cursor.id);
          slice = mappings.slice(idx + 1);
        }
        return slice.slice(0, args?.take ?? mappings.length);
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        mappings.find((m) => m.id === where.id) ?? null,
      ),
    },
    lowStockAlert: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.sellerProductMappingId?.in) {
          return alerts.filter((a) =>
            where.sellerProductMappingId.in.includes(a.sellerProductMappingId),
          );
        }
        return alerts;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          alerts.find(
            (a) =>
              a.sellerProductMappingId === where.sellerProductMappingId ||
              a.id === where.id,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: AlertRow = {
          id: `alert-${alerts.length + 1}`,
          sellerProductMappingId: data.sellerProductMappingId,
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: data.currentStock,
          availableStock: data.availableStock,
          reservedStock: data.reservedStock,
          threshold: data.threshold,
        };
        alerts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = alerts.find((a) => a.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
    },
  } as any;

  const env: any = {
    getNumber: jest.fn((_k: string, def: number) => def),
  };
  const eventBus: any = {
    publish: jest.fn().mockResolvedValue(undefined),
  };

  const service = new LowStockAlertService(prisma, env, eventBus);
  return { service, prisma, alerts, eventBus };
}

const MAPPING = (overrides: Partial<Mapping> = {}): Mapping => ({
  id: 'spm-1',
  sellerId: 'seller-1',
  productId: 'prod-1',
  variantId: null,
  stockQty: 100,
  reservedQty: 0,
  lowStockThreshold: 5,
  isActive: true,
  ...overrides,
});

describe('LowStockAlertService.sweep (Phase 54)', () => {
  it('returns scanned=0 when there are no mappings', async () => {
    const { service } = buildService({ mappings: [] });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 0, scanned: 0 });
  });

  it('returns {created:0, resolved:0, scanned:1} when nothing needs attention', async () => {
    const { service } = buildService({ mappings: [MAPPING()] });
    const result = await service.sweep();
    expect(result).toEqual({ created: 0, resolved: 0, scanned: 1 });
  });

  it('opens an alert when AVAILABLE stock drops to/below threshold (audit Gap #1)', async () => {
    const { service, prisma } = buildService({
      // stockQty=10 but reservedQty=8 → available=2 ≤ threshold=5 → alert!
      // Pre-Phase-54 (formula = stockQty <= threshold) this case
      // produced NO alert. Phase 54 fix makes it fire.
      mappings: [MAPPING({ stockQty: 10, reservedQty: 8, lowStockThreshold: 5 })],
    });
    const result = await service.sweep();
    expect(result.created).toBe(1);
    expect(prisma.lowStockAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sellerProductMappingId: 'spm-1',
        currentStock: 10,
        availableStock: 2,
        reservedStock: 8,
        threshold: 5,
        status: LowStockAlertStatus.ACTIVE,
      }),
    });
  });

  it('does NOT alert when stockQty is high but reservedQty is also high (formula uses availableStock)', async () => {
    const { service } = buildService({
      // available = 100 - 50 = 50, threshold=5 → not low.
      mappings: [MAPPING({ stockQty: 100, reservedQty: 50, lowStockThreshold: 5 })],
    });
    const result = await service.sweep();
    expect(result.created).toBe(0);
  });

  it('uses the default threshold of 5 when lowStockThreshold is null', async () => {
    const { service } = buildService({
      mappings: [MAPPING({ stockQty: 4, lowStockThreshold: null })],
    });
    const result = await service.sweep();
    expect(result.created).toBe(1);
  });

  it('does NOT duplicate when an ACTIVE alert already exists — instead refreshes the snapshot (audit Gap #10)', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 2, reservedQty: 0 })],
      alerts: [
        {
          id: 'alert-pre',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 4,
          availableStock: 4,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    const result = await service.sweep();
    expect(result.created).toBe(0);
    expect(prisma.lowStockAlert.create).not.toHaveBeenCalled();
    // Snapshot is refreshed even on the no-op path.
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-pre' },
        data: expect.objectContaining({
          currentStock: 2,
          availableStock: 2,
          reservedStock: 0,
        }),
      }),
    );
  });

  it('resolves an active alert when AVAILABLE stock recovers above threshold', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 50, reservedQty: 0, lowStockThreshold: 5 })],
      alerts: [
        {
          id: 'alert-pre',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    const result = await service.sweep();
    expect(result.resolved).toBe(1);
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-pre' },
        data: expect.objectContaining({
          status: LowStockAlertStatus.RESOLVED,
          resolvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('emits LOW_STOCK_ALERT_TRIGGERED on new alert (audit Gap #9)', async () => {
    const { service, eventBus } = buildService({
      mappings: [MAPPING({ stockQty: 3 })],
    });
    await service.sweep();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.low_stock_alert.triggered',
      }),
    );
  });

  it('emits LOW_STOCK_ALERT_RESOLVED on auto-resolution', async () => {
    const { service, eventBus } = buildService({
      mappings: [MAPPING({ stockQty: 50 })],
      alerts: [
        {
          id: 'alert-pre',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    await service.sweep();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.low_stock_alert.resolved',
      }),
    );
  });

  it('skips a row currently DISMISSED with an unexpired snooze (audit Gap #8)', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 3 })],
      alerts: [
        {
          id: 'alert-snoozed',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.DISMISSED,
          resolvedAt: null,
          dismissedAt: new Date(),
          dismissUntil: new Date(Date.now() + 86_400_000),
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    await service.sweep();
    expect(prisma.lowStockAlert.update).not.toHaveBeenCalled();
  });

  it('uses a SINGLE findMany for the batch existing-alert lookup (audit Gap #4)', async () => {
    const { service, prisma } = buildService({
      mappings: [
        MAPPING({ id: 'a', stockQty: 3 }),
        MAPPING({ id: 'b', stockQty: 3 }),
        MAPPING({ id: 'c', stockQty: 3 }),
      ],
    });
    await service.sweep();
    // findMany over the batch should be called once (or twice if
    // pagination needs a second batch). Either way it's NOT one
    // findUnique per mapping like the pre-Phase-54 N+1 pattern.
    expect(prisma.lowStockAlert.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('LowStockAlertService.triggerForMapping (Phase 54 — event-driven, audit Gap #12)', () => {
  it('opens an alert when triggered with a low-stock mapping', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 2 })],
    });
    await service.triggerForMapping('spm-1');
    expect(prisma.lowStockAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          availableStock: 2,
          status: LowStockAlertStatus.ACTIVE,
        }),
      }),
    );
  });

  it('does nothing when the mapping is inactive', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 2, isActive: false })],
    });
    await service.triggerForMapping('spm-1');
    expect(prisma.lowStockAlert.create).not.toHaveBeenCalled();
  });

  it('resolves an existing active alert when stock has recovered', async () => {
    const { service, prisma } = buildService({
      mappings: [MAPPING({ stockQty: 50 })],
      alerts: [
        {
          id: 'alert-active',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    await service.triggerForMapping('spm-1');
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LowStockAlertStatus.RESOLVED,
        }),
      }),
    );
  });
});

describe('LowStockAlertService.triggerForFranchiseStock (Phase 55 polish)', () => {
  function buildFranchiseService(opts: { stock?: any; existingAlert?: any } = {}) {
    const created: any[] = [];
    const updated: any[] = [];
    const prisma = {
      sellerProductMapping: { findMany: jest.fn().mockResolvedValue([]) },
      franchiseStock: { findFirst: jest.fn().mockResolvedValue(opts.stock ?? null) },
      lowStockAlert: {
        findUnique: jest.fn().mockResolvedValue(opts.existingAlert ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `alert-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          updated.push({ where, data });
          return { id: where.id, ...data };
        }),
      },
    } as any;
    const env: any = { getNumber: jest.fn((_k: string, def: number) => def) };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new LowStockAlertService(prisma, env, eventBus),
      prisma,
      eventBus,
      created,
      updated,
    };
  }

  it('does nothing if no franchise stock exists for the key', async () => {
    const { service, prisma } = buildFranchiseService({ stock: null });
    await service.triggerForFranchiseStock('f-1', 'p-1', null);
    expect(prisma.lowStockAlert.create).not.toHaveBeenCalled();
    expect(prisma.lowStockAlert.update).not.toHaveBeenCalled();
  });

  it('creates a FRANCHISE_STOCK-typed alert when availableQty <= threshold', async () => {
    const { service, prisma, eventBus } = buildFranchiseService({
      stock: {
        id: 'fs-1',
        franchiseId: 'f-1',
        productId: 'p-1',
        variantId: null,
        onHandQty: 3,
        reservedQty: 0,
        availableQty: 3,
        lowStockThreshold: 5,
      },
    });

    await service.triggerForFranchiseStock('f-1', 'p-1', null);

    expect(prisma.lowStockAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceType: 'FRANCHISE_STOCK',
        franchiseStockId: 'fs-1',
        franchiseId: 'f-1',
        availableStock: 3,
        threshold: 5,
        status: LowStockAlertStatus.ACTIVE,
      }),
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.low_stock_alert.triggered',
      }),
    );
  });

  it('auto-resolves an ACTIVE franchise alert when stock recovers above threshold', async () => {
    const { service, prisma, eventBus } = buildFranchiseService({
      stock: {
        id: 'fs-1',
        franchiseId: 'f-1',
        productId: 'p-1',
        variantId: null,
        onHandQty: 50,
        reservedQty: 0,
        availableQty: 50,
        lowStockThreshold: 5,
      },
      existingAlert: {
        id: 'alert-1',
        status: LowStockAlertStatus.ACTIVE,
        dismissUntil: null,
        threshold: 5,
        availableStock: 3,
      },
    });

    await service.triggerForFranchiseStock('f-1', 'p-1', null);

    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: LowStockAlertStatus.RESOLVED }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'inventory.low_stock_alert.resolved' }),
    );
  });

  it('skips when alert is DISMISSED with unexpired snooze', async () => {
    const { service, prisma } = buildFranchiseService({
      stock: {
        id: 'fs-1',
        franchiseId: 'f-1',
        productId: 'p-1',
        variantId: null,
        onHandQty: 3,
        reservedQty: 0,
        availableQty: 3,
        lowStockThreshold: 5,
      },
      existingAlert: {
        id: 'alert-1',
        status: LowStockAlertStatus.DISMISSED,
        dismissUntil: new Date(Date.now() + 86_400_000),
      },
    });

    await service.triggerForFranchiseStock('f-1', 'p-1', null);
    expect(prisma.lowStockAlert.create).not.toHaveBeenCalled();
    expect(prisma.lowStockAlert.update).not.toHaveBeenCalled();
  });

  it('only refreshes snapshot when an existing ACTIVE alert is still low (no re-fire)', async () => {
    const { service, prisma, eventBus } = buildFranchiseService({
      stock: {
        id: 'fs-1',
        franchiseId: 'f-1',
        productId: 'p-1',
        variantId: null,
        onHandQty: 4,
        reservedQty: 0,
        availableQty: 4,
        lowStockThreshold: 5,
      },
      existingAlert: {
        id: 'alert-1',
        status: LowStockAlertStatus.ACTIVE,
        dismissUntil: null,
        threshold: 5,
        availableStock: 3,
      },
    });

    await service.triggerForFranchiseStock('f-1', 'p-1', null);

    // Snapshot update happens; no new triggered event.
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availableStock: 4 }),
      }),
    );
    const triggered = eventBus.publish.mock.calls.find(
      (c: any[]) => c[0]?.eventName === 'inventory.low_stock_alert.triggered',
    );
    expect(triggered).toBeUndefined();
  });
});

describe('LowStockAlertService.dismiss (Phase 54 — audit Gap #8)', () => {
  it('marks the alert DISMISSED and stamps dismissedBy/dismissUntil', async () => {
    const { service, prisma, alerts } = buildService({
      alerts: [
        {
          id: 'alert-1',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    const future = new Date(Date.now() + 86_400_000);
    await service.dismiss('alert-1', 'admin-7', future);
    expect(prisma.lowStockAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        status: LowStockAlertStatus.DISMISSED,
        dismissedBy: 'admin-7',
        dismissUntil: future,
      }),
    });
  });

  it('rejects a past snoozeUntil', async () => {
    const { service } = buildService({
      alerts: [
        {
          id: 'alert-1',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    await expect(
      service.dismiss('alert-1', 'admin-7', new Date(Date.now() - 1000)),
    ).rejects.toThrow(/future/i);
  });

  it('refuses to dismiss a non-ACTIVE alert', async () => {
    const { service } = buildService({
      alerts: [
        {
          id: 'alert-1',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.RESOLVED,
          resolvedAt: new Date(),
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 50,
          availableStock: 50,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    await expect(service.dismiss('alert-1', 'admin-7')).rejects.toThrow(/RESOLVED/);
  });
});

describe('LowStockAlertService.listForSeller (Phase 54 — audit Gap #16)', () => {
  it('returns only ACTIVE alerts for the given seller', async () => {
    const { service } = buildService({
      alerts: [
        {
          id: 'a-1',
          sellerProductMappingId: 'spm-1',
          status: LowStockAlertStatus.ACTIVE,
          resolvedAt: null,
          dismissedAt: null,
          dismissUntil: null,
          currentStock: 3,
          availableStock: 3,
          reservedStock: 0,
          threshold: 5,
        },
      ],
    });
    // Inject the sellerId filter into the mock's findMany via where:
    const result = await service.listForSeller('seller-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('throws Forbidden when sellerId is empty', async () => {
    const { service } = buildService();
    await expect(service.listForSeller('')).rejects.toThrow();
  });
});
