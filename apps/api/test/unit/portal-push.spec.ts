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
    const svc = new PortalPushService();
    const res = makeRes();
    svc.register({
      id: 's1',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    });
    expect(res.writes[0]).toContain('event: ready');
    svc.onModuleDestroy();
  });

  it('admin-queue scope receives every event', () => {
    const svc = new PortalPushService();
    const res = makeRes();
    svc.register({
      id: 'a1',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    });
    svc.broadcast('returns.return.requested', {
      eventName: 'returns.return.requested',
      aggregateId: 'r1',
      payload: { customerId: 'cX' },
      occurredAt: new Date(),
    });
    expect(res.writes.some((w: string) => w.includes('returns.return.requested'))).toBe(true);
    svc.onModuleDestroy();
  });

  it('customer-case scope filters by customerId', () => {
    const svc = new PortalPushService();
    const a = makeRes();
    const b = makeRes();
    svc.register({
      id: 'a',
      scope: { kind: 'customer-case', customerId: 'A' },
      res: a,
      connectedAt: new Date(),
    });
    svc.register({
      id: 'b',
      scope: { kind: 'customer-case', customerId: 'B' },
      res: b,
      connectedAt: new Date(),
    });
    svc.broadcast('returns.return.approved', {
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

  it('customer-case scope with resourceId narrows further', () => {
    const svc = new PortalPushService();
    const res = makeRes();
    svc.register({
      id: 's',
      scope: { kind: 'customer-case', customerId: 'A', resourceId: 'r1' },
      res,
      connectedAt: new Date(),
    });
    // Different return for the same customer — should NOT deliver.
    svc.broadcast('returns.return.approved', {
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
    svc.broadcast('returns.return.approved', {
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

  it('seller-disputes scope filters on payload.sellerId', () => {
    const svc = new PortalPushService();
    const a = makeRes();
    const b = makeRes();
    svc.register({
      id: 'a',
      scope: { kind: 'seller-disputes', sellerId: 'sX' },
      res: a,
      connectedAt: new Date(),
    });
    svc.register({
      id: 'b',
      scope: { kind: 'seller-disputes', sellerId: 'sY' },
      res: b,
      connectedAt: new Date(),
    });
    svc.broadcast('disputes.opened', {
      eventName: 'disputes.opened',
      aggregateId: 'd1',
      payload: { sellerId: 'sX' },
      occurredAt: new Date(),
    });
    expect(a.writes.some((w: string) => w.includes('disputes.opened'))).toBe(true);
    expect(b.writes.some((w: string) => w.includes('disputes.opened'))).toBe(false);
    svc.onModuleDestroy();
  });

  it('reaps subscribers whose write throws', () => {
    const svc = new PortalPushService();
    const res = makeRes();
    res.write = jest.fn().mockImplementation((s: string) => {
      if (s.includes('returns.')) throw new Error('socket closed');
      return true;
    });
    svc.register({
      id: 's',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    });
    expect(svc.subscriberCount()).toBe(1);
    svc.broadcast('returns.return.approved', {
      eventName: 'returns.return.approved',
      aggregateId: 'r1',
      payload: {},
      occurredAt: new Date(),
    });
    expect(svc.subscriberCount()).toBe(0);
    svc.onModuleDestroy();
  });

  it('teardown function returned by register removes the subscriber', () => {
    const svc = new PortalPushService();
    const res = makeRes();
    const teardown = svc.register({
      id: 's',
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    });
    expect(svc.subscriberCount()).toBe(1);
    teardown();
    expect(svc.subscriberCount()).toBe(0);
    svc.onModuleDestroy();
  });
});
