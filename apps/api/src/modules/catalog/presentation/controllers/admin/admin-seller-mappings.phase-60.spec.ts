/**
 * Phase 60 (2026-05-22) — pins the auto-repair stale-mapping
 * flow hardening:
 *
 *   - Pre-check skips the heavy fan-out when nothing is stale
 *     (audit Gap #6)
 *   - Per-product Redis lock prevents concurrent admin repairs
 *     (audit Gap #7)
 *   - Repo's repairStaleMappingsForProduct does the safe
 *     fan-out (audit Gaps #1-5, #11, #12, #15, #16)
 *   - WRITE_OFF on stale + INITIAL per new mapping ledger
 *     entries (audit Gap #8)
 *   - AuditPublicFacade entry per migration event (forensic)
 *   - catalog.seller_mapping.auto_repaired event emitted
 *   - Catalog cache invalidated when at least one row migrated
 *   - Blocked outcomes (stock>0 without opt-in) surface as
 *     logger.warn without breaking the GET path
 */

import 'reflect-metadata';
import { AdminSellerMappingsController } from './admin-seller-mappings.controller';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
} as any;

type Overrides = {
  countStale?: jest.Mock;
  repair?: jest.Mock;
  acquireLock?: jest.Mock;
  ledgerRecord?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
  findByIdBasic?: jest.Mock;
  findByProduct?: jest.Mock;
};

function buildController(over: Overrides = {}) {
  const productRepo: any = {
    findByIdBasic: over.findByIdBasic ?? jest.fn(),
    findFullProduct: jest.fn(),
    findSellerById: jest.fn(),
  };
  const sellerMappingRepo: any = {
    findByProduct: over.findByProduct ?? jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    stop: jest.fn(),
    reapprove: jest.fn(),
    bulkApprove: jest.fn(),
    bulkStop: jest.fn(),
    releaseActiveReservationsForMapping: jest.fn().mockResolvedValue([]),
    findManyByIdsForSeller: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    findBySellerForProduct: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    delete: jest.fn(),
    countStaleMappingsForProduct:
      over.countStale ?? jest.fn().mockResolvedValue(0),
    repairStaleMappingsForProduct:
      over.repair ?? jest.fn().mockResolvedValue([]),
  };
  const stockSyncService: any = { syncVariantStockFromMappings: jest.fn() };
  const stockLedger: any = {
    record: over.ledgerRecord ?? jest.fn().mockResolvedValue(undefined),
  };
  const audit: any = {
    writeAuditLog: over.auditWrite ?? jest.fn().mockResolvedValue(undefined),
  };
  const eventBus: any = {
    publish: over.eventPublish ?? jest.fn().mockResolvedValue(undefined),
  };
  const catalogCache: any = {
    invalidateProductLists:
      over.cacheInvalidate ?? jest.fn().mockResolvedValue(undefined),
  };
  const redis: any = {
    acquireLock: over.acquireLock ?? jest.fn().mockResolvedValue(true),
  };
  return {
    ctrl: new AdminSellerMappingsController(
      productRepo,
      sellerMappingRepo,
      noopLogger,
      stockSyncService,
      stockLedger,
      audit,
      eventBus,
      catalogCache,
      redis,
    ),
    productRepo,
    sellerMappingRepo,
    redis,
    stockLedger,
    audit,
    eventBus,
    catalogCache,
  };
}

// The auto-repair is a private method — exercise it through
// the public GET endpoint that triggers it on every hasVariants
// product read.
function callGet(ctrl: AdminSellerMappingsController, productId: string) {
  return (ctrl as any).getMappingsForProduct(productId);
}

const PRODUCT_WITH_VARIANTS = {
  id: 'p-1',
  hasVariants: true,
  title: 'Product 1',
};

describe('Phase 60 — pre-check skip (audit Gap #6)', () => {
  it('does NOT call repair when no stale mappings exist', async () => {
    const repair = jest.fn();
    const { ctrl, sellerMappingRepo } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(0),
      repair,
    });
    await callGet(ctrl, 'p-1');
    expect(sellerMappingRepo.countStaleMappingsForProduct).toHaveBeenCalledWith('p-1');
    expect(repair).not.toHaveBeenCalled();
  });

  it('does NOT acquire the Redis lock when pre-check returns 0', async () => {
    const acquireLock = jest.fn().mockResolvedValue(true);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(0),
      acquireLock,
    });
    await callGet(ctrl, 'p-1');
    expect(acquireLock).not.toHaveBeenCalled();
  });
});

