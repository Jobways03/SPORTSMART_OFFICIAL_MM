/**
 * Procurement damage-claim review — admin approve/reject.
 *
 *   - APPROVE: claimed units → FranchiseStock.damagedQty (DAMAGE ledger),
 *     item.approvedDamagedQty += claimedQty, totals recomputed (payable drops),
 *     claim → APPROVED. The franchise stops paying for the damaged units.
 *   - REJECT: claimed units → saleable onHandQty, approvedDamagedQty unchanged
 *     (franchise still billed), claim → REJECTED.
 *   - A non-PENDING claim cannot be re-decided.
 */

import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { ProcurementService } from './procurement.service';

function makeService(claim: any) {
  const procurementRepo: any = {
    calculateTotals: jest.fn().mockResolvedValue({
      totalApprovedAmount: { toString: () => '900' },
      procurementFeeAmount: { toString: () => '45' },
      finalPayableAmount: { toString: () => '945' },
    }),
  };
  const inventoryService: any = {
    addDamagedFromProcurement: jest.fn().mockResolvedValue({ stock: {}, ledgerEntry: { id: 'l1' } }),
    addProcurementStock: jest.fn().mockResolvedValue({ stock: {}, ledgerEntry: { id: 'l2' } }),
  };
  const tx: any = {
    procurementDamageClaim: {
      findUnique: jest
        .fn()
        // first call loads the claim, later call returns the updated row
        .mockResolvedValueOnce(claim)
        .mockResolvedValue({ ...claim, status: 'RESOLVED', images: [] }),
      update: jest.fn().mockResolvedValue({}),
    },
    procurementRequestItem: { update: jest.fn().mockResolvedValue({}) },
    procurementRequest: { update: jest.fn().mockResolvedValue({}) },
    procurementRequestEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

  const service = new ProcurementService(
    procurementRepo,
    {} as any, // catalogRepo
    {} as any, // franchiseRepo
    inventoryService,
    {} as any, // commissionService
    { publish: jest.fn() } as any, // eventBus
    logger,
    prisma,
    {} as any, // env
  );
  return { service, procurementRepo, inventoryService, tx };
}

const PENDING_CLAIM = {
  id: 'claim-1',
  procurementRequestId: 'req-1',
  procurementItemId: 'item-1',
  productId: 'prod-1',
  variantId: null,
  globalSku: 'SKU-001',
  claimedQty: 2,
  status: 'PENDING',
  request: { franchiseId: 'franchise-1', status: 'RECEIVED' },
};

describe('ProcurementService.approveDamageClaim', () => {
  it('writes the units to damagedQty, accepts them on the item, recomputes payable', async () => {
    const { service, inventoryService, tx } = makeService(PENDING_CLAIM);
    const res = await service.approveDamageClaim('admin-9', 'claim-1', 'looks broken');

    expect(inventoryService.addDamagedFromProcurement).toHaveBeenCalledWith(
      'franchise-1', 'prod-1', null, 'SKU-001', 2, 'req-1', 'admin-9', tx,
    );
    expect(tx.procurementRequestItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { approvedDamagedQty: { increment: 2 } },
    });
    expect(tx.procurementDamageClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'claim-1' },
        data: expect.objectContaining({ status: 'APPROVED', reviewedByAdminId: 'admin-9' }),
      }),
    );
    expect(tx.procurementRequest.update).toHaveBeenCalled();
    expect(res.finalPayableAmount).toBe('945');
  });

  it('refuses a claim that is not PENDING', async () => {
    const { service } = makeService({ ...PENDING_CLAIM, status: 'APPROVED' });
    await expect(
      service.approveDamageClaim('admin-9', 'claim-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws NotFound for a missing claim', async () => {
    const { service } = makeService(null);
    await expect(
      service.approveDamageClaim('admin-9', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('ProcurementService.rejectDamageClaim', () => {
  it('returns the units to saleable stock and leaves approvedDamagedQty untouched', async () => {
    const { service, inventoryService, tx } = makeService(PENDING_CLAIM);
    await service.rejectDamageClaim('admin-9', 'claim-1', 'not actually damaged');

    expect(inventoryService.addProcurementStock).toHaveBeenCalledWith(
      'franchise-1', 'prod-1', null, 'SKU-001', 2, 'req-1', 'admin-9', undefined, 'ADMIN', tx,
    );
    // Rejected → the units are NOT accepted as damaged.
    expect(tx.procurementRequestItem.update).not.toHaveBeenCalled();
    expect(tx.procurementDamageClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
  });
});
