import 'reflect-metadata';
import { PortalPushService } from '../../src/core/realtime/portal-push.service';

/**
 * Phase 9 (PR 9.1) — PortalPushService.
 *
 * Pin the fanout matcher: an event for customer A should reach a
 * customer-A subscriber, an admin-queue subscriber, and NOT a
 * customer-B subscriber. Plus the seller-disputes scope, the
 * resourceId narrowing, the connection-died reaper, and unregister.
 */
describe('PortalPushService', () => {
  // PR 9.x — PortalPushService gained constructor deps
  // (PrismaService, RedisService, EnvService, + optional Metrics/Audit).
  // These unit tests exercise the in-memory fanout only: a no-op Redis
  // (bridge never stood up — onModuleInit isn't called here), an env
  // stub for the connection-cap / heartbeat getNumber lookups, and a
  // Prisma stub whose audience-resolution findUnique calls return null
  // (every test supplies the routing id in the event payload, so the DB
  // fallback is never load-bearing).
  function makeSvc(): PortalPushService {
    const prisma: any = {
      return: { findUnique: jest.fn().mockResolvedValue(null) },
      dispute: { findUnique: jest.fn().mockResolvedValue(null) },
      ticket: { findUnique: jest.fn().mockResolvedValue(null) },
      affiliateCommission: { findUnique: jest.fn().mockResolvedValue(null) },
      affiliatePayoutRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      outboxEvent: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    const redis: any = { getClient: jest.fn().mockReturnValue(null) };
    const env: any = {
      getNumber: (_k: string, d: number) => d,
      getBoolean: () => false,
      getString: () => '',
    };
    return new PortalPushService(prisma, redis, env);
  }

  // Fill the Subscriber fields the registry now requires (actorKey /
  // actorId / actorType for the per-actor connection cap + audit;
  // failedWrites for the backpressure counter) from the partial each
  // test supplies. None of these tests register two connections for the
  // same actor, so the cap loop never fires.
  function sub(partial: any): any {
    return {
      actorKey: partial.id,
      actorId: partial.id,
      actorType: partial.scope?.kind ?? 'admin',
      failedWrites: 0,
      ...partial,
    };
  }

  function makeRes(): any {
    const writes: string[] = [];
    return {
      writes,
      write: jest.fn((s: string) => {
        writes.push(s);
        return true;
      }),
      end: jest.fn(),
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a `ready` frame on register', () => {
    const svc = makeSvc();
    const res = makeRes();
    svc.register(sub({
      id: 's1',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    }));
    // PR 9.x — frame types are now uppercase NormalizedType constants
    // (READY/HEARTBEAT/CASE_UPDATED/…). Was: 'event: ready'.
    expect(res.writes[0]).toContain('event: READY');
    svc.onModuleDestroy();
  });

  it('admin-queue scope receives every event', async () => {
    const svc = makeSvc();
    const res = makeRes();
    svc.register(sub({
      id: 'a1',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    }));
    // PR 9.x — fanout is async (audience resolution does a cached DB
    // lookup), so await the public broadcastEvent — the same path the
    // legacy fire-and-forget `broadcast(name, evt)` shim wraps — before
    // asserting. (Was: svc.broadcast('returns.return.requested', evt).)
    await svc.broadcastEvent({
      eventName: 'returns.return.requested',
      aggregateId: 'r1',
      payload: { customerId: 'cX' },
      occurredAt: new Date(),
    });
    expect(res.writes.some((w: string) => w.includes('returns.return.requested'))).toBe(true);
    svc.onModuleDestroy();
  });

  it('customer-case scope filters by customerId', async () => {
    const svc = makeSvc();
    const a = makeRes();
    const b = makeRes();
    svc.register(sub({
      id: 'a',
      scope: { kind: 'customer-case', customerId: 'A' },
      res: a,
      connectedAt: new Date(),
    }));
    svc.register(sub({
      id: 'b',
      scope: { kind: 'customer-case', customerId: 'B' },
      res: b,
      connectedAt: new Date(),
    }));
    await svc.broadcastEvent({
      eventName: 'returns.return.approved',
      aggregateId: 'r1',
      payload: { customerId: 'A', returnId: 'r1' },
      occurredAt: new Date(),
    });
    expect(a.writes.some((w: string) => w.includes('returns.return.approved'))).toBe(true);
    // B should only see the ready frame.
    const bMessageWrites = b.writes.filter((w: string) =>
      w.includes('returns.return.approved'),
    );
    expect(bMessageWrites).toHaveLength(0);
    svc.onModuleDestroy();
  });

  it('customer-case scope with resourceId narrows further', async () => {
    const svc = makeSvc();
    const res = makeRes();
    svc.register(sub({
      id: 's',
      scope: { kind: 'customer-case', customerId: 'A', resourceId: 'r1' },
      res,
      connectedAt: new Date(),
    }));
    // Different return for the same customer — should NOT deliver.
    await svc.broadcastEvent({
      eventName: 'returns.return.approved',
      aggregateId: 'r2',
      payload: { customerId: 'A', returnId: 'r2' },
      occurredAt: new Date(),
    });
    const matches = res.writes.filter((w: string) =>
      w.includes('returns.return.approved'),
    );
    expect(matches).toHaveLength(0);
    // Same return — should deliver.
    await svc.broadcastEvent({
      eventName: 'returns.return.approved',
      aggregateId: 'r1',
      payload: { customerId: 'A', returnId: 'r1' },
      occurredAt: new Date(),
    });
    expect(
      res.writes.filter((w: string) => w.includes('returns.return.approved')),
    ).toHaveLength(1);
    svc.onModuleDestroy();
  });

  it('seller-disputes scope filters on payload.sellerId', async () => {
    const svc = makeSvc();
    const a = makeRes();
    const b = makeRes();
    svc.register(sub({
      id: 'a',
      scope: { kind: 'seller-disputes', sellerId: 'sX' },
      res: a,
      connectedAt: new Date(),
    }));
    svc.register(sub({
      id: 'b',
      scope: { kind: 'seller-disputes', sellerId: 'sY' },
      res: b,
      connectedAt: new Date(),
    }));
    await svc.broadcastEvent({
      eventName: 'disputes.opened',
      aggregateId: 'd1',
      payload: { sellerId: 'sX' },
      occurredAt: new Date(),
    });
    expect(a.writes.some((w: string) => w.includes('disputes.opened'))).toBe(true);
    expect(b.writes.some((w: string) => w.includes('disputes.opened'))).toBe(false);
    svc.onModuleDestroy();
  });

  it('reaps subscribers whose write throws', async () => {
    const svc = makeSvc();
    const res = makeRes();
    res.write = jest.fn().mockImplementation((s: string) => {
      if (s.includes('returns.')) throw new Error('socket closed');
      return true;
    });
    svc.register(sub({
      id: 's',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    }));
    expect(svc.subscriberCount()).toBe(1);
    await svc.broadcastEvent({
      eventName: 'returns.return.approved',
      aggregateId: 'r1',
      payload: {},
      occurredAt: new Date(),
    });
    expect(svc.subscriberCount()).toBe(0);
    svc.onModuleDestroy();
  });

  it('teardown function returned by register removes the subscriber', () => {
    const svc = makeSvc();
    const res = makeRes();
    const teardown = svc.register(sub({
      id: 's',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    }));
    expect(svc.subscriberCount()).toBe(1);
    teardown();
    expect(svc.subscriberCount()).toBe(0);
    svc.onModuleDestroy();
  });
});
