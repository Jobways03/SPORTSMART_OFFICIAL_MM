// Phase 80 (2026-05-22) — unified SLA cron coverage.
//
// Audit gaps verified here:
//   Gap #3  — filter on acceptDeadlineAt, not createdAt
//   Gap #5  — franchise branch present (no longer skipped)
//   Gap #6  — uses valid enum reason; auto-stamp via auto:true flag
//   Gap #10 — drain-loop within one lock acquisition
//   Gap #18 — nodeType filter at the query level (no franchise-with-empty-sellerId calls)
//
// Cluster-B hardening — the raw setInterval + unfenced manual Redis lock is
// now a @Cron + LeaderElectedCron (fenced) + CronInstrumentationService.wrap.
// tick() no longer self-locks; run() is the leader-gated entrypoint, and a
// single best-effort CRON-actor audit row is written per non-empty sweep.

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
  // Leader wrapper executes the body by default (single-replica test). Tests
  // that want to assert the leader-skip path override `run`.
  const leader: any = {
    run: jest
      .fn()
      .mockImplementation(
        async (_name: string, _ttl: number, body: () => Promise<void>) => {
          await body();
          return { ran: true };
        },
      ),
  };
  // Instrumentation just invokes the wrapped fn and returns its value.
  const instr: any = {
    wrap: jest
      .fn()
      .mockImplementation((_name: string, fn: () => Promise<unknown>) => fn()),
  };
  const audit: any = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new OrderAcceptanceSlaProcessor(
    prisma,
    env,
    ordersService,
    franchiseFacade,
    leader,
    instr,
    audit,
  );
  return { processor, prisma, leader, instr, audit, ordersService, franchiseFacade };
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

  it('writes ONE best-effort CRON-actor audit row per non-empty sweep', async () => {
    const { processor, audit } = makeProcessor({
      rows: [
        {
          id: 'sub-a',
          sellerId: 'seller-a',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
        {
          id: 'sub-b',
          sellerId: 'seller-b',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await processor.tick();
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'CRON',
        action: 'ORDER_AUTO_REJECTED',
        module: 'orders',
        metadata: expect.objectContaining({
          processed: 2,
          subOrderIds: ['sub-a', 'sub-b'],
        }),
      }),
    );
  });

  it('writes NO audit row when nothing was rejected', async () => {
    const { processor, audit } = makeProcessor({ rows: [] });
    await processor.tick();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('a failed audit write never throws out of the sweep', async () => {
    const { processor, audit } = makeProcessor({
      rows: [
        {
          id: 'sub-a',
          sellerId: 'seller-a',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptDeadlineAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    (audit.writeAuditLog as jest.Mock).mockRejectedValueOnce(
      new Error('audit down'),
    );
    await expect(processor.tick()).resolves.toEqual({
      processed: 1,
      failed: 0,
    });
  });
});

describe('OrderAcceptanceSlaProcessor.run (Cluster-B cron wiring)', () => {
  it('runs the tick under the leader lock + instrumentation wrap', async () => {
    const { processor, leader, instr, prisma } = makeProcessor({ rows: [] });
    await processor.run();
    expect(leader.run).toHaveBeenCalledWith(
      'order-acceptance-sla',
      expect.any(Number),
      expect.any(Function),
    );
    expect(instr.wrap).toHaveBeenCalledWith(
      'order-acceptance-sla',
      expect.any(Function),
    );
    expect(prisma.subOrder.findMany).toHaveBeenCalled();
  });

  it('does NOT run the tick when another replica holds the leader lock', async () => {
    const { processor, leader, prisma } = makeProcessor({ rows: [] });
    (leader.run as jest.Mock).mockResolvedValueOnce({ ran: false });
    await processor.run();
    expect(prisma.subOrder.findMany).not.toHaveBeenCalled();
  });

  it('is disabled when ORDER_ACCEPTANCE_SLA_MINUTES <= 0', async () => {
    const { processor, leader } = makeProcessor({ rows: [], slaMinutes: 0 });
    await processor.run();
    expect(leader.run).not.toHaveBeenCalled();
  });
});
