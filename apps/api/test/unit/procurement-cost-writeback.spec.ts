import 'reflect-metadata';
import { ProcurementService } from '../../src/modules/franchise/application/services/procurement.service';

/**
 * Regression test for per-variant default landed-cost write-back.
 *
 * Before: the admin approval modal defaulted every landed cost to 0.
 * The admin had to type the price on every request, even when the
 * same variant had been procured at the same price a dozen times.
 *
 * After: approving a procurement writes the admin-entered
 * landedUnitCost back onto `ProductVariant.costPrice` (falling back
 * to `Product.costPrice` for product-level mappings). The next
 * request's approval modal pre-fills from that value.
 *
 * Invariants verified here:
 *   - VARIANT path: updates productVariant, never product.
 *   - PRODUCT path: when variantId is null, falls back to product.
 *   - Rejected items (approvedQty=0) do NOT touch costPrice.
 *   - Write-back is best-effort: a DB error does not roll back the
 *     approval. The error is logged and the loop continues.
 */

describe('ProcurementService.approveRequest — write-back variant.costPrice', () => {
  const buildService = (opts: {
    variantUpdate?: jest.Mock;
    productUpdate?: jest.Mock;
  } = {}) => {
    const existingRequest = {
      id: 'req-1',
      franchiseId: 'fr-A',
      requestNumber: 'SM-PO-001',
      status: 'SUBMITTED',
      procurementFeeRate: '5',
      items: [
        { id: 'it-variant', productId: 'prod-1', variantId: 'var-1' },
        { id: 'it-no-variant', productId: 'prod-2', variantId: null },
        { id: 'it-rejected', productId: 'prod-3', variantId: 'var-3' },
      ],
    };

    const procurementRepo: any = {
      findByIdWithItems: jest.fn().mockResolvedValue(existingRequest),
      findItemById: jest.fn().mockImplementation(async (id: string) => {
        const map: any = {
          'it-variant': { id, procurementRequestId: 'req-1' },
          'it-no-variant': { id, procurementRequestId: 'req-1' },
          'it-rejected': { id, procurementRequestId: 'req-1' },
        };
        return map[id];
      }),
      updateItem: jest.fn().mockResolvedValue(undefined),
      calculateTotals: jest.fn().mockResolvedValue({
        totalApprovedAmount: 100,
        procurementFeeAmount: 5,
        finalPayableAmount: 105,
      }),
      update: jest.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
    };

    const variantUpdate =
      opts.variantUpdate ?? jest.fn().mockResolvedValue({});
    const productUpdate =
      opts.productUpdate ?? jest.fn().mockResolvedValue({});

    // Option C (per-franchise override) takes precedence if a row
    // exists. These tests cover the fallback case — no override —
    // so findUnique always returns null.
    const prisma: any = {
      productVariant: { update: variantUpdate },
      product: { update: productUpdate },
      franchiseProcurementPrice: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const franchiseRepo: any = {};
    const catalogRepo: any = {};
    const inventoryService: any = {};
    const commissionService: any = {};
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Constructor order: procurementRepo, catalogRepo, franchiseRepo,
    // inventoryService, commissionService, eventBus, logger, prisma.
    const svc = new ProcurementService(
      procurementRepo,
      catalogRepo,
      franchiseRepo,
      inventoryService,
      commissionService,
      eventBus,
      logger,
      prisma,
    );

    return { svc, prisma, procurementRepo, variantUpdate, productUpdate, logger };
  };

  it('writes the admin-entered landed cost to ProductVariant.costPrice for variant-scoped items', async () => {
    const { svc, variantUpdate, productUpdate } = buildService();

    await svc.approveRequest('admin-1', 'req-1', [
      { itemId: 'it-variant', approvedQty: 10, landedUnitCost: 10 },
      { itemId: 'it-no-variant', approvedQty: 5, landedUnitCost: 20 },
      { itemId: 'it-rejected', approvedQty: 0, landedUnitCost: 0 },
    ]);

    // Variant write for the variant-scoped item.
    expect(variantUpdate).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { costPrice: 10 },
    });
    // NOT called for it-no-variant (no variantId).
    expect(variantUpdate).toHaveBeenCalledTimes(1);
    // Product write only for it-no-variant (fallback path).
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-2' },
      data: { costPrice: 20 },
    });
    expect(productUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not touch costPrice for rejected items (approvedQty=0)', async () => {
    const { svc, variantUpdate, productUpdate } = buildService();

    await svc.approveRequest('admin-1', 'req-1', [
      { itemId: 'it-rejected', approvedQty: 0, landedUnitCost: 0 },
    ]);

    expect(variantUpdate).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it('treats the write-back as best-effort — a DB error does not propagate to the caller', async () => {
    // If the variant row is gone (soft-deleted between submit and
    // approve, say), the write fails. The approval itself has already
    // committed by this point; we must not roll it back. Catch + log
    // + continue to the next item.
    const variantUpdate = jest
      .fn()
      .mockRejectedValue(new Error('variant disappeared'));
    const { svc, logger } = buildService({ variantUpdate });

    await expect(
      svc.approveRequest('admin-1', 'req-1', [
        { itemId: 'it-variant', approvedQty: 10, landedUnitCost: 10 },
      ]),
    ).resolves.toBeDefined();

    expect(logger.warn).toHaveBeenCalled();
    const msg = (logger.warn.mock.calls[0] as any[])[0];
    expect(String(msg)).toMatch(/Failed to persist landed cost/);
  });
});
