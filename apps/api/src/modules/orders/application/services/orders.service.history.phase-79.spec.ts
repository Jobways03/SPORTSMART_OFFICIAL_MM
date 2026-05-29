// Phase 79 (2026-05-22) — reassignment history hardening.
//
// Covers the audit gaps closed in OrdersService.getReassignmentHistory
// and the inline enrichment used by getOrder:
//
//   Gap #2  — franchise enrichment alongside sellers
//   Gap #5  — sub-order context (item count + index)
//   Gap #6  — eventType discriminator preserved end-to-end
//   Gap #7  — typed return shape
//   Gap #9  — batched enrichment (no N+1)
//   Gap #10 — pagination via cursor (`before`) + limit clamp
//   Gap #13 — newSubOrderId enrichment with item count + index
//   Gap #15 — time-range filter
//   Gap #20 — deterministic ordering (createdAt DESC, id ASC)
//
// The schema/writer side (eventType column populated by each
// reassign path) is covered by Phase 78's reassign spec + the
// Phase 79 integration regression.

import { OrdersService } from './orders.service';

type Mock = jest.Mock;

function makeService(opts?: {
  rows?: any[];
  sellerById?: Record<string, any>;
  franchiseById?: Record<string, any>;
  adminById?: Record<string, any>;
  subOrderById?: Record<string, any>;
  masterSubOrders?: any[];
  total?: number;
}) {
  const orderRepo: any = {
    findReassignmentLogs: jest
      .fn()
      .mockImplementation(async () => opts?.rows ?? []),
    countReassignmentLogs: jest
      .fn()
      .mockResolvedValue(opts?.total ?? (opts?.rows?.length ?? 0)),
    findMasterOrderByIdWithDetails: jest.fn(),
    findSeller: jest.fn(),
    executeTransaction: jest.fn(),
  };

  const sellerEntries = Object.values(opts?.sellerById ?? {});
  const franchiseEntries = Object.values(opts?.franchiseById ?? {});
  const adminEntries = Object.values(opts?.adminById ?? {});
  const subOrderEntries = Object.values(opts?.subOrderById ?? {});
  const masterSubOrders = opts?.masterSubOrders ?? [];

  const sellerFindMany: Mock = jest.fn().mockResolvedValue(sellerEntries);
  const franchiseFindMany: Mock = jest.fn().mockResolvedValue(franchiseEntries);
  const adminFindMany: Mock = jest.fn().mockResolvedValue(adminEntries);
  const subOrderFindMany: Mock = jest
    .fn()
    .mockImplementation(async (args: any) => {
      // Two callers:
      //   1) enrichment lookup with where.id.in (returns subOrderEntries)
      //   2) per-master order lookup (returns masterSubOrders)
      if (args?.where?.id?.in) return subOrderEntries;
      return masterSubOrders;
    });

  const prisma: any = {
    seller: { findMany: sellerFindMany },
    franchisePartner: { findMany: franchiseFindMany },
    admin: { findMany: adminFindMany },
    subOrder: { findMany: subOrderFindMany },
  };

  const svc = new OrdersService(
    orderRepo,
    { publish: jest.fn() } as any,
    {} as any,
    { reserveStock: jest.fn(), unreserveStock: jest.fn() } as any,
    prisma,
    {} as any,
    { getNumber: (_: string, d: number) => d } as any,
    {} as any,
  );

  return {
    svc,
    orderRepo,
    prisma,
    sellerFindMany,
    franchiseFindMany,
    adminFindMany,
    subOrderFindMany,
  };
}

const baseRow = (overrides: Partial<any> = {}): any => ({
  id: 'log-1',
  subOrderId: 'sub-1',
  masterOrderId: 'master-1',
  fromNodeType: 'SELLER',
  fromNodeId: 'seller-1',
  toNodeType: 'SELLER',
  toNodeId: 'seller-2',
  fromSellerId: 'seller-1',
  toSellerId: 'seller-2',
  reason: 'Admin manual reassignment for testing',
  failureReason: null,
  successful: true,
  newSubOrderId: null,
  reassignedBy: 'admin-1',
  reassignmentSequence: 1,
  eventType: 'ADMIN_MANUAL_OVERRIDE',
  createdAt: new Date('2026-05-22T10:00:00Z'),
  ...overrides,
});