describe('Phase 60 — Redis lock gates concurrent repair (audit Gap #7)', () => {
  it('skips repair when the lock cannot be acquired', async () => {
    const repair = jest.fn();
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      acquireLock: jest.fn().mockResolvedValue(false),
      repair,
    });
    await callGet(ctrl, 'p-1');
    expect(repair).not.toHaveBeenCalled();
  });

  it('runs repair when the lock is acquired', async () => {
    const repair = jest.fn().mockResolvedValue([]);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      acquireLock: jest.fn().mockResolvedValue(true),
      repair,
    });
    await callGet(ctrl, 'p-1');
    expect(repair).toHaveBeenCalledWith('p-1', 'auto-repair-system');
  });
});

describe('Phase 60 — blocked outcomes (audit Gap #1 stock-loss guard)', () => {
  it('logs warning when stale.stockQty>0 and does NOT write ledger/audit/event', async () => {
    const ledgerRecord = jest.fn();
    const auditWrite = jest.fn();
    const eventPublish = jest.fn();
    const cacheInvalidate = jest.fn();
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      repair: jest.fn().mockResolvedValue([
        {
          staleMappingId: 'stale-1',
          sellerId: 'seller-1',
          staleStockQty: 50,
          staleDispatchSla: 2,
          newMappings: [],
          blockedReason: 'Stale mapping has stockQty=50',
        },
      ]),
      ledgerRecord,
      auditWrite,
      eventPublish,
      cacheInvalidate,
    });
    await callGet(ctrl, 'p-1');
    expect(ledgerRecord).not.toHaveBeenCalled();
    expect(auditWrite).not.toHaveBeenCalled();
    expect(eventPublish).not.toHaveBeenCalled();
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});

describe('Phase 60 — successful migration side effects (audit Gaps #8 + audit + event + cache)', () => {
  it('writes WRITE_OFF ledger row for the stale mapping when staleStockQty>0', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      repair: jest.fn().mockResolvedValue([
        {
          staleMappingId: 'stale-1',
          sellerId: 'seller-1',
          // Caller opted in (allowStockLoss=true scenario in repo),
          // so stale.stockQty is preserved and the controller logs
          // a WRITE_OFF.
          staleStockQty: 25,
          staleDispatchSla: 2,
          newMappings: [
            { id: 'new-v1', variantId: 'v1', stockQty: 25 },
            { id: 'new-v2', variantId: 'v2', stockQty: 25 },
          ],
        },
      ]),
      ledgerRecord,
    });
    await callGet(ctrl, 'p-1');
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'stale-1',
        kind: 'WRITE_OFF',
        beforeStockQty: 25,
        afterStockQty: 0,
        referenceType: 'MAPPING_MIGRATION',
        actorRole: 'SYSTEM',
      }),
    );
  });

  it('writes INITIAL ledger row per new mapping with stockQty>0', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      repair: jest.fn().mockResolvedValue([
        {
          staleMappingId: 'stale-1',
          sellerId: 'seller-1',
          staleStockQty: 0,
          staleDispatchSla: 2,
          newMappings: [
            { id: 'new-v1', variantId: 'v1', stockQty: 10 },
            { id: 'new-v2', variantId: 'v2', stockQty: 0 }, // zero — skipped
          ],
        },
      ]),
      ledgerRecord,
    });
    await callGet(ctrl, 'p-1');
    expect(ledgerRecord).toHaveBeenCalledTimes(1);
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'new-v1',
        kind: 'INITIAL',
        beforeStockQty: 0,
        afterStockQty: 10,
      }),
    );
  });

  it('writes audit log + emits event + invalidates cache once when at least one row migrated', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      repair: jest.fn().mockResolvedValue([
        {
          staleMappingId: 'stale-1',
          sellerId: 'seller-1',
          staleStockQty: 0,
          staleDispatchSla: 2,
          newMappings: [{ id: 'new-v1', variantId: 'v1', stockQty: 0 }],
        },
      ]),
      auditWrite,
      eventPublish,
      cacheInvalidate,
    });
    await callGet(ctrl, 'p-1');
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SELLER_MAPPING_AUTO_REPAIRED',
        actorRole: 'SYSTEM',
        resource: 'SellerProductMapping',
        resourceId: 'stale-1',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.auto_repaired',
        aggregateId: 'stale-1',
      }),
    );
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it('does NOT invalidate cache when only blocked outcomes are returned', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const { ctrl } = buildController({
      findByIdBasic: jest.fn().mockResolvedValue(PRODUCT_WITH_VARIANTS),
      countStale: jest.fn().mockResolvedValue(1),
      repair: jest.fn().mockResolvedValue([
        {
          staleMappingId: 'stale-1',
          sellerId: 'seller-1',
          staleStockQty: 50,
          staleDispatchSla: 2,
          newMappings: [],
          blockedReason: 'has stock',
        },
      ]),
      cacheInvalidate,
    });
    await callGet(ctrl, 'p-1');
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});
