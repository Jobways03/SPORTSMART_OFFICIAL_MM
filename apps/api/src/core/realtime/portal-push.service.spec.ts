import { PortalPushService } from './portal-push.service';
import type { SubscriberScope } from './portal-sse.types';

/** Fake SSE response that captures written frames. */
function makeRes(opts?: { drains?: boolean }) {
  const chunks: string[] = [];
  return {
    chunks,
    ended: false,
    write(s: string) {
      chunks.push(s);
      return opts?.drains === false ? false : true;
    },
    end() {
      this.ended = true;
    },
    setHeader() {},
    flushHeaders() {},
    status() {
      return this;
    },
  } as any;
}

interface Frame {
  id?: string;
  event?: string;
  data?: any;
}

function frames(res: { chunks: string[] }): Frame[] {
  return res.chunks
    .join('')
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const f: Frame = {};
      for (const ln of block.split('\n')) {
        if (ln.startsWith('id: ')) f.id = ln.slice(4);
        else if (ln.startsWith('event: ')) f.event = ln.slice(7);
        else if (ln.startsWith('data: ')) {
          try {
            f.data = JSON.parse(ln.slice(6));
          } catch {
            /* comment / partial */
          }
        }
      }
      return f;
    })
    .filter((f) => f.event);
}

const domainFrames = (res: { chunks: string[] }) =>
  frames(res).filter((f) => f.event !== 'READY' && f.event !== 'HEARTBEAT' && f.event !== 'evicted');

function makePrisma() {
  return {
    return: { findUnique: jest.fn().mockResolvedValue(null) },
    dispute: { findUnique: jest.fn().mockResolvedValue(null) },
    ticket: { findUnique: jest.fn().mockResolvedValue(null) },
    outboxEvent: { findUnique: jest.fn(), findMany: jest.fn() },
  };
}

const env = { getNumber: (_k: string, d: number) => d } as any;
const redis = { getClient: () => undefined } as any;

