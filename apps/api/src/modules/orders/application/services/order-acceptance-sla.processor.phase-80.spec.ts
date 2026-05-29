// Phase 80 (2026-05-22) — unified SLA cron coverage.
//
// Audit gaps verified here:
//   Gap #3  — filter on acceptDeadlineAt, not createdAt
//   Gap #5  — franchise branch present (no longer skipped)
//   Gap #6  — uses valid enum reason; auto-stamp via auto:true flag
//   Gap #10 — drain-loop within one lock acquisition
//   Gap #18 — nodeType filter at the query level (no franchise-with-empty-sellerId calls)

import { OrderAcceptanceSlaProcessor } from './order-acceptance-sla.processor';

function makeProcessor(opts?: {
  rows?: any[];
  multiBatches?: any[][];
  slaMinutes?: number;
  batchSize?: number;
}) {
  const findManyImpl = (() => {
    if (opts?.multiBatches) {
      let idx = 0;
      return jest.fn().mockImplementation(async () => {
        const batch = opts.multiBatches![idx] ?? [];
        idx += 1;
        return batch;
      });
    }
    return jest.fn().mockResolvedValue(opts?.rows ?? []);
  })();

  const prisma: any = { subOrder: { findMany: findManyImpl } };
  const redis: any = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const env: any = {
    getNumber: (k: string, d: number) => {
      if (k === 'ORDER_ACCEPTANCE_SLA_MINUTES') return opts?.slaMinutes ?? 60;
      if (k === 'ORDER_ACCEPTANCE_SLA_BATCH_SIZE') return opts?.batchSize ?? 100;
      return d;
    },
  };
  const ordersService: any = {
    sellerRejectOrder: jest.fn().mockResolvedValue({}),
  };
  const franchiseFacade: any = {
    rejectFranchiseOrder: jest.fn().mockResolvedValue({}),
  };
  const processor = new OrderAcceptanceSlaProcessor(
    prisma,
    redis,
    env,
    ordersService,
    franchiseFacade,
  );
  return { processor, prisma, redis, ordersService, franchiseFacade };
}

describe('OrderAcceptanceSlaProcessor.tick (Phase 80)', () => {
  it('Gap #3 — query filters by acceptDeadlineAt < now (not createdAt)', async () => {
    const { processor, prisma } = makeProcessor({ rows: [] });
    await processor.tick();
    expect(prisma.subOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          acceptDeadlineAt: expect.objectContaining({
            not: null,
            lt: expect.any(Date),
          }),
        }),
      }),
    );
    // And critically — does NOT filter by createdAt.
    const where = prisma.subOrder.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty('createdAt');
  });

  it('Gap #18 — query filters fulfillmentNodeType IN [SELLER, FRANCHISE]', async () => {
    const { processor, prisma } = makeProcessor({ rows: [] });
    await processor.tick();
    const where = prisma.subOrder.findMany.mock.calls[0]![0].where;
    expect(where.fulfillmentNodeType).toEqual({
      in: ['SELLER', 'FRANCHISE'],
    });
  });

  it('Gap #5 — franchise sub-order routes to franchiseFacade.rejectFranchiseOrder', async () => {
    const { processor, ordersService, franchiseFacade } = makeProcessor({
      rows: [
        {
          id: 'sub-fr',
          sellerId: null,
          franchiseId: 'fr-1',
          fulfillmentNodeType: 'FRANCHISE',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await processor.tick();
    expect(franchiseFacade.rejectFranchiseOrder).toHaveBeenCalledWith(
      'sub-fr',
      'fr-1',
      expect.objectContaining({ auto: true }),
    );
    expect(ordersService.sellerRejectOrder).not.toHaveBeenCalled();
  });

  it('Gap #5 — seller sub-order routes to ordersService.sellerRejectOrder with auto:true', async () => {
    const { processor, ordersService, franchiseFacade } = makeProcessor({
      rows: [
        {
          id: 'sub-s',
          sellerId: 'seller-1',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await processor.tick();
    expect(ordersService.sellerRejectOrder).toHaveBeenCalledWith(
      'sub-s',
      'seller-1',
      expect.objectContaining({ auto: true, reason: 'OTHER' }),
    );
    expect(franchiseFacade.rejectFranchiseOrder).not.toHaveBeenCalled();
  });

  it('Gap #10 — drain-loops across batches when first batch is full', async () => {
    const fullBatch = Array.from({ length: 100 }, (_, i) => ({
      id: `sub-${i}`,
      sellerId: `seller-${i}`,
      franchiseId: null,
      fulfillmentNodeType: 'SELLER',
      acceptDeadlineAt: new Date(Date.now() - 60_000),
    }));
    const partialBatch = Array.from({ length: 20 }, (_, i) => ({
      id: `sub-${100 + i}`,
      sellerId: `seller-${100 + i}`,
      franchiseId: null,
      fulfillmentNodeType: 'SELLER',
      acceptDeadlineAt: new Date(Date.now() - 60_000),
    }));
    const { processor, prisma, ordersService } = makeProcessor({
      multiBatches: [fullBatch, partialBatch],
      batchSize: 100,
    });
    await processor.tick();
    // Two findMany calls — first full batch + second partial.
    expect(prisma.subOrder.findMany).toHaveBeenCalledTimes(2);
    expect(ordersService.sellerRejectOrder).toHaveBeenCalledTimes(120);
  });

  it('Gap #10 — stops draining when batch is short (no more work)', async () => {
    const partial = Array.from({ length: 3 }, (_, i) => ({
      id: `sub-${i}`,
      sellerId: `seller-${i}`,
      franchiseId: null,
      fulfillmentNodeType: 'SELLER',
      acceptDeadlineAt: new Date(Date.now() - 60_000),
    }));
    const { processor, prisma } = makeProcessor({
      rows: partial,
      batchSize: 100,
    });
    await processor.tick();
    expect(prisma.subOrder.findMany).toHaveBeenCalledTimes(1);
  });

  it('handles franchise row with null franchiseId by skipping (no facade call)', async () => {
    const { processor, franchiseFacade } = makeProcessor({
      rows: [
        {
          id: 'sub-broken',
          sellerId: null,
          franchiseId: null,
          fulfillmentNodeType: 'FRANCHISE',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await processor.tick();
    expect(franchiseFacade.rejectFranchiseOrder).not.toHaveBeenCalled();
  });

  it('no-op when lock cannot be acquired (single-replica enforcement)', async () => {
    const { processor, prisma, redis } = makeProcessor({ rows: [] });
    (redis.acquireLock as jest.Mock).mockResolvedValueOnce(false);
    await processor.tick();
    expect(prisma.subOrder.findMany).not.toHaveBeenCalled();
  });
});
