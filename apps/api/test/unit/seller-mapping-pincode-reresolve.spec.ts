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
 * After: when pincode is the only pickup field that changes, the
 * controller auto-resolves lat/lng from PostOffice. If no match is
 * found, it nulls the stale coords so the allocation scoring falls back
 * to the "no coords → high distance" branch rather than lying.
 */

describe('SellerProductMappingController.updateMapping — pincode re-resolve', () => {
  const buildController = (mocks: {
    existing: any;
    postOffice: any;
    updated: any;
  }) => {
    const sellerMappingRepo: any = {
      findById: jest.fn().mockResolvedValue(mocks.existing),
      findPostOfficeByPincode: jest.fn().mockResolvedValue(mocks.postOffice),
      update: jest.fn().mockResolvedValue(mocks.updated),
    };
    const storefrontRepo: any = {};
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
    };
    const ctrl = new SellerProductMappingController(
      sellerMappingRepo,
      storefrontRepo,
      logger,
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
    const call = sellerMappingRepo.update.mock.calls[0];
    expect(call[0]).toBe('m1');
    expect(call[1]).toMatchObject({
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

    const call = sellerMappingRepo.update.mock.calls[0];
    expect(call[1]).toMatchObject({
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
    const call = sellerMappingRepo.update.mock.calls[0];
    expect(call[1]).toMatchObject({
      pickupPincode: '110001',
      latitude: 1.23,
      longitude: 4.56,
    });
  });

  it('does NOT re-resolve when pincode is unchanged', async () => {
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

    expect(sellerMappingRepo.findPostOfficeByPincode).not.toHaveBeenCalled();
  });
});
