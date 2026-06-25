import { FranchiseReservationCleanupService } from './franchise-reservation-cleanup.service';

/**
 * Phase 1 (PR 1.8) — Franchise reservation cleanup migrated to
 * `@Cron` + `LeaderElectedCron` + env-flag gating.
 *
 * Pins the new wiring:
 *   - Flag-OFF: zero DB / leader / cleanup traffic.
 *   - Flag-ON: tick goes through `leader.run` with the right job key
 *     and TTL, then invokes the cleanup body.
 *   - Cleanup walks ORDER_RESERVE ledger rows past the TTL, checks
 *     for a follow-up (UNRESERVE / SHIP / CANCEL), and calls
 *     `unreserveStock` only when no follow-up exists.
 */

function buildService(opts: {
  enabled?: boolean;
  expiredReservations?: Array<{
    id: string;
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    quantityDelta: number;
    referenceId: string | null;
  }>;
  /**
   * referenceIds that DO have a follow-up ledger entry (won't be released).
   * Doubles as the "cancel already released this master order" set for the
   * order-status-aware path (that check also goes through
   * franchiseInventoryLedger.findFirst, keyed by master-order id).
   */
  followedUpRefIds?: string[];
  /** reservedQty the franchise_stock lookup returns for legacy NULL-ref rows. */
  stockReservedQty?: number;
  /**
   * Maps a reservation referenceId → the placed OrderItem it is stamped on,
   * plus that item's sub-order / master-order status. Absent ref = no order
   * line (abandoned-cart orphan), matching the default `findFirst → null`.
   */
  orderItemsByRef?: Record<
    string,
    {
      masterOrderId: string;
      fulfillmentStatus?: string;
      acceptStatus?: string;
      masterOrderStatus?: string;
    }
  >;
}) {
  const findManyExpired = jest
    .fn()
    .mockResolvedValue(opts.expiredReservations ?? []);
  const findFirstFollowUp = jest.fn(async ({ where }: any) => {
    if ((opts.followedUpRefIds ?? []).includes(where.referenceId)) {
      return { id: 'followup-existing' };
    }
    return null;
  });
  const findManyContracts = jest.fn().mockResolvedValue([]);
  const updateContract = jest.fn().mockResolvedValue(undefined);

  const prisma = {
    franchiseInventoryLedger: {
      findMany: findManyExpired,
      findFirst: findFirstFollowUp,
    },
    // Phase 159p — the sweeper checks whether a placed order references the
    // reservation, and (this change) branches on that order's STATUS: a live
    // order is left alone (oversell guard); a cancelled/rejected order's leaked
    // hold is recovered. Absent ref → null = abandoned-cart orphan.
    orderItem: {
      findFirst: jest.fn(async ({ where }: any) => {
        const entry = (opts.orderItemsByRef ?? {})[where.stockReservationId];
        if (!entry) return null;
        return {
          id: `oi-${where.stockReservationId}`,
          subOrder: {
            masterOrderId: entry.masterOrderId,
            fulfillmentStatus: entry.fulfillmentStatus ?? 'UNFULFILLED',
            acceptStatus: entry.acceptStatus ?? 'OPEN',
            masterOrder: { orderStatus: entry.masterOrderStatus ?? 'PLACED' },
          },
        };
      }),
    },
    // Sweeper classifies legacy NULL-ref rows by their stock's reservedQty:
    // a reconciled (0) stock means the row is immutable history, not a
    // "pending manual review" backlog item.
    franchiseStock: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ reservedQty: opts.stockReservedQty ?? 0 }),
    },
    franchisePartner: {
      findMany: findManyContracts,
      update: updateContract,
    },
  } as any;

  const env = {
    getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
    // Cluster C — cleanup() now reads FRANCHISE_RESERVATION_CLEANUP_BATCH_SIZE.
    getNumber: jest.fn((_k: string, def: number) => def),
  } as any;

  const unreserveStock = jest.fn().mockResolvedValue(undefined);
  const inventory = { unreserveStock } as any;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  const leader = {
    run: jest.fn(async (_n: string, _ttl: number, body: () => Promise<void>) => {
      await body();
      return { ran: true };
    }),
  } as any;

  // Phase 5 (PR 5.1) — instrumentation passthrough: invoke fn(), return its
  // result so existing assertions on side-effects (unreserveStock, etc.)
  // still hold. New PR 5.1 tests below mock this explicitly to verify
  // the cron-run observability contract.
  const instr = {
    wrap: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  } as any;
  // Cluster C — best-effort per-tick audit summary row.
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new FranchiseReservationCleanupService(
    prisma,
    env,
    inventory,
    logger,
    leader,
    instr,
    audit,
  );

  return { service, prisma, env, inventory, leader, unreserveStock, instr, audit, logger };
}