describe('OrdersService.getReassignmentHistory (Phase 79)', () => {
  describe('Gap #2 — franchise enrichment alongside sellers', () => {
    it('resolves franchise display name when fromNodeType=FRANCHISE', async () => {
      const { svc, sellerFindMany, franchiseFindMany } = makeService({
        rows: [
          baseRow({
            fromNodeType: 'FRANCHISE',
            fromNodeId: 'fr-1',
            fromSellerId: 'fr-1',
            toNodeType: 'SELLER',
            toNodeId: 'seller-2',
          }),
        ],
        sellerById: { 'seller-2': { id: 'seller-2', sellerShopName: 'Shop B' } },
        franchiseById: { 'fr-1': { id: 'fr-1', businessName: 'Franchise A' } },
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items).toHaveLength(1);
      expect(items[0]!.fromName).toBe('Franchise A');
      expect(items[0]!.toName).toBe('Shop B');
      // Both lookups happened (Gap #2).
      expect(sellerFindMany).toHaveBeenCalledTimes(1);
      expect(franchiseFindMany).toHaveBeenCalledTimes(1);
    });

    it('resolves franchise display name when toNodeType=FRANCHISE', async () => {
      const { svc } = makeService({
        rows: [
          baseRow({
            fromNodeType: 'SELLER',
            fromNodeId: 'seller-1',
            toNodeType: 'FRANCHISE',
            toNodeId: 'fr-1',
          }),
        ],
        sellerById: { 'seller-1': { id: 'seller-1', sellerShopName: 'Shop A' } },
        franchiseById: { 'fr-1': { id: 'fr-1', businessName: 'Franchise X' } },
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.fromName).toBe('Shop A');
      expect(items[0]!.toName).toBe('Franchise X');
    });
  });

  describe('Gap #5/#13 — sub-order context + new sub-order linkage', () => {
    it('populates subOrderIndex + subOrderItemCount for each log row', async () => {
      const { svc } = makeService({
        rows: [
          baseRow({ subOrderId: 'sub-1' }),
          baseRow({ id: 'log-2', subOrderId: 'sub-2' }),
        ],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
        subOrderById: {
          'sub-1': { id: 'sub-1', _count: { items: 3 } },
          'sub-2': { id: 'sub-2', _count: { items: 1 } },
        },
        masterSubOrders: [
          { id: 'sub-1' },
          { id: 'sub-2' },
          { id: 'sub-3' },
        ],
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.subOrderIndex).toBe(1);
      expect(items[0]!.subOrderItemCount).toBe(3);
      expect(items[1]!.subOrderIndex).toBe(2);
      expect(items[1]!.subOrderItemCount).toBe(1);
    });

    it('populates newSubOrderId enrichment when set (Gap #13)', async () => {
      const { svc } = makeService({
        rows: [
          baseRow({
            subOrderId: 'sub-1',
            newSubOrderId: 'sub-new',
            eventType: 'AUTO_AFTER_SELLER_REJECT',
          }),
        ],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
        subOrderById: {
          'sub-1': { id: 'sub-1', _count: { items: 2 } },
          'sub-new': { id: 'sub-new', _count: { items: 2 } },
        },
        masterSubOrders: [
          { id: 'sub-1' },
          { id: 'sub-new' },
        ],
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.newSubOrderItemCount).toBe(2);
      expect(items[0]!.newSubOrderIndex).toBe(2);
    });
  });

  describe('Gap #6 — eventType preserved end-to-end', () => {
    it('passes through eventType from row to enriched output', async () => {
      const { svc } = makeService({
        rows: [
          baseRow({ eventType: 'AUTO_AFTER_FRANCHISE_REJECT' }),
        ],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.eventType).toBe('AUTO_AFTER_FRANCHISE_REJECT');
    });

    it('filters by eventType when passed in opts', async () => {
      const { svc, orderRepo } = makeService({ rows: [] });
      await svc.getReassignmentHistory('master-1', {
        eventType: 'ADMIN_MANUAL_OVERRIDE',
      });
      expect(orderRepo.findReassignmentLogs).toHaveBeenCalledWith(
        'master-1',
        expect.objectContaining({ eventType: 'ADMIN_MANUAL_OVERRIDE' }),
      );
      expect(orderRepo.countReassignmentLogs).toHaveBeenCalledWith(
        'master-1',
        expect.objectContaining({ eventType: 'ADMIN_MANUAL_OVERRIDE' }),
      );
    });
  });

  describe('Gap #1 — admin actor enrichment', () => {
    it('resolves reassignedBy → reassignedByName / Email', async () => {
      const { svc } = makeService({
        rows: [baseRow({ reassignedBy: 'admin-42' })],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
        adminById: {
          'admin-42': { id: 'admin-42', name: 'Alice', email: 'alice@x.com' },
        },
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.reassignedByName).toBe('Alice');
      expect(items[0]!.reassignedByEmail).toBe('alice@x.com');
    });

    it('reassignedByName is null for system-actor cascades', async () => {
      const { svc } = makeService({
        rows: [
          baseRow({
            reassignedBy: null,
            eventType: 'AUTO_AFTER_SELLER_REJECT',
          }),
        ],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
      });
      const { items } = await svc.getReassignmentHistory('master-1');
      expect(items[0]!.reassignedByName).toBeNull();
      expect(items[0]!.reassignedByEmail).toBeNull();
    });
  });

  describe('Gap #9 — batched enrichment, no N+1', () => {
    it('issues exactly one findMany per actor table regardless of row count', async () => {
      const rows = Array.from({ length: 20 }, (_, i) =>
        baseRow({
          id: `log-${i}`,
          subOrderId: `sub-${i % 3}`,
          fromNodeId: `seller-${i % 2}`,
          fromSellerId: `seller-${i % 2}`,
          toNodeId: `seller-${(i + 1) % 2}`,
          toSellerId: `seller-${(i + 1) % 2}`,
          reassignedBy: `admin-${i % 4}`,
        }),
      );
      const { svc, sellerFindMany, adminFindMany, subOrderFindMany } =
        makeService({
          rows,
          sellerById: {
            'seller-0': { id: 'seller-0', sellerShopName: 'S0' },
            'seller-1': { id: 'seller-1', sellerShopName: 'S1' },
          },
          adminById: {
            'admin-0': { id: 'admin-0', name: 'A0', email: 'a0@x' },
            'admin-1': { id: 'admin-1', name: 'A1', email: 'a1@x' },
            'admin-2': { id: 'admin-2', name: 'A2', email: 'a2@x' },
            'admin-3': { id: 'admin-3', name: 'A3', email: 'a3@x' },
          },
          subOrderById: {
            'sub-0': { id: 'sub-0', _count: { items: 1 } },
            'sub-1': { id: 'sub-1', _count: { items: 1 } },
            'sub-2': { id: 'sub-2', _count: { items: 1 } },
          },
          masterSubOrders: [{ id: 'sub-0' }, { id: 'sub-1' }, { id: 'sub-2' }],
        });
      await svc.getReassignmentHistory('master-1');
      // One findMany for sellers, one for admins, two for subOrders
      // (one for enrichment lookup, one for the master-level index map).
      expect(sellerFindMany).toHaveBeenCalledTimes(1);
      expect(adminFindMany).toHaveBeenCalledTimes(1);
      expect(subOrderFindMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('Gap #10 — pagination', () => {
    it('threads limit + before to the repo', async () => {
      const { svc, orderRepo } = makeService({ rows: [] });
      const before = new Date('2026-05-22T11:00:00Z');
      await svc.getReassignmentHistory('master-1', { limit: 5, before });
      expect(orderRepo.findReassignmentLogs).toHaveBeenCalledWith(
        'master-1',
        expect.objectContaining({ limit: 5, before }),
      );
    });

    it('returns a nextCursor when result page is full (== limit)', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        baseRow({
          id: `log-${i}`,
          createdAt: new Date(`2026-05-22T1${i}:00:00Z`),
        }),
      );
      const { svc } = makeService({
        rows,
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
        total: 12,
      });
      const result = await svc.getReassignmentHistory('master-1', { limit: 5 });
      expect(result.items).toHaveLength(5);
      expect(result.total).toBe(12);
      expect(result.nextCursor).toEqual(rows[4]!.createdAt);
    });

    it('nextCursor is null when result page is short (end of history)', async () => {
      const { svc } = makeService({
        rows: [baseRow()],
        sellerById: {
          'seller-1': { id: 'seller-1', sellerShopName: 'A' },
          'seller-2': { id: 'seller-2', sellerShopName: 'B' },
        },
      });
      const result = await svc.getReassignmentHistory('master-1', { limit: 5 });
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('Gap #15 — time range filter', () => {
    it('threads from/to to the repo', async () => {
      const { svc, orderRepo } = makeService({ rows: [] });
      const from = new Date('2026-05-22T00:00:00Z');
      const to = new Date('2026-05-22T23:59:59Z');
      await svc.getReassignmentHistory('master-1', { from, to });
      expect(orderRepo.findReassignmentLogs).toHaveBeenCalledWith(
        'master-1',
        expect.objectContaining({ from, to }),
      );
    });
  });

  describe('empty history', () => {
    it('returns items=[] total=0 nextCursor=null without exploding', async () => {
      const { svc } = makeService({ rows: [] });
      const result = await svc.getReassignmentHistory('master-1');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.nextCursor).toBeNull();
    });
  });
});
