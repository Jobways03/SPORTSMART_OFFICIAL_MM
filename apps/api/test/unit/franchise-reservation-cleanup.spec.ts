import 'reflect-metadata';
import { FranchiseReservationCleanupService } from '../../src/modules/franchise/application/services/franchise-reservation-cleanup.service';

/**
 * Phase 159p (audit #3) — franchise reservation-lifecycle correctness.
 *
 * The sweeper must release ONLY genuine abandoned-cart holds. The bug it fixes:
 * pre-159p it released committed-but-unshipped reservations (the reserve row had
 * no correlation id, so it couldn't see the hold belonged to a placed order) →
 * a paid order's stock was freed → oversell.
 */
function build(opts: {
  expired: any[];
  orderItemForRefIds?: string[]; // refIds that a placed OrderItem links to
  followUpForRefIds?: string[]; // refIds that already have a release/ship follow-up
}) {
  const orderItemSet = new Set(opts.orderItemForRefIds ?? []);
  const followUpSet = new Set(opts.followUpForRefIds ?? []);

  const prisma: any = {
    franchiseInventoryLedger: {
      findMany: jest.fn().mockResolvedValue(opts.expired),
      // follow-up lookup
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(followUpSet.has(where.referenceId) ? { id: 'follow' } : null),
      ),
    },
    orderItem: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(orderItemSet.has(where.stockReservationId) ? { id: 'oi' } : null),
      ),
    },
  };
  const inventoryService: any = { unreserveStock: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  const svc = new FranchiseReservationCleanupService(
    prisma,
    {} as any,
    inventoryService,
    logger,
    {} as any,
    {} as any,
  );
  return { svc, inventoryService, prisma, logger };
}

const reserveRow = (referenceId: string | null, over: Partial<any> = {}) => ({
  id: `led-${referenceId ?? 'null'}`,
  franchiseId: 'fr1',
  productId: 'p1',
  variantId: null,
  globalSku: 'SKU',
  quantityDelta: 5,
  referenceId,
  ...over,
});

describe('FranchiseReservationCleanupService.cleanup', () => {
  it('releases a genuine abandoned-cart hold (correlated, no order, no follow-up)', async () => {
    const { svc, inventoryService } = build({ expired: [reserveRow('R-abandoned')] });

    const released = await svc.cleanup();

    expect(released).toBe(1);
    expect(inventoryService.unreserveStock).toHaveBeenCalledWith('fr1', 'p1', null, 5, 'R-abandoned');
  });

  it('NEVER releases a reservation tied to a placed order (the oversell fix)', async () => {
    const { svc, inventoryService } = build({
      expired: [reserveRow('R-committed')],
      orderItemForRefIds: ['R-committed'], // an OrderItem carries this correlation id
    });

    const released = await svc.cleanup();

    expect(released).toBe(0);
    expect(inventoryService.unreserveStock).not.toHaveBeenCalled();
  });

  it('does not double-release an abandoned hold already released (follow-up present)', async () => {
    const { svc, inventoryService } = build({
      expired: [reserveRow('R-released')],
      followUpForRefIds: ['R-released'],
    });

    const released = await svc.cleanup();

    expect(released).toBe(0);
    expect(inventoryService.unreserveStock).not.toHaveBeenCalled();
  });

  it('skips a legacy reservation with no correlation id (conservative — never oversell)', async () => {
    const { svc, inventoryService, logger } = build({ expired: [reserveRow(null)] });

    const released = await svc.cleanup();

    expect(released).toBe(0);
    expect(inventoryService.unreserveStock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('processes a mixed batch correctly', async () => {
    const { svc, inventoryService } = build({
      expired: [
        reserveRow('R-abandoned', { id: 'a' }),
        reserveRow('R-committed', { id: 'b' }),
        reserveRow('R-released', { id: 'c' }),
        reserveRow(null, { id: 'd' }),
      ],
      orderItemForRefIds: ['R-committed'],
      followUpForRefIds: ['R-released'],
    });

    const released = await svc.cleanup();

    expect(released).toBe(1); // only R-abandoned
    expect(inventoryService.unreserveStock).toHaveBeenCalledTimes(1);
    expect(inventoryService.unreserveStock).toHaveBeenCalledWith('fr1', 'p1', null, 5, 'R-abandoned');
  });
});
