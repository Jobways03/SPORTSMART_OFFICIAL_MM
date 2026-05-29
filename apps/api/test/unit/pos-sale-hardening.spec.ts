import 'reflect-metadata';
import { FranchisePosService } from '../../src/modules/franchise/application/services/franchise-pos.service';
import { ConflictAppException, BadRequestAppException } from '../../src/core/exceptions';

/**
 * Phase 159q — Franchise POS Sale Flow audit remediation.
 *   #2  recordSale wraps sale-create + every stock deduct in ONE transaction
 *   #5  createdByStaffId is the staff id (or null), never the franchise id
 *   #10 taxInvoiceStatus stamped ISSUED/FAILED after the facade call
 *   #13 commissionRate snapshotted on the sale
 *   #14 returnSale uses a CAS claim (conflict -> 409)
 *   #7/#12/#16 DTO: paymentMethod required, qty/price caps, array size cap
 */

function buildService(over: { invoice?: any; claimResult?: number } = {}) {
  // Phase 159r — the return tx now also writes return records + bumps returnedQty.
  const txStub: any = {
    __tx: true,
    franchisePosReturn: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'ret-1' }),
    },
    franchisePosSaleItem: { update: jest.fn().mockResolvedValue({}) },
  };
  const posRepo: any = {
    generateNextSaleNumber: jest.fn().mockResolvedValue('POS-FR1-000001'),
    createSale: jest.fn(async (data: any) => ({ id: 'sale-1', saleNumber: data.saleNumber, ...data })),
    updateSale: jest.fn().mockResolvedValue({ id: 'sale-1' }),
    findByIdWithItems: jest.fn(),
    claimSaleTransition: jest.fn().mockResolvedValue(over.claimResult ?? 1),
  };
  const catalogRepo: any = {
    findApprovedActiveByFranchiseAndProduct: jest
      .fn()
      .mockResolvedValue({ globalSku: 'SKU1', franchiseSku: 'FSKU1' }),
  };
  const partnerRepo: any = {
    findById: jest.fn().mockResolvedValue({
      id: 'fr-1',
      status: 'ACTIVE',
      state: '36',
      franchiseCode: 'FR1',
      onlineFulfillmentRate: 8,
      contractEndDate: null,
    }),
  };
  const inventoryService: any = {
    getStockDetail: jest.fn().mockResolvedValue({ availableQty: 100, globalSku: 'SKU1' }),
    deductPosStock: jest.fn().mockResolvedValue({ stock: {}, ledgerEntry: {} }),
    returnPosStock: jest.fn().mockResolvedValue({ stock: {}, ledgerEntry: {} }),
  };
  const commissionService: any = {
    recordPosCommission: jest.fn().mockResolvedValue(undefined),
    recordPosReturn: jest.fn().mockResolvedValue(undefined),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const prisma: any = {
    product: { findUnique: jest.fn().mockResolvedValue({ title: 'Ball', hsnCode: '9506', gstRateBps: 1800 }) },
    productVariant: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(txStub));
  const taxFacade: any = {
    generateInvoiceForPosSale: jest
      .fn()
      .mockResolvedValue(over.invoice === undefined ? { id: 'tax-1', documentNumber: 'INV-1', isNew: true } : over.invoice),
  };

  const env: any = { getNumber: jest.fn().mockReturnValue(24) };
  const service = new FranchisePosService(
    posRepo,
    catalogRepo,
    partnerRepo,
    inventoryService,
    commissionService,
    eventBus,
    logger,
    prisma,
    taxFacade,
    env,
  );
  return { service, posRepo, inventoryService, prisma, taxFacade, txStub, env };
}

const saleInput = {
  saleType: 'WALK_IN',
  paymentMethod: 'UPI',
  items: [{ productId: 'p1', quantity: 2, unitPrice: 100, lineDiscount: 0 }],
};

describe('FranchisePosService.recordSale', () => {
  it('#2 — wraps sale-create + stock deducts in ONE transaction (deduct gets the tx)', async () => {
    const { service, posRepo, inventoryService, prisma, txStub } = buildService();

    await service.recordSale('fr-1', saleInput, 'fr-1', null);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(posRepo.createSale).toHaveBeenCalledWith(expect.any(Object), txStub);
    expect(inventoryService.deductPosStock).toHaveBeenCalledWith(
      'fr-1', 'p1', null, 2, 'sale-1', 'fr-1', txStub,
    );
  });

  it('#5 — createdByStaffId is the staff id (null here), NOT the franchise id', async () => {
    const { service, posRepo } = buildService();

    await service.recordSale('fr-1', saleInput, 'fr-1', null);

    const createArg = posRepo.createSale.mock.calls[0][0];
    expect(createArg.createdByStaffId).toBeNull();
    expect(createArg.createdByStaffId).not.toBe('fr-1');
  });

  it('#13 — snapshots the commission rate on the sale', async () => {
    const { service, posRepo } = buildService();
    await service.recordSale('fr-1', saleInput, 'fr-1', 'staff-7');
    const createArg = posRepo.createSale.mock.calls[0][0];
    expect(createArg.commissionRate).toBe(8);
    expect(createArg.createdByStaffId).toBe('staff-7');
  });

  it('#10 — stamps taxInvoiceStatus ISSUED when the invoice is generated', async () => {
    const { service, posRepo } = buildService();
    await service.recordSale('fr-1', saleInput, 'fr-1', null);
    expect(posRepo.updateSale).toHaveBeenCalledWith(
      'sale-1',
      expect.objectContaining({ taxInvoiceStatus: 'ISSUED', taxInvoiceId: 'tax-1' }),
    );
  });

  it('#10 — stamps taxInvoiceStatus FAILED when invoice generation returns null', async () => {
    const { service, posRepo } = buildService({ invoice: null });
    await service.recordSale('fr-1', saleInput, 'fr-1', null);
    expect(posRepo.updateSale).toHaveBeenCalledWith(
      'sale-1',
      expect.objectContaining({ taxInvoiceStatus: 'FAILED' }),
    );
  });
});

