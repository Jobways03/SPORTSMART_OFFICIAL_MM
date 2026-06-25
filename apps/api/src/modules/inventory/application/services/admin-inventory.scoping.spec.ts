import { InventoryManagementService } from './inventory-management.service';
import { InventoryManagementRepository } from '../../domain/repositories/inventory-management.repository.interface';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { StockMovementLedgerService } from './stock-movement-ledger.service';
import { PrismaInventoryManagementRepository } from '../../infrastructure/repositories/prisma-inventory-management.repository';

/**
 * Regression coverage for the 2026-06-25 admin-inventory seller-type scoping.
 *
 * Before the fix, every /admin/inventory endpoint ran marketplace-wide, so a
 * RETAILER_ADMIN / D2C_ADMIN saw all sellers' stock AND franchise stock (the
 * symptom: batting pads / gloves showing in the wrong channel's inventory).
 * These tests assert (a) the service forwards a restricting scope to the repo
 * and EXCLUDES franchise stock, (b) an unrestricted (SUPER_ADMIN) caller gets
 * the old behavior — no filter + franchise included (zero regression), and (c)
 * the repo builds the correct scoped `where` (and the unchanged one otherwise).
 */
describe('Admin inventory seller-type scoping', () => {
  describe('InventoryManagementService — scope forwarding + franchise exclusion', () => {
    const makeService = () => {
      const repo = {
        findActiveMappingsForAggregation: jest.fn().mockResolvedValue([]),
      } as unknown as InventoryManagementRepository;
      const franchiseFacade = {
        findFranchiseOutOfStockRows: jest.fn().mockResolvedValue([]),
      } as unknown as FranchisePublicFacade;
      const svc = new InventoryManagementService(
        repo,
        franchiseFacade,
        {} as unknown as PrismaService,
        {} as unknown as StockMovementLedgerService,
      );
      return { svc, repo, franchiseFacade };
    };

    it('restricted admin (["RETAIL"]): scopes the seller query and EXCLUDES franchise stock', async () => {
      const { svc, repo, franchiseFacade } = makeService();
      await svc.getOutOfStockProducts(1, 20, 'ALL', ['RETAIL']);
      expect(repo.findActiveMappingsForAggregation).toHaveBeenCalledWith(['RETAIL']);
      expect(franchiseFacade.findFranchiseOutOfStockRows).not.toHaveBeenCalled();
    });

    it('unrestricted (SUPER_ADMIN, null): no seller filter + franchise INCLUDED — unchanged', async () => {
      const { svc, repo, franchiseFacade } = makeService();
      await svc.getOutOfStockProducts(1, 20, 'ALL', null);
      expect(repo.findActiveMappingsForAggregation).toHaveBeenCalledWith(undefined);
      expect(franchiseFacade.findFranchiseOutOfStockRows).toHaveBeenCalled();
    });

    it('empty scope [] is treated as unrestricted (franchise still included)', async () => {
      const { svc, repo, franchiseFacade } = makeService();
      await svc.getOutOfStockProducts(1, 20, 'ALL', []);
      // [] passes through to the repo as [], which the repo treats as no filter
      // (its guard is `allowedSellerTypes?.length`); franchise stays included.
      expect(repo.findActiveMappingsForAggregation).toHaveBeenCalledWith([]);
      expect(franchiseFacade.findFranchiseOutOfStockRows).toHaveBeenCalled();
    });
  });

  describe('PrismaInventoryManagementRepository — scoped where clauses', () => {
    const makePrisma = () => ({
      sellerProductMapping: { findMany: jest.fn().mockResolvedValue([]) },
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    it('findAllActiveMappings filters seller.sellerType when scoped, plain isActive otherwise', async () => {
      const prisma = makePrisma();
      const repo = new PrismaInventoryManagementRepository(
        prisma as unknown as PrismaService,
      );
      await repo.findAllActiveMappings(undefined, ['RETAIL']);
      expect(prisma.sellerProductMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, seller: { sellerType: { in: ['RETAIL'] } } },
        }),
      );
      await repo.findAllActiveMappings();
      expect(prisma.sellerProductMapping.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('findActiveMappingsForAggregation scopes by seller.sellerType only when restricting', async () => {
      const prisma = makePrisma();
      const repo = new PrismaInventoryManagementRepository(
        prisma as unknown as PrismaService,
      );
      await repo.findActiveMappingsForAggregation(['D2C']);
      expect(prisma.sellerProductMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, seller: { sellerType: { in: ['D2C'] } } },
        }),
      );
      await repo.findActiveMappingsForAggregation();
      expect(prisma.sellerProductMapping.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('findActiveReservations filters via mapping.seller.sellerType when scoped', async () => {
      const prisma = makePrisma();
      const repo = new PrismaInventoryManagementRepository(
        prisma as unknown as PrismaService,
      );
      await repo.findActiveReservations(1, 20, { allowedSellerTypes: ['D2C'] });
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'RESERVED',
            mapping: { seller: { sellerType: { in: ['D2C'] } } },
          }),
        }),
      );
    });
  });
});