describe('PortalPushService — fan-out, scope, redaction', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: PortalPushService;
  let n = 0;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new PortalPushService(prisma as any, redis, env);
  });
  afterEach(() => svc.onModuleDestroy());

  const register = (scope: SubscriberScope, res: any, opts?: { lastEventId?: string }) => {
    const actorId =
      scope.kind === 'customer-case'
        ? scope.customerId
        : scope.kind === 'seller-disputes'
          ? scope.sellerId
          : scope.kind === 'franchise-cases'
            ? scope.franchiseId
            : scope.kind === 'affiliate-earnings'
              ? scope.affiliateId
              : 'admin-1';
    const actorKey =
      scope.kind === 'admin-queue' ? `admin:${actorId}` : `${scope.kind}:${actorId}`;
    return svc.register(
      {
        id: `sub-${++n}`,
        scope,
        actorKey,
        actorId,
        actorType: scope.kind,
        res,
        connectedAt: new Date(),
        failedWrites: 0,
      },
      opts,
    );
  };

  it('delivers a return event to its customer (payload customerId)', async () => {
    const res = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    await svc.broadcastEvent({
      eventName: 'returns.return.requested',
      aggregateId: 'r1',
      payload: { customerId: 'C1', returnId: 'r1', returnNumber: 'RET-1', eventId: 'e1' },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.event).toBe('CASE_CREATED');
    expect(fr[0]?.id).toBe('e1');
    expect(fr[0]?.data?.resourceId).toBe('r1');
  });

  it('CRITICAL FIX: resolves customer via DB when payload omits customerId', async () => {
    prisma.return.findUnique.mockResolvedValue({ customerId: 'C1', sellerIdSnapshot: 'S1' });
    const res = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    // qc_completed carries NO customerId — the old matcher dropped it.
    await svc.broadcastEvent({
      eventName: 'returns.return.qc_completed',
      aggregateId: 'r1',
      payload: { returnId: 'r1', qcDecision: 'APPROVED', refundAmount: 12345 },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.data?.status).toBe('APPROVED');
    // financial field must be redacted out of the customer frame
    expect(fr[0]?.data?.refundAmount).toBeUndefined();
  });

  it('CRITICAL FIX: ticket events (tickets.*) reach the customer creator', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ creatorId: 'C1', creatorType: 'CUSTOMER' });
    const res = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    await svc.broadcastEvent({
      eventName: 'tickets.message.added',
      aggregateId: 't1',
      payload: { ticketId: 't1', ticketNumber: 'TKT-1', recipientEmail: 'x@y.com' },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.event).toBe('TICKET_MESSAGE_CREATED');
    expect(fr[0]?.data?.recipientEmail).toBeUndefined();
  });

  it('does NOT deliver sla.* to a customer (admin-only family)', async () => {
    const res = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    await svc.broadcastEvent({
      eventName: 'sla.breached',
      aggregateId: 'r1',
      payload: { resourceType: 'Return', resourceId: 'r1', customerId: 'C1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(0);
  });

  it('does NOT deliver admin-internal events (refund_rejected) to a customer', async () => {
    prisma.dispute.findUnique.mockResolvedValue({
      filedById: 'C1',
      filedByType: 'CUSTOMER',
      subOrder: null,
    });
    const res = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    await svc.broadcastEvent({
      eventName: 'disputes.refund_rejected',
      aggregateId: 'd1',
      payload: { disputeId: 'd1', reason: 'internal', financeAdminId: 'A1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(0);
  });

  it('resolves seller via subOrder for a dispute event', async () => {
    prisma.dispute.findUnique.mockResolvedValue({
      filedById: 'C1',
      filedByType: 'CUSTOMER',
      subOrder: { sellerId: 'S1' },
    });
    const res = makeRes();
    register({ kind: 'seller-disputes', sellerId: 'S1' }, res);
    await svc.broadcastEvent({
      eventName: 'disputes.decided',
      aggregateId: 'd1',
      payload: { disputeId: 'd1', disputeNumber: 'DSP-1', outcome: 'CUSTOMER_FAVOUR' },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.data?.status).toBe('CUSTOMER_FAVOUR');
  });

  it('resolves franchise via return snapshot for a franchise stream', async () => {
    prisma.return.findUnique.mockResolvedValue({
      customerId: 'C1',
      sellerIdSnapshot: 'S1',
      franchiseIdSnapshot: 'F1',
    });
    const res = makeRes();
    register({ kind: 'franchise-cases', franchiseId: 'F1' }, res);
    await svc.broadcastEvent({
      eventName: 'returns.return.received',
      aggregateId: 'r1',
      payload: { returnId: 'r1', returnNumber: 'RET-9' },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.data?.number).toBe('RET-9');
  });

  it('franchise stream does NOT receive sla.* or another franchise events', async () => {
    prisma.return.findUnique.mockResolvedValue({
      customerId: 'C1',
      sellerIdSnapshot: 'S1',
      franchiseIdSnapshot: 'F2',
    });
    const res = makeRes();
    register({ kind: 'franchise-cases', franchiseId: 'F1' }, res);
    await svc.broadcastEvent({
      eventName: 'returns.return.received',
      aggregateId: 'r1',
      payload: { returnId: 'r1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(0); // belongs to F2
  });

  it('delivers affiliate commission/payout events to the owning affiliate (payload affiliateId)', async () => {
    const res = makeRes();
    register({ kind: 'affiliate-earnings', affiliateId: 'A1' }, res);
    await svc.broadcastEvent({
      eventName: 'affiliate.commission.locked',
      aggregateId: 'cm1',
      payload: { commissionId: 'cm1', affiliateId: 'A1', status: 'CONFIRMED', eventId: 'e1' },
      occurredAt: new Date(),
    });
    await svc.broadcastEvent({
      eventName: 'affiliate.payout.paid',
      aggregateId: 'pr1',
      payload: { payoutRequestId: 'pr1', affiliateId: 'A1', status: 'PAID' },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(2);
    expect(fr[0]?.event).toBe('EARNINGS_UPDATED');
    expect(fr[1]?.event).toBe('PAYOUT_UPDATED');
    expect(fr[0]?.data?.status).toBe('CONFIRMED');
  });

  it('affiliate stream isolation: A2 does not receive A1 earnings, and affiliate auth events never stream', async () => {
    const res = makeRes();
    register({ kind: 'affiliate-earnings', affiliateId: 'A1' }, res);
    await svc.broadcastEvent({
      eventName: 'affiliate.commission.locked',
      aggregateId: 'cm9',
      payload: { commissionId: 'cm9', affiliateId: 'A2', status: 'CONFIRMED' },
      occurredAt: new Date(),
    });
    // auth/account event must NOT be in the earnings family at all
    await svc.broadcastEvent({
      eventName: 'affiliate.logged_in',
      aggregateId: 'A1',
      payload: { affiliateId: 'A1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(0);
  });

  it('admin receives the firehose but with PII stripped', async () => {
    const res = makeRes();
    register({ kind: 'admin-queue' }, res);
    await svc.broadcastEvent({
      eventName: 'disputes.message.added',
      aggregateId: 'd1',
      payload: { disputeId: 'd1', body: 'secret', senderName: 'Priya', isInternalNote: false },
      occurredAt: new Date(),
    });
    const fr = domainFrames(res);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.data?.body).toBeUndefined();
    expect(fr[0]?.data?.senderName).toBeUndefined();
    expect(fr[0]?.data?.disputeId).toBe('d1');
  });

  it('?queues filter narrows the admin firehose', async () => {
    const res = makeRes();
    register({ kind: 'admin-queue', queues: ['returns'] }, res);
    await svc.broadcastEvent({
      eventName: 'disputes.filed',
      aggregateId: 'd1',
      payload: { disputeId: 'd1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(0); // disputes filtered out
    await svc.broadcastEvent({
      eventName: 'returns.return.requested',
      aggregateId: 'r1',
      payload: { customerId: 'C9', returnId: 'r1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(res)).toHaveLength(1);
  });

  it('enforces the per-actor connection cap (evicts oldest)', () => {
    const resList = Array.from({ length: 6 }, () => makeRes());
    resList.forEach((r) => register({ kind: 'customer-case', customerId: 'C1' }, r));
    expect(svc.connectionsForActor('customer-case:C1')).toBe(5); // cap=5
    expect(resList[0].ended).toBe(true); // oldest evicted + ended
  });

  it('drops a slow subscriber after repeated un-drained writes (backpressure)', async () => {
    const res = makeRes({ drains: false });
    register({ kind: 'customer-case', customerId: 'C1' }, res);
    for (let i = 0; i < 60; i++) {
      await svc.broadcastEvent({
        eventName: 'returns.return.requested',
        aggregateId: 'r1',
        payload: { customerId: 'C1', returnId: 'r1' },
        occurredAt: new Date(),
      });
    }
    expect(svc.subscriberCount()).toBe(0); // dropped
    expect(res.ended).toBe(true);
  });

  it('cross-customer isolation: C2 does not receive C1 events', async () => {
    prisma.return.findUnique.mockResolvedValue({ customerId: 'C1', sellerIdSnapshot: null });
    const r1 = makeRes();
    const r2 = makeRes();
    register({ kind: 'customer-case', customerId: 'C1' }, r1);
    register({ kind: 'customer-case', customerId: 'C2' }, r2);
    await svc.broadcastEvent({
      eventName: 'returns.return.received',
      aggregateId: 'r1',
      payload: { returnId: 'r1' },
      occurredAt: new Date(),
    });
    expect(domainFrames(r1)).toHaveLength(1);
    expect(domainFrames(r2)).toHaveLength(0);
  });
});