describe('FranchisePosService.returnSale — #14 CAS', () => {
  const sale = {
    id: 'sale-1',
    franchiseId: 'fr-1',
    saleNumber: 'POS-FR1-000001',
    status: 'COMPLETED',
    commissionRate: 8,
    items: [{ id: 'it-1', productId: 'p1', variantId: null, quantity: 2, lineTotal: 200, productTitle: 'Ball' }],
  };

  it('claims the transition and returns stock within a transaction', async () => {
    const { service, posRepo, inventoryService, txStub } = buildService();
    posRepo.findByIdWithItems.mockResolvedValue(sale);

    await service.returnSale('fr-1', 'sale-1', [{ itemId: 'it-1', returnQty: 2 }], 'fr-1');

    expect(posRepo.claimSaleTransition).toHaveBeenCalledWith(
      'sale-1',
      'COMPLETED',
      expect.objectContaining({ status: 'RETURNED' }),
      txStub,
    );
    expect(inventoryService.returnPosStock).toHaveBeenCalledWith(
      'fr-1', 'p1', null, 2, 'sale-1', 'fr-1', txStub,
      expect.objectContaining({ movementType: 'POS_RETURN' }),
    );
  });

  it('rejects with 409 Conflict when the CAS claim affects 0 rows (concurrent return)', async () => {
    const { service, posRepo, inventoryService } = buildService({ claimResult: 0 });
    posRepo.findByIdWithItems.mockResolvedValue(sale);

    await expect(
      service.returnSale('fr-1', 'sale-1', [{ itemId: 'it-1', returnQty: 2 }], 'fr-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(inventoryService.returnPosStock).not.toHaveBeenCalled();
  });
});

describe('FranchisePosService — void/return audit (159r)', () => {
  const item = (over: any = {}) => ({
    id: 'it-1', productId: 'p1', variantId: null, quantity: 5, returnedQty: 0,
    lineTotal: 500, productTitle: 'Ball', ...over,
  });
  const saleWith = (over: any = {}) => ({
    id: 'sale-1', franchiseId: 'fr-1', saleNumber: 'POS-FR1-1', status: 'COMPLETED',
    commissionRate: 8, netAmount: 500, soldAt: new Date(), items: [item()], ...over,
  });

  it('#1 — rejects an over-return against cumulative returnedQty', async () => {
    const { service, posRepo } = buildService();
    posRepo.findByIdWithItems.mockResolvedValue(
      saleWith({ status: 'PARTIALLY_RETURNED', items: [item({ returnedQty: 3 })] }),
    );
    // remaining = 5 - 3 = 2; returning 3 must fail
    await expect(
      service.returnSale('fr-1', 'sale-1', [{ itemId: 'it-1', returnQty: 3 }], 'fr-1', { refundMethod: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#7 — routes a DAMAGED return to damagedQty (toDamaged=true)', async () => {
    const { service, posRepo, inventoryService } = buildService();
    posRepo.findByIdWithItems.mockResolvedValue(saleWith());
    await service.returnSale(
      'fr-1', 'sale-1', [{ itemId: 'it-1', returnQty: 2, condition: 'DAMAGED' }], 'fr-1', { refundMethod: 'CASH' },
    );
    expect(inventoryService.returnPosStock).toHaveBeenCalledWith(
      'fr-1', 'p1', null, 2, 'sale-1', 'fr-1', expect.anything(),
      expect.objectContaining({ toDamaged: true }),
    );
  });

  it('#6 — writes a FranchisePosReturn record', async () => {
    const { service, posRepo, txStub } = buildService();
    posRepo.findByIdWithItems.mockResolvedValue(saleWith());
    await service.returnSale('fr-1', 'sale-1', [{ itemId: 'it-1', returnQty: 2 }], 'fr-1', { refundMethod: 'UPI', refundReference: 'upi-123' });
    expect(txStub.franchisePosReturn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundMethod: 'UPI', refundReference: 'upi-123', saleId: 'sale-1' }),
      }),
    );
  });

  it('#9 — rejects a void outside the void window', async () => {
    const { service, posRepo, env } = buildService();
    env.getNumber.mockReturnValue(24);
    posRepo.findByIdWithItems.mockResolvedValue(
      saleWith({ soldAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }), // 30h ago
    );
    await expect(service.voidSale('fr-1', 'sale-1', 'mistake', 'fr-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('#16/#8 — voiding a PARTIALLY_RETURNED sale restores only non-returned units via POS_VOID', async () => {
    const { service, posRepo, inventoryService } = buildService();
    posRepo.findByIdWithItems.mockResolvedValue(
      saleWith({ status: 'PARTIALLY_RETURNED', items: [item({ returnedQty: 2 })] }),
    );
    await service.voidSale('fr-1', 'sale-1', 'change of mind', 'fr-1');
    // restoreQty = 5 - 2 = 3, movementType POS_VOID
    expect(inventoryService.returnPosStock).toHaveBeenCalledWith(
      'fr-1', 'p1', null, 3, 'sale-1', 'fr-1', expect.anything(),
      expect.objectContaining({ movementType: 'POS_VOID' }),
    );
  });
});
