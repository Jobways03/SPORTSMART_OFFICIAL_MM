/**
 * 2026-06-15 — product-scoped per-seller pause/resume ("Pause/Resume sales" in
 * My Products). Pauses/resumes ONLY this seller's own offers for a product;
 * other sellers and the shared product are untouched. The resume is guarded so
 * a seller can lift ONLY their own pause, never an admin STOP/SUSPEND.
 */
import { SellerProductMappingController } from './seller-product-mapping.controller';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

function build(over: any = {}) {
  const sellerMappingRepo: any = {
    findSellerOffersForProduct:
      over.findSellerOffersForProduct ?? jest.fn().mockResolvedValue([]),
    stop:
      over.stop ??
      jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, approvalStatus: 'STOPPED', isActive: false }),
      ),
    resumeBySeller:
      over.resumeBySeller ??
      jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, approvalStatus: 'APPROVED', isActive: true }),
      ),
    releaseActiveReservationsForMapping: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
  };
  const stockLedger: any = { record: jest.fn().mockResolvedValue(undefined) };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const catalogCache: any = { invalidateProductLists: jest.fn().mockResolvedValue(undefined) };
  const controller = new SellerProductMappingController(
    sellerMappingRepo,
    {} as any, // storefrontRepo
    noopLogger as any,
    {} as any, // stockSyncService
    stockLedger,
    {} as any, // redis
    audit,
    eventBus,
    catalogCache,
  );
  return { controller, sellerMappingRepo };
}

const req = (sellerId = 'seller-1'): any => ({ sellerId });

describe('SellerProductMappingController — product pause-sales', () => {
  it('pauses ONLY the seller’s APPROVED offers; ignores pending/admin-stopped', async () => {
    const offers = [
      { id: 'm1', variantId: 'v1', productId: 'p1', approvalStatus: 'APPROVED', isActive: true, stoppedBy: null },
      { id: 'm2', variantId: 'v2', productId: 'p1', approvalStatus: 'PENDING_APPROVAL', isActive: false, stoppedBy: null },
      { id: 'm3', variantId: 'v3', productId: 'p1', approvalStatus: 'STOPPED', isActive: false, stoppedBy: 'admin-x' },
    ];
    const { controller, sellerMappingRepo } = build({
      findSellerOffersForProduct: jest.fn().mockResolvedValue(offers),
    });
    const res = await controller.pauseSalesForProduct(req(), 'p1', {} as any);
    expect(sellerMappingRepo.stop).toHaveBeenCalledTimes(1);
    expect(sellerMappingRepo.stop).toHaveBeenCalledWith('m1', 'seller-1', expect.stringContaining('[SellerPause]'));
    expect(res.data.pausedMappingIds).toEqual(['m1']);
  });

  it('rejects when the seller has no active offer to pause', async () => {
    const { controller } = build({
      findSellerOffersForProduct: jest
        .fn()
        .mockResolvedValue([{ id: 'm1', approvalStatus: 'STOPPED', stoppedBy: 'seller-1' }]),
    });
    await expect(controller.pauseSalesForProduct(req(), 'p1', {} as any)).rejects.toThrow(
      /no active offer/i,
    );
  });
});

describe('SellerProductMappingController — product resume-sales', () => {
  it('resumes ONLY the seller’s OWN paused offers; never an admin STOP', async () => {
    const offers = [
      { id: 'm1', variantId: 'v1', productId: 'p1', approvalStatus: 'STOPPED', isActive: false, stoppedBy: 'seller-1' }, // self-paused
      { id: 'm2', variantId: 'v2', productId: 'p1', approvalStatus: 'STOPPED', isActive: false, stoppedBy: 'admin-x' }, // admin stop
      { id: 'm3', variantId: 'v3', productId: 'p1', approvalStatus: 'APPROVED', isActive: true, stoppedBy: null }, // already live
    ];
    const { controller, sellerMappingRepo } = build({
      findSellerOffersForProduct: jest.fn().mockResolvedValue(offers),
    });
    const res = await controller.resumeSalesForProduct(req(), 'p1');
    expect(sellerMappingRepo.resumeBySeller).toHaveBeenCalledTimes(1);
    expect(sellerMappingRepo.resumeBySeller).toHaveBeenCalledWith('m1', 'seller-1');
    expect(res.data.resumedMappingIds).toEqual(['m1']);
  });

  it('rejects when there is no self-paused offer (admin stops are not resumable here)', async () => {
    const { controller, sellerMappingRepo } = build({
      findSellerOffersForProduct: jest
        .fn()
        .mockResolvedValue([{ id: 'm2', approvalStatus: 'STOPPED', stoppedBy: 'admin-x' }]),
    });
    await expect(controller.resumeSalesForProduct(req(), 'p1')).rejects.toThrow(/no paused offer/i);
    expect(sellerMappingRepo.resumeBySeller).not.toHaveBeenCalled();
  });
});
