import 'reflect-metadata';
import { Request } from 'express';
import { SellerProductMappingController } from '../../src/modules/catalog/presentation/controllers/seller/seller-product-mapping.controller';

/**
 * Regression test for stale lat/lng on pincode change.
 *
 * Before: seller-product-mapping updateMapping() applied pickupPincode
 * directly to the row but never re-resolved latitude/longitude from the
 * PostOffice table. A seller who moved their warehouse to a new pincode
 * without explicitly passing new coordinates kept the old coords — which
 * meant the routing engine (seller-allocation.service: distanceKm
 * scoring) continued to pick them for customers near the FORMER pickup
 * city, even though they ship from somewhere else now.
 *
 * After: whenever a pickupPincode is supplied without explicit
 * coordinates, the controller auto-resolves lat/lng from PostOffice.
 * (Phase 51 dropped the upfront findById, so it can no longer compare
 * against the previous pincode — it re-resolves unconditionally.) If no
 * match is found, it nulls the stale coords so the allocation scoring
 * falls back to the "no coords → high distance" branch rather than lying.
 */

describe('SellerProductMappingController.updateMapping — pincode re-resolve', () => {
  const buildController = (mocks: {
    existing: any;
    postOffice: any;
    updated: any;
  }) => {
    // Phase 51 polish — updateMapping no longer does an upfront findById +
    // plain `update`. It resolves coords, builds updateData, then calls the
    // row-locked `updateWithRowLock(mappingId, sellerId, updateData)`, which
    // returns { before, after, row }. The PostOffice re-resolve still happens
    // outside the lock via findPostOfficeByPincode.
    const updateWithRowLock = jest.fn().mockResolvedValue({
      before: { stockQty: 0, reservedQty: 0 },
      after: { stockQty: 0, reservedQty: 0 },
      row: { id: mocks.existing?.id, productId: 'p-1', variantId: null, ...mocks.updated },
    });
    const sellerMappingRepo: any = {
      findById: jest.fn().mockResolvedValue(mocks.existing),
      findPostOfficeByPincode: jest.fn().mockResolvedValue(mocks.postOffice),
      updateWithRowLock,
    };
    const storefrontRepo: any = {};
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
    };
    // PR 12.1 — StockSyncService dependency added as 4th arg. Tests
    // that hit the updateMapping(stockQty) path call into
    // syncVariantStockFromMappings; pass-through stub returns
    // undefined so the call completes.
    const stockSyncService: any = {
      syncVariantStockFromMappings: jest.fn().mockResolvedValue(undefined),
    };
    // Phases 51/58 — the controller ctor grew to 9 args:
    // (..., stockLedger, redis, audit, eventBus, catalogCache). updateMapping's
    // pincode-re-resolve path doesn't touch any of these, so pass-through stubs
    // are sufficient.
    const stockLedger: any = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const redis: any = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const catalogCache: any = {
      invalidateProduct: jest.fn().mockResolvedValue(undefined),
    };
    const ctrl = new SellerProductMappingController(
      sellerMappingRepo,
      storefrontRepo,
      logger,
      stockSyncService,
      stockLedger,
      redis,
      audit,
      eventBus,
      catalogCache,
    );
    return { ctrl, sellerMappingRepo };
  };

  const buildReq = (sellerId = 'seller-1'): Request =>
    ({ sellerId } as unknown as Request);

  it('re-resolves lat/lng when only pincode is supplied and it changes', async () => {
    const { ctrl, sellerMappingRepo } = buildController({
      existing: {
        id: 'm1',
        sellerId: 'seller-1',
        pickupPincode: '560001',
        latitude: 12.97,
        longitude: 77.59,
      },
      postOffice: { latitude: 28.61, longitude: 77.23 },
      updated: {},
    });

    await ctrl.updateMapping(buildReq(), 'm1', { pickupPincode: '110001' });

    expect(sellerMappingRepo.findPostOfficeByPincode).toHaveBeenCalledWith('110001');
    // updateWithRowLock(mappingId, sellerId, updateData)
    const call = sellerMappingRepo.updateWithRowLock.mock.calls[0];
    expect(call[0]).toBe('m1');
    expect(call[2]).toMatchObject({
      pickupPincode: '110001',
      latitude: 28.61,
      longitude: 77.23,
    });
  });

  it('nulls stale lat/lng when pincode changes but no PostOffice match', async () => {
    const { ctrl, sellerMappingRepo } = buildController({
      existing: {
        id: 'm2',
        sellerId: 'seller-1',
        pickupPincode: '560001',
        latitude: 12.97,
        longitude: 77.59,
      },
      postOffice: null,
      updated: {},
    });

    await ctrl.updateMapping(buildReq(), 'm2', { pickupPincode: '999999' });

    const call = sellerMappingRepo.updateWithRowLock.mock.calls[0];
    expect(call[2]).toMatchObject({
      pickupPincode: '999999',
      latitude: null,
      longitude: null,
    });
  });

  it('does NOT re-resolve when caller passes explicit lat/lng', async () => {
    const { ctrl, sellerMappingRepo } = buildController({
      existing: {
        id: 'm3',
        sellerId: 'seller-1',
        pickupPincode: '560001',
        latitude: 12.97,
        longitude: 77.59,
      },
      postOffice: { latitude: 28.61, longitude: 77.23 },
      updated: {},
    });

    await ctrl.updateMapping(buildReq(), 'm3', {
      pickupPincode: '110001',
      latitude: 1.23,
      longitude: 4.56,
    });

    // PostOffice lookup should NOT have been called — caller-supplied coords win.
    expect(sellerMappingRepo.findPostOfficeByPincode).not.toHaveBeenCalled();
    const call = sellerMappingRepo.updateWithRowLock.mock.calls[0];
    expect(call[2]).toMatchObject({
      pickupPincode: '110001',
      latitude: 1.23,
      longitude: 4.56,
    });
  });

  it('re-resolves coords whenever a pickup pincode is supplied (no upfront findById to compare against)', async () => {
    // Phase 51 polish — updateMapping dropped the upfront findById, so it can
    // no longer tell whether the supplied pincode actually changed. It now
    // ALWAYS re-resolves coords when a pickupPincode is supplied without
    // explicit lat/lng — even if the value matches the stored one.
    const { ctrl, sellerMappingRepo } = buildController({
      existing: {
        id: 'm4',
        sellerId: 'seller-1',
        pickupPincode: '560001',
        latitude: 12.97,
        longitude: 77.59,
      },
      postOffice: { latitude: 28.61, longitude: 77.23 },
      updated: {},
    });

    await ctrl.updateMapping(buildReq(), 'm4', { pickupPincode: '560001', stockQty: 5 });

    expect(sellerMappingRepo.findPostOfficeByPincode).toHaveBeenCalledWith('560001');
    const call = sellerMappingRepo.updateWithRowLock.mock.calls[0];
    expect(call[2]).toMatchObject({
      pickupPincode: '560001',
      latitude: 28.61,
      longitude: 77.23,
    });
  });
});
