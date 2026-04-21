import 'reflect-metadata';
import { ProcurementService } from '../../src/modules/franchise/application/services/procurement.service';

/**
 * Regression test for Option C — per-franchise negotiated procurement
 * price override.
 *
 * Before: approvals always wrote back to ProductVariant.costPrice,
 * meaning one franchise's negotiated rate overwrote the default for
 * every other franchise on the same SKU.
 *
 * After: if a FranchiseProcurementPrice row exists for (franchiseId,
 * productId, variantId), the write-back targets THAT row instead —
 * keeping this franchise's deal isolated from the platform-wide
 * default. Admins create the override row deliberately (through the
 * admin-franchise-procurement-pricing controller); approval never
 * auto-creates one.
 *
 * Invariants verified:
 *   - Override exists → update the override, not the variant.
 *   - No override → update the variant (Option A behaviour).
 *   - Override write-back does NOT touch variant.costPrice.
 */

describe('ProcurementService.approveRequest — per-franchise price precedence', () => {
  const buildService = (opts: {
    overrideExists: boolean;
  }) => {
    const existingRequest = {
      id: 'req-1',
      franchiseId: 'fr-A',
      requestNumber: 'SM-PO-001',
      status: 'SUBMITTED',
      procurementFeeRate: '5',
      items: [{ id: 'it-1', productId: 'prod-1', variantId: 'var-1' }],
    };

    const procurementRepo: any = {
      findByIdWithItems: jest.fn().mockResolvedValue(existingRequest),
      findItemById: jest
        .fn()
        .mockResolvedValue({ id: 'it-1', procurementRequestId: 'req-1' }),
      updateItem: jest.fn().mockResolvedValue(undefined),
      calculateTotals: jest.fn().mockResolvedValue({
        totalApprovedAmount: 100,
        procurementFeeAmount: 5,
        finalPayableAmount: 105,
      }),
      update: jest.fn().mockResolvedValue({ id: 'req-1' }),
    };

    const variantUpdate = jest.fn().mockResolvedValue({});
    const productUpdate = jest.fn().mockResolvedValue({});
    const overrideUpdate = jest.fn().mockResolvedValue({});
    const overrideFindUnique = jest.fn().mockResolvedValue(
      opts.overrideExists
        ? {
            id: 'override-1',
            franchiseId: 'fr-A',
            productId: 'prod-1',
            variantId: 'var-1',
            landedUnitCost: 8, // the previously-negotiated rate
          }
        : null,
    );

    const prisma: any = {
      productVariant: { update: variantUpdate },
      product: { update: productUpdate },
      franchiseProcurementPrice: {
        findUnique: overrideFindUnique,
        update: overrideUpdate,
      },
    };

    const svc = new ProcurementService(
      procurementRepo,
      {} as any, // catalogRepo
      {} as any, // franchiseRepo
      {} as any, // inventoryService
      {} as any, // commissionService
      { publish: jest.fn().mockResolvedValue(undefined) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      prisma,
    );

    return { svc, variantUpdate, productUpdate, overrideUpdate, overrideFindUnique };
  };

  it('updates the FranchiseProcurementPrice row when an override exists (keeping this franchise isolated)', async () => {
    const { svc, variantUpdate, overrideUpdate, overrideFindUnique } =
      buildService({ overrideExists: true });

    await svc.approveRequest('admin-1', 'req-1', [
      { itemId: 'it-1', approvedQty: 10, landedUnitCost: 10 },
    ]);

    expect(overrideFindUnique).toHaveBeenCalledWith({
      where: {
        franchiseId_productId_variantId: {
          franchiseId: 'fr-A',
          productId: 'prod-1',
          variantId: 'var-1',
        },
      },
    });
    expect(overrideUpdate).toHaveBeenCalledWith({
      where: { id: 'override-1' },
      data: { landedUnitCost: 10 },
    });
    // Must NOT touch the variant default — that would broadcast the
    // per-franchise rate to every franchise on this SKU.
    expect(variantUpdate).not.toHaveBeenCalled();
  });

  it('falls back to variant.costPrice when no override exists (unchanged Option A behavior)', async () => {
    const { svc, variantUpdate, overrideUpdate } = buildService({
      overrideExists: false,
    });

    await svc.approveRequest('admin-1', 'req-1', [
      { itemId: 'it-1', approvedQty: 10, landedUnitCost: 10 },
    ]);

    expect(overrideUpdate).not.toHaveBeenCalled();
    expect(variantUpdate).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { costPrice: 10 },
    });
  });

  it('does NOT auto-create an override row — admin must opt in via the pricing page', async () => {
    // There is no `overrideCreate` (or upsert) call in the approval
    // path. Create-on-write would silently convert Option A into
    // Option C for every new SKU, making the negotiation implicit.
    // Pin the "never creates" invariant here.
    const { svc, variantUpdate, overrideFindUnique } = buildService({
      overrideExists: false,
    });

    await svc.approveRequest('admin-1', 'req-1', [
      { itemId: 'it-1', approvedQty: 10, landedUnitCost: 10 },
    ]);

    // The lookup ran (we checked for an override) but no create call
    // was made — only variant.update was touched.
    expect(overrideFindUnique).toHaveBeenCalled();
    expect(variantUpdate).toHaveBeenCalled();
  });
});
