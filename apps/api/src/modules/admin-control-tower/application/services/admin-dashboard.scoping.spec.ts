import { AdminDashboardService } from './admin-dashboard.service';
import { AdminControlTowerRepository } from '../../domain/repositories/admin-control-tower.repository.interface';
import { PrismaAdminControlTowerRepository } from '../../infrastructure/repositories/prisma-admin-control-tower.repository';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Regression coverage for the 2026-06-25 dashboard KPI seller-type scoping.
 *
 * Before the fix, getKpis() ran every count/sum marketplace-wide, so a
 * RETAILER_ADMIN / D2C_ADMIN saw cross-channel revenue, orders, and a "pending
 * orders" count that included OTHER channels (the symptom: the same numbers in
 * every admin portal). These tests assert (a) the service forwards the admin's
 * allowed seller types to every channel-scoped repo method and leaves countUsers
 * global, and (b) the repo builds the correct scoped `where` when restricting and
 * the byte-identical unscoped `where` for an unrestricted (SUPER_ADMIN) caller —
 * the zero-regression guarantee.
 */
describe('Dashboard KPI seller-type scoping', () => {
  describe('AdminDashboardService.getKpis — forwards scope', () => {
    const makeRepo = () => ({
      countMasterOrders: jest.fn().mockResolvedValue(0),
      sumPaidOrderRevenue: jest.fn().mockResolvedValue(0),
      countActiveProducts: jest.fn().mockResolvedValue(0),
      countActiveSellers: jest.fn().mockResolvedValue(0),
      countUsers: jest.fn().mockResolvedValue(0),
      countOrdersSince: jest.fn().mockResolvedValue(0),
      sumPaidRevenueSince: jest.fn().mockResolvedValue(0),
      countPendingSubOrders: jest.fn().mockResolvedValue(0),
      sumPlatformMargin: jest.fn().mockResolvedValue(0),
    });

    it('forwards ["RETAIL"] to every channel-scoped KPI but NOT to countUsers', async () => {
      const repo = makeRepo();
      const svc = new AdminDashboardService(
        repo as unknown as AdminControlTowerRepository,
      );
      await svc.getKpis(['RETAIL']);
      expect(repo.countMasterOrders).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.sumPaidOrderRevenue).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.countActiveProducts).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.countActiveSellers).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.countPendingSubOrders).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.sumPlatformMargin).toHaveBeenCalledWith(['RETAIL']);
      expect(repo.countOrdersSince).toHaveBeenCalledWith(expect.any(Date), ['RETAIL']);
      expect(repo.sumPaidRevenueSince).toHaveBeenCalledWith(expect.any(Date), ['RETAIL']);
      // Customers have no seller link → stays global (called with no scope arg).
      expect(repo.countUsers).toHaveBeenCalledWith();
    });

    it('passes undefined (unrestricted) when no scope given — SUPER_ADMIN unchanged', async () => {
      const repo = makeRepo();
      const svc = new AdminDashboardService(
        repo as unknown as AdminControlTowerRepository,
      );
      await svc.getKpis();
      expect(repo.countMasterOrders).toHaveBeenCalledWith(undefined);
      expect(repo.countPendingSubOrders).toHaveBeenCalledWith(undefined);
      expect(repo.countOrdersSince).toHaveBeenCalledWith(expect.any(Date), undefined);
    });
  });

  describe('PrismaAdminControlTowerRepository — scoped where clauses', () => {
    const makePrisma = () => ({
      subOrder: { count: jest.fn().mockResolvedValue(0) },
      seller: { count: jest.fn().mockResolvedValue(0) },
      masterOrder: { count: jest.fn().mockResolvedValue(0) },
    });

    it('countPendingSubOrders restricts by seller.sellerType when scoped', async () => {
      const prisma = makePrisma();
      const repo = new PrismaAdminControlTowerRepository(
        prisma as unknown as PrismaService,
      );
      await repo.countPendingSubOrders(['RETAIL']);
      expect(prisma.subOrder.count).toHaveBeenCalledWith({
        where: { acceptStatus: 'OPEN', seller: { sellerType: { in: ['RETAIL'] } } },
      });
    });

    it('countPendingSubOrders is unchanged (no seller clause) when unrestricted', async () => {
      const prisma = makePrisma();
      const repo = new PrismaAdminControlTowerRepository(
        prisma as unknown as PrismaService,
      );
      await repo.countPendingSubOrders(); // SUPER_ADMIN
      expect(prisma.subOrder.count).toHaveBeenCalledWith({
        where: { acceptStatus: 'OPEN' },
      });
      await repo.countPendingSubOrders([]); // empty = unrestricted too
      expect(prisma.subOrder.count).toHaveBeenLastCalledWith({
        where: { acceptStatus: 'OPEN' },
      });
    });

    it('countActiveSellers filters the sellerType column directly when scoped', async () => {
      const prisma = makePrisma();
      const repo = new PrismaAdminControlTowerRepository(
        prisma as unknown as PrismaService,
      );
      await repo.countActiveSellers(['D2C']);
      expect(prisma.seller.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', isDeleted: false, sellerType: { in: ['D2C'] } },
      });
    });

    it('countMasterOrders traverses subOrders.some.seller when scoped, undefined where otherwise', async () => {
      const prisma = makePrisma();
      const repo = new PrismaAdminControlTowerRepository(
        prisma as unknown as PrismaService,
      );
      await repo.countMasterOrders(['D2C']);
      expect(prisma.masterOrder.count).toHaveBeenCalledWith({
        where: { subOrders: { some: { seller: { sellerType: { in: ['D2C'] } } } } },
      });
      await repo.countMasterOrders();
      expect(prisma.masterOrder.count).toHaveBeenLastCalledWith({ where: undefined });
    });
  });
});