describe('FranchiseReservationCleanupService — PR 1.8', () => {
  it('is a no-op when the env flag is off', async () => {
    const { service, leader, unreserveStock } = buildService({ enabled: false });
    await service.tick();
    expect(leader.run).not.toHaveBeenCalled();
    expect(unreserveStock).not.toHaveBeenCalled();
  });

  it('routes through LeaderElectedCron with the right key and TTL', async () => {
    const { service, leader } = buildService({});
    await service.tick();
    expect(leader.run).toHaveBeenCalledWith(
      'franchise-reservation-cleanup',
      expect.any(Number),
      expect.any(Function),
    );
    // TTL is 2× tick interval (120s for an EVERY_MINUTE cron).
    const ttl = leader.run.mock.calls[0][1];
    expect(ttl).toBeGreaterThanOrEqual(60);
  });

  // ── Headline: release on no follow-up ─────────────────────────────

  it('releases an ORDER_RESERVE with NO follow-up (the crash-mid-checkout case)', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        {
          id: 'led-1',
          franchiseId: 'f-1',
          productId: 'p-1',
          variantId: 'v-1',
          globalSku: 'sku-1',
          quantityDelta: -3, // -3 means 3 units held
          referenceId: 'order-stuck',
        },
      ],
      followedUpRefIds: [], // none — this is the orphan case
    });

    await service.tick();

    expect(unreserveStock).toHaveBeenCalledWith(
      'f-1',
      'p-1',
      'v-1',
      3, // Math.abs(quantityDelta)
      'order-stuck',
    );
  });

  it('does NOT release when a follow-up entry exists', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        {
          id: 'led-2',
          franchiseId: 'f-2',
          productId: 'p-2',
          variantId: null,
          globalSku: 'sku-2',
          quantityDelta: -5,
          referenceId: 'order-completed',
        },
      ],
      followedUpRefIds: ['order-completed'],
    });

    await service.tick();

    expect(unreserveStock).not.toHaveBeenCalled();
  });

  // ── Order-status-aware release (cancelled-order leaked holds) ──────
  //
  // The cancel path (orders.service / franchise-orders.service) releases a
  // franchise hold best-effort, keyed by master-order id. When that silently
  // fails the hold leaks; the sweeper now recovers it — but only for dead
  // orders, and idempotently, so a LIVE hold sharing the SKU's reservedQty
  // counter is never over-released.

  it('does NOT release a hold whose linked order is still LIVE (oversell guard)', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'led-live', franchiseId: 'f-1', productId: 'p-1', variantId: 'v-1', globalSku: 'sku-1', quantityDelta: -2, referenceId: 'res-live' },
      ],
      orderItemsByRef: {
        // Placed + accepted, not yet shipped → the order owns this hold.
        'res-live': { masterOrderId: 'mo-live', fulfillmentStatus: 'UNFULFILLED', acceptStatus: 'ACCEPTED', masterOrderStatus: 'SELLER_ACCEPTED' },
      },
    });

    await service.tick();

    expect(unreserveStock).not.toHaveBeenCalled();
  });

  it('RELEASES a leaked hold whose linked order is CANCELLED, keyed by master-order id', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'led-cxl', franchiseId: 'f-1', productId: 'p-9', variantId: null, globalSku: 'sku-9', quantityDelta: -1, referenceId: 'res-cxl' },
      ],
      orderItemsByRef: {
        'res-cxl': { masterOrderId: 'mo-cxl', acceptStatus: 'CANCELLED', masterOrderStatus: 'CANCELLED' },
      },
      followedUpRefIds: [], // cancel path's release never landed → must recover
    });

    await service.tick();

    // Released the held qty, tagged with the MASTER-ORDER id (the cancel path's
    // correlation id) — not the reserve's referenceId — so it's idempotent.
    expect(unreserveStock).toHaveBeenCalledWith('f-1', 'p-9', null, 1, 'mo-cxl');
  });

  it('also releases when only the SUB-ORDER is cancelled (acceptStatus REJECTED on a partial cancel)', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'led-rej', franchiseId: 'f-2', productId: 'p-3', variantId: 'v-3', globalSku: 'sku-3', quantityDelta: -1, referenceId: 'res-rej' },
      ],
      orderItemsByRef: {
        // Master is PARTIALLY_CANCELLED, but THIS sub-order was rejected.
        'res-rej': { masterOrderId: 'mo-part', acceptStatus: 'REJECTED', masterOrderStatus: 'PARTIALLY_CANCELLED' },
      },
    });

    await service.tick();

    expect(unreserveStock).toHaveBeenCalledWith('f-2', 'p-3', 'v-3', 1, 'mo-part');
  });

  it('does NOT double-release when the cancel path already freed the hold (idempotent — no oversell)', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'led-done', franchiseId: 'f-1', productId: 'p-1', variantId: null, globalSku: 'sku-1', quantityDelta: -1, referenceId: 'res-done' },
      ],
      orderItemsByRef: {
        'res-done': { masterOrderId: 'mo-done', acceptStatus: 'CANCELLED', masterOrderStatus: 'CANCELLED' },
      },
      // A release row already exists for the master-order id → cancel path won.
      followedUpRefIds: ['mo-done'],
    });

    await service.tick();

    expect(unreserveStock).not.toHaveBeenCalled();
  });

  it('processes multiple orphans in one tick', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'a', franchiseId: 'f1', productId: 'p1', variantId: null, globalSku: 's1', quantityDelta: -1, referenceId: 'r1' },
        { id: 'b', franchiseId: 'f1', productId: 'p2', variantId: null, globalSku: 's2', quantityDelta: -2, referenceId: 'r2' },
        { id: 'c', franchiseId: 'f2', productId: 'p3', variantId: null, globalSku: 's3', quantityDelta: -3, referenceId: 'r3' },
      ],
    });

    await service.tick();

    expect(unreserveStock).toHaveBeenCalledTimes(3);
  });

  it('selective release: only orphans, not followed-up', async () => {
    const { service, unreserveStock } = buildService({
      expiredReservations: [
        { id: 'a', franchiseId: 'f', productId: 'p', variantId: null, globalSku: 's1', quantityDelta: -1, referenceId: 'r-orphan-1' },
        { id: 'b', franchiseId: 'f', productId: 'p', variantId: null, globalSku: 's2', quantityDelta: -2, referenceId: 'r-completed' },
        { id: 'c', franchiseId: 'f', productId: 'p', variantId: null, globalSku: 's3', quantityDelta: -3, referenceId: 'r-orphan-2' },
      ],
      followedUpRefIds: ['r-completed'],
    });

    await service.tick();

    expect(unreserveStock).toHaveBeenCalledTimes(2);
    const refIds = unreserveStock.mock.calls.map((c: any) => c[4]);
    expect(refIds.sort()).toEqual(['r-orphan-1', 'r-orphan-2']);
  });

  // ── Legacy NULL-ref backlog de-noise ──────────────────────────────
  // A pre-159p reservation (no correlation id) is "pending manual review"
  // only while its stock STILL holds reserved units. Once the counter has
  // settled to 0, the row is reconciled immutable history and must NOT be
  // re-flagged every minute.

  it('does NOT flag a legacy NULL-ref row whose stock is already reconciled (reservedQty=0)', async () => {
    const { service, unreserveStock, logger } = buildService({
      expiredReservations: [
        { id: 'legacy-1', franchiseId: 'f', productId: 'p', variantId: null, globalSku: 's', quantityDelta: 1, referenceId: null },
      ],
      stockReservedQty: 0,
    });

    await service.tick();

    // Cannot (and must not) release against a 0 counter...
    expect(unreserveStock).not.toHaveBeenCalled();
    // ...and the reconciled row is no longer reported as a pending backlog.
    const flagged = (logger.warn as jest.Mock).mock.calls.some((c: any[]) =>
      String(c[0]).includes('pre-159p'),
    );
    expect(flagged).toBe(false);
  });

  it('still flags a legacy NULL-ref row whose stock genuinely holds reserved units', async () => {
    const { service, unreserveStock, logger } = buildService({
      expiredReservations: [
        { id: 'legacy-2', franchiseId: 'f', productId: 'p', variantId: null, globalSku: 's', quantityDelta: 1, referenceId: null },
      ],
      stockReservedQty: 4,
    });

    await service.tick();

    expect(unreserveStock).not.toHaveBeenCalled();
    const flagged = (logger.warn as jest.Mock).mock.calls.some((c: any[]) =>
      String(c[0]).includes('pre-159p'),
    );
    expect(flagged).toBe(true);
  });

  it('continues processing when one unreserveStock throws', async () => {
    const { service, inventory } = buildService({
      expiredReservations: [
        { id: 'a', franchiseId: 'f', productId: 'p1', variantId: null, globalSku: 's1', quantityDelta: -1, referenceId: 'r1' },
        { id: 'b', franchiseId: 'f', productId: 'p2', variantId: null, globalSku: 's2', quantityDelta: -2, referenceId: 'r2' },
      ],
    });
    // First call throws, second succeeds.
    inventory.unreserveStock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.tick();

    // Both calls attempted — the throw didn't bail the loop.
    expect(inventory.unreserveStock).toHaveBeenCalledTimes(2);
  });
});

