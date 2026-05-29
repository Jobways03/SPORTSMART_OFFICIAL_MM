// Phase 84 (2026-05-23) — order timeline / status history.
//
// Covers OrderTimelineService.record + getTimeline:
//   Gap #1     — table-backed persistence (write returns row id)
//   Gap #3     — actor metadata persisted
//   Gap #5/#14 — customer visibility filter strips ADMIN_ONLY rows
//   Gap #16    — per-eventType metadata whitelist for customer view
//   Gap #7     — default visibility map per eventType
//   Gap #10    — deterministic ordering by (createdAt, id)
//   R3         — idempotency key absorbs retries
//
// Wiring into OrdersService.verifyOrder / sellerAcceptOrder /
// adminCancelSubOrder / deliverSubOrder is exercised by the
// existing service-level specs which now construct a
// FakeOrderTimelineService.

import { OrderTimelineService } from './order-timeline.service';

function makeService(opts?: {
  createImpl?: jest.Mock;
  rows?: any[];
  total?: number;
}) {
  const create =
    opts?.createImpl ??
    jest.fn().mockResolvedValue({ id: 'evt-1' });
  const findUnique = jest
    .fn()
    .mockResolvedValue({ id: 'evt-existing' });
  const findMany = jest.fn().mockResolvedValue(opts?.rows ?? []);
  const count = jest.fn().mockResolvedValue(opts?.total ?? 0);
  const prisma: any = {
    orderStatusHistory: { create, findMany, count, findUnique },
  };
  const svc = new OrderTimelineService(prisma);
  return { svc, create, findMany, count, findUnique };
}

describe('OrderTimelineService.record (Phase 84)', () => {
  it('persists actorType + actorId + visibility (Gap #3/#7)', async () => {
    let captured: any = null;
    const { svc } = makeService({
      createImpl: jest.fn().mockImplementation((args: any) => {
        captured = args.data;
        return Promise.resolve({ id: 'evt-1' });
      }),
    });
    await svc.record({
      masterOrderId: 'master-1',
      subOrderId: 'sub-1',
      eventType: 'SUBORDER_PACKED',
      newStatus: 'PACKED',
      actorType: 'SELLER',
      actorId: 'seller-42',
    });
    expect(captured.eventType).toBe('SUBORDER_PACKED');
    expect(captured.actorType).toBe('SELLER');
    expect(captured.actorId).toBe('seller-42');
    // SUBORDER_PACKED defaults to CUSTOMER_VISIBLE per the recorder
    // visibility map (Gap #7/#14).
    expect(captured.visibility).toBe('CUSTOMER_VISIBLE');
  });

  it('honours explicit visibility override', async () => {
    let captured: any = null;
    const { svc } = makeService({
      createImpl: jest.fn().mockImplementation((args: any) => {
        captured = args.data;
        return Promise.resolve({ id: 'evt-1' });
      }),
    });
    await svc.record({
      masterOrderId: 'master-1',
      eventType: 'ORDER_VERIFIED',
      actorType: 'ADMIN',
      visibility: 'ADMIN_ONLY',
    });
    expect(captured.visibility).toBe('ADMIN_ONLY');
  });

  it('admin-only default for verification claim events (Gap #5)', async () => {
    let captured: any = null;
    const { svc } = makeService({
      createImpl: jest.fn().mockImplementation((args: any) => {
        captured = args.data;
        return Promise.resolve({ id: 'evt-1' });
      }),
    });
    await svc.record({
      masterOrderId: 'master-1',
      eventType: 'ORDER_VERIFICATION_CLAIMED',
      actorType: 'ADMIN',
    });
    expect(captured.visibility).toBe('ADMIN_ONLY');
  });

  it('returns existing row id on idempotency key conflict (R3)', async () => {
    const create = jest
      .fn()
      .mockRejectedValue({ code: 'P2002' });
    const findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'evt-already-there' });
    const prisma: any = {
      orderStatusHistory: { create, findUnique },
    };
    const svc = new OrderTimelineService(prisma);
    const id = await svc.record({
      masterOrderId: 'master-1',
      eventType: 'ORDER_VERIFIED',
      actorType: 'ADMIN',
      idempotencyKey: 'order-verified:master-1:2026-05-23T00:00:00Z',
    });
    expect(id).toBe('evt-already-there');
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'order-verified:master-1:2026-05-23T00:00:00Z',
      },
      select: { id: true },
    });
  });

  it('non-P2002 errors propagate', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('DB exploded'));
    const prisma: any = {
      orderStatusHistory: { create, findUnique: jest.fn() },
    };
    const svc = new OrderTimelineService(prisma);
    await expect(
      svc.record({
        masterOrderId: 'master-1',
        eventType: 'ORDER_VERIFIED',
        actorType: 'ADMIN',
      }),
    ).rejects.toThrow(/DB exploded/);
  });
});

