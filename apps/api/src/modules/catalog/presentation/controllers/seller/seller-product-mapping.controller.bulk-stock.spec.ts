import 'reflect-metadata';
import { SellerProductMappingController } from './seller-product-mapping.controller';
import { StockBelowReservedError } from '../../../domain/errors/stock-below-reserved.error';

/**
 * Phase 1 (PR 1.10) — controller-side handling of the stock floor.
 *
 * Verifies:
 *   - On a clean bulk update, the controller returns the updated rows
 *     as before (no behaviour change for callers that already comply).
 *   - On `StockBelowReservedError`, the controller renders a 400 that
 *     enumerates every offending mapping (mappingId, requested, reserved)
 *     so the seller can fix the whole CSV in one revision.
 *   - The single-mapping `Patch :mappingId` path also rejects a stock
 *     value below the row's current reservedQty.
 *
 * The bulk-endpoint spec mocks the repo so we don't exercise the
 * transaction wiring (covered in the repo spec); we just verify the
 * error translation contract here.
 */

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
} as any;

function buildController(overrides: {
  bulkUpdateStock?: jest.Mock;
  findById?: jest.Mock;
  update?: jest.Mock;
  syncVariantStockFromMappings?: jest.Mock;
} = {}) {
  const sellerMappingRepo: any = {
    findById: overrides.findById ?? jest.fn(),
    bulkUpdateStock: overrides.bulkUpdateStock ?? jest.fn(),
    update: overrides.update ?? jest.fn(),
    findPostOfficeByPincode: jest.fn(),
  };
  const storefrontRepo: any = {};
  const stockSyncService: any = {
    syncVariantStockFromMappings:
      overrides.syncVariantStockFromMappings ?? jest.fn(),
  };
  return new SellerProductMappingController(
    sellerMappingRepo,
    storefrontRepo,
    noopLogger,
    stockSyncService,
  );
}

function req(sellerId = 'seller-1'): any {
  return { sellerId } as any;
}

describe('SellerProductMappingController.bulkStockUpdate (PR 1.10 — floor check)', () => {
  it('clean batch — returns updated rows, no error', async () => {
    const updatedRows = [
      { id: 'm-1', stockQty: 10, variantId: 'v-1', productId: 'p-1' },
      { id: 'm-2', stockQty: 20, variantId: null, productId: 'p-2' },
    ];
    const ctrl = buildController({
      findById: jest.fn(async ({ length }: any = {}) => ({
        id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: 'v-1', reservedQty: 0,
      })),
      bulkUpdateStock: jest.fn().mockResolvedValue({ updated: updatedRows, violations: [] }),
    });

    // findById is invoked once per ownership check + once per sync — give
    // it a generic shape that matches what the loop needs.
    (ctrl as any).sellerMappingRepo.findById = jest.fn().mockImplementation((id: string) => ({
      id, sellerId: 'seller-1', productId: 'p-1', variantId: id === 'm-2' ? null : 'v-1', reservedQty: 0,
    }));

    const res = await ctrl.bulkStockUpdate(req(), {
      updates: [
        { mappingId: 'm-1', stockQty: 10 },
        { mappingId: 'm-2', stockQty: 20 },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual(updatedRows);
  });

  it('floor violation — translates StockBelowReservedError to BadRequestAppException with every row listed', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockImplementation((id: string) => ({
        id, sellerId: 'seller-1', productId: 'p-1', variantId: 'v-1', reservedQty: 0,
      })),
      bulkUpdateStock: jest.fn().mockRejectedValue(
        new StockBelowReservedError([
          { mappingId: 'm-2', requestedStock: 5, reservedQty: 15 },
          { mappingId: 'm-3', requestedStock: 2, reservedQty: 8 },
        ]),
      ),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), {
        updates: [
          { mappingId: 'm-1', stockQty: 10 },
          { mappingId: 'm-2', stockQty: 5 },
          { mappingId: 'm-3', stockQty: 2 },
        ],
      }),
    ).rejects.toMatchObject({
      // BadRequestAppException — message should enumerate both violations.
      message: expect.stringMatching(/m-2.*requested 5.*reserved 15/),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), {
        updates: [
          { mappingId: 'm-1', stockQty: 10 },
          { mappingId: 'm-2', stockQty: 5 },
          { mappingId: 'm-3', stockQty: 2 },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/m-3.*requested 2.*reserved 8/),
    });
  });

  it('non-floor repo error — re-thrown unchanged (not masked as a stock issue)', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockImplementation((id: string) => ({
        id, sellerId: 'seller-1', productId: 'p-1', variantId: 'v-1', reservedQty: 0,
      })),
      bulkUpdateStock: jest.fn().mockRejectedValue(new Error('DB unreachable')),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), {
        updates: [{ mappingId: 'm-1', stockQty: 10 }],
      }),
    ).rejects.toThrow(/DB unreachable/);
  });
});

describe('SellerProductMappingController.updateMapping (PR 1.10 — single-row floor)', () => {
  it('rejects stockQty < reservedQty with a clear error', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        sellerId: 'seller-1',
        productId: 'p-1',
        variantId: 'v-1',
        reservedQty: 7,
      }),
      update: jest.fn(),
    });

    await expect(
      ctrl.updateMapping(req(), 'm-1', { stockQty: 3 } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/cannot be less than reservedQty \(7\)/),
    });

    expect((ctrl as any).sellerMappingRepo.update).not.toHaveBeenCalled();
  });

  it('accepts stockQty === reservedQty (boundary — zero available is allowed)', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        sellerId: 'seller-1',
        productId: 'p-1',
        variantId: 'v-1',
        reservedQty: 5,
        pickupPincode: '110001',
      }),
      update: jest.fn().mockResolvedValue({ id: 'm-1', stockQty: 5, variantId: 'v-1', productId: 'p-1' }),
      syncVariantStockFromMappings: jest.fn(),
    });

    await ctrl.updateMapping(req(), 'm-1', { stockQty: 5 } as any);

    expect((ctrl as any).sellerMappingRepo.update).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({ stockQty: 5 }),
    );
  });

  it('still rejects stockQty < 0 with the original error message', async () => {
    // Regression guard: the floor check shouldn't shadow the pre-PR
    // sign check.
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1', sellerId: 'seller-1', reservedQty: 0,
      }),
      update: jest.fn(),
    });

    await expect(
      ctrl.updateMapping(req(), 'm-1', { stockQty: -1 } as any),
    ).rejects.toMatchObject({ message: 'stockQty must be >= 0' });
  });
});