describe('FranchiseReservationCleanupService — cron-run observability (PR 5.1)', () => {
  it('wraps every tick body via instr.wrap with the canonical job name', async () => {
    const { service, instr } = buildService({ enabled: true });
    await service.tick();
    expect(instr.wrap).toHaveBeenCalledTimes(1);
    expect(instr.wrap.mock.calls[0][0]).toBe('franchise-reservation-cleanup');
  });

  it('returns structured { released, contractsSuspended } so cron_runs.result captures the metric', async () => {
    let captured: unknown;
    const { service, instr, prisma } = buildService({ enabled: true });
    // Two stale ORDER_RESERVE rows, both released cleanly.
    prisma.franchiseInventoryLedger.findMany.mockResolvedValueOnce([
      { id: 'l1', franchiseId: 'f1', productId: 'p1', variantId: null, globalSku: 's1', quantityDelta: -3, referenceId: 'r1' },
      { id: 'l2', franchiseId: 'f1', productId: 'p2', variantId: null, globalSku: 's2', quantityDelta: -2, referenceId: 'r2' },
    ]);
    prisma.franchiseInventoryLedger.findFirst.mockResolvedValue(null);

    instr.wrap.mockImplementation(async (_n: string, fn: () => Promise<unknown>) => {
      captured = await fn();
      return captured;
    });

    await service.tick();
    expect(captured).toEqual(
      expect.objectContaining({ released: 2, contractsSuspended: expect.any(Number) }),
    );
  });

  it('throws inside wrap on cleanup failure — outer try/catch swallows for the tick boundary', async () => {
    const { service, instr, prisma } = buildService({ enabled: true });
    prisma.franchiseInventoryLedger.findMany.mockRejectedValueOnce(new Error('DB down'));
    instr.wrap.mockImplementation(async (_n: string, fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch (err) {
        // simulate real instr.wrap — re-throw after marking FAILED
        throw err;
      }
    });

    // tick() must NOT propagate — the outer catch in the impl swallows.
    await expect(service.tick()).resolves.toBeUndefined();
    expect(instr.wrap).toHaveBeenCalledTimes(1);
  });

  it('writes a best-effort audit summary row when reservations were released (Cluster C)', async () => {
    const { service, audit } = buildService({
      enabled: true,
      expiredReservations: [
        { id: 'l1', franchiseId: 'f1', productId: 'p1', variantId: null, globalSku: 's1', quantityDelta: -3, referenceId: 'r1' },
      ],
    });
    await service.tick();
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FRANCHISE_RESERVATION_CLEANUP',
        module: 'franchise',
        newValue: expect.objectContaining({ released: 1 }),
      }),
    );
  });

  it('does NOT write an audit row when nothing was released or suspended', async () => {
    const { service, audit } = buildService({ enabled: true, expiredReservations: [] });
    await service.tick();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('caps the expired-ledger scan with a take batch size (Cluster C)', async () => {
    const { service, prisma } = buildService({ enabled: true });
    await service.tick();
    expect(prisma.franchiseInventoryLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
        orderBy: { createdAt: 'asc' },
      }),
    );
  });
});