describe('OrderTimelineService.getTimeline (Phase 84)', () => {
  it('admin audience returns full row shape with all fields', async () => {
    const { svc } = makeService({
      rows: [
        {
          id: 'evt-1',
          masterOrderId: 'master-1',
          subOrderId: 'sub-1',
          eventType: 'SUBORDER_REJECTED_MANUAL',
          oldStatus: 'OPEN',
          newStatus: 'REJECTED',
          actorType: 'SELLER',
          actorId: 'seller-42',
          actorName: 'Alice',
          visibility: 'CUSTOMER_VISIBLE',
          note: 'Out of stock',
          reason: 'OUT_OF_STOCK',
          metadata: { internalNote: 'flagged for review' },
          createdAt: new Date('2026-05-23T10:00:00Z'),
        },
      ],
      total: 1,
    });
    const result = await svc.getTimeline('master-1', { audience: 'ADMIN' });
    expect(result.items[0]).toMatchObject({
      actorType: 'SELLER',
      actorId: 'seller-42',
      actorName: 'Alice',
      reason: 'OUT_OF_STOCK',
      note: 'Out of stock',
      metadata: { internalNote: 'flagged for review' },
    });
  });

  it('customer audience strips actor + reason + admin metadata (Gap #5/#16)', async () => {
    const { svc } = makeService({
      rows: [
        {
          id: 'evt-1',
          masterOrderId: 'master-1',
          subOrderId: 'sub-1',
          eventType: 'SUBORDER_REJECTED_MANUAL',
          oldStatus: 'OPEN',
          newStatus: 'REJECTED',
          actorType: 'SELLER',
          actorId: 'seller-42',
          actorName: 'Alice',
          visibility: 'CUSTOMER_VISIBLE',
          note: 'Out of stock',
          reason: 'OUT_OF_STOCK',
          metadata: { internalNote: 'flagged for review' },
          createdAt: new Date('2026-05-23T10:00:00Z'),
        },
      ],
      total: 1,
    });
    const result = await svc.getTimeline('master-1', { audience: 'CUSTOMER' });
    const customerEvent = result.items[0];
    expect(customerEvent).not.toHaveProperty('actorName');
    expect(customerEvent).not.toHaveProperty('actorId');
    expect(customerEvent).not.toHaveProperty('reason');
    expect(customerEvent).not.toHaveProperty('note');
    // Internal metadata stripped — not in the whitelist for REJECTED_MANUAL.
    expect(customerEvent.metadata).toBeNull();
    expect(customerEvent.label).toBe('Finding an alternate seller');
  });

  it('customer audience passes through whitelisted metadata for SHIPPED (Gap #16)', async () => {
    const { svc } = makeService({
      rows: [
        {
          id: 'evt-1',
          masterOrderId: 'master-1',
          subOrderId: 'sub-1',
          eventType: 'SUBORDER_SHIPPED',
          newStatus: 'SHIPPED',
          actorType: 'SELLER',
          actorId: 'seller-42',
          visibility: 'CUSTOMER_VISIBLE',
          metadata: {
            trackingNumber: 'AWB12345678',
            courierName: 'DTDC',
            trackingUrl: 'https://dtdc.in/track/AWB12345678',
            // Internal-only:
            internalCost: 50,
          },
          createdAt: new Date('2026-05-23T11:00:00Z'),
        },
      ],
      total: 1,
    });
    const result = await svc.getTimeline('master-1', { audience: 'CUSTOMER' });
    expect(result.items[0].metadata).toEqual({
      trackingNumber: 'AWB12345678',
      courierName: 'DTDC',
      trackingUrl: 'https://dtdc.in/track/AWB12345678',
    });
    expect(result.items[0].metadata.internalCost).toBeUndefined();
  });

  it('customer audience filters WHERE visibility = CUSTOMER_VISIBLE server-side (Gap #5)', async () => {
    const { svc, findMany } = makeService();
    await svc.getTimeline('master-1', { audience: 'CUSTOMER' });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.visibility).toBe('CUSTOMER_VISIBLE');
  });

  it('admin audience does NOT apply visibility filter', async () => {
    const { svc, findMany } = makeService();
    await svc.getTimeline('master-1', { audience: 'ADMIN' });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.visibility).toBeUndefined();
  });

  it('orderBy is deterministic: createdAt asc, id asc (Gap #10)', async () => {
    const { svc, findMany } = makeService();
    await svc.getTimeline('master-1', { audience: 'ADMIN' });
    const orderBy = findMany.mock.calls[0]![0].orderBy;
    expect(orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('limit clamped to [1, 200]', async () => {
    const { svc, findMany } = makeService();
    await svc.getTimeline('master-1', { audience: 'ADMIN', limit: 5000 });
    expect(findMany.mock.calls[0]![0].take).toBe(200);
    await svc.getTimeline('master-1', { audience: 'ADMIN', limit: 0 });
    expect(findMany.mock.calls[1]![0].take).toBe(1);
  });

  it('threads before cursor as createdAt < lt filter', async () => {
    const { svc, findMany } = makeService();
    const before = new Date('2026-05-22T00:00:00Z');
    await svc.getTimeline('master-1', { audience: 'ADMIN', before });
    expect(findMany.mock.calls[0]![0].where.createdAt).toEqual({ lt: before });
  });

  it('returns nextCursor when result page is full', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `evt-${i}`,
      masterOrderId: 'master-1',
      subOrderId: null,
      eventType: 'ORDER_PLACED',
      actorType: 'CUSTOMER',
      visibility: 'CUSTOMER_VISIBLE',
      createdAt: new Date(`2026-05-2${i % 5}T00:00:00Z`),
    }));
    const { svc } = makeService({ rows, total: 120 });
    const result = await svc.getTimeline('master-1', {
      audience: 'ADMIN',
      limit: 50,
    });
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(120);
    expect(result.nextCursor).toEqual(rows[49]!.createdAt);
  });

  it('returns null nextCursor on short page', async () => {
    const { svc } = makeService({
      rows: [
        {
          id: 'e1',
          eventType: 'ORDER_PLACED',
          actorType: 'CUSTOMER',
          visibility: 'CUSTOMER_VISIBLE',
          createdAt: new Date(),
        },
      ],
      total: 1,
    });
    const result = await svc.getTimeline('master-1', { audience: 'ADMIN' });
    expect(result.nextCursor).toBeNull();
  });
});
