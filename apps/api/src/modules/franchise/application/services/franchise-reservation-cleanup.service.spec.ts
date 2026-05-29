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
  /** referenceIds that DO have a follow-up entry (won't be released). */
  followedUpRefIds?: string[];
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
    // Phase 159p — the sweeper now also checks whether a placed order references
    // the reservation (skip-if-order-linked, the oversell fix). These tests
    // exercise abandoned-cart orphans (no order), so default to null.
    orderItem: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    franchisePartner: {
      findMany: findManyContracts,
      update: updateContract,
    },
  } as any;

  const env = {
    getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
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

  const service = new FranchiseReservationCleanupService(
    prisma,
    env,
    inventory,
    logger,
    leader,
    instr,
  );

  return { service, prisma, env, inventory, leader, unreserveStock, instr };
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
});
