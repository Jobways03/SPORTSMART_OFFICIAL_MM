// Phase 100 (2026-05-23) — Phase 98 audit Gap #20 + Gap #21 coverage.

import { RazorpayRefundWebhookService } from './razorpay-refund-webhook.service';

function buildDeps(overrides: any = {}) {
  return {
    prisma: {
      razorpayRefundWebhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'wh-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      return: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    },
    logger: {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

function makePayload(opts: Partial<any> = {}) {
  return {
    eventId: 'evt_test_1',
    eventType: 'refund.processed',
    refundId: 'rfnd_abc123',
    paymentId: 'pay_xyz',
    refundStatus: 'processed',
    rawPayload: { event: 'refund.processed' } as any,
    ...opts,
  };
}

describe('RazorpayRefundWebhookService (Phase 100)', () => {
  it('dedups on P2002 (duplicate event_id)', async () => {
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        razorpayRefundWebhookEvent: {
          create: jest
            .fn()
            .mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })),
          update: jest.fn(),
        },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(makePayload());
    expect(out.outcome).toBe('DUPLICATE');
    expect(deps.prisma.return.findFirst).not.toHaveBeenCalled();
  });

  it('NO_MATCH when no Return owns the refundReference', async () => {
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(makePayload());
    expect(out.outcome).toBe('NO_MATCH');
  });

  it('flips REFUND_PROCESSING → REFUNDED on processed + publishes', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      refundAmount: 100,
    };
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(ret),
          update: jest.fn().mockResolvedValue({}),
        },
        returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(makePayload());
    expect(out.outcome).toBe('PROCESSED');
    const updateData = deps.prisma.return.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('REFUNDED');
    expect(deps.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'returns.refund.completed',
      }),
    );
  });

  it('no-op when Return already REFUNDED', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUNDED',
      refundAmount: 100,
    };
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(ret),
          update: jest.fn(),
        },
        returnStatusHistory: { create: jest.fn() },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(makePayload());
    expect(out.outcome).toBe('NO_OP');
    expect(deps.prisma.return.update).not.toHaveBeenCalled();
  });

  it('records failureReason on refund.failed webhook', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      refundAmount: 100,
    };
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(ret),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(
      makePayload({ refundStatus: 'failed', eventType: 'refund.failed' }),
    );
    expect(out.outcome).toBe('PROCESSED');
    const updateData = deps.prisma.return.update.mock.calls[0][0].data;
    expect(updateData.refundFailureReason).toMatch(/refund\.failed/);
    expect(deps.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'returns.refund.failed' }),
    );
  });

  it('CONFLICT log when failed webhook arrives after REFUNDED', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUNDED',
      refundAmount: 100,
    };
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(ret),
          update: jest.fn(),
        },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(
      makePayload({ refundStatus: 'failed', eventType: 'refund.failed' }),
    );
    expect(out.outcome).toBe('NO_OP');
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/CONFLICT/),
    );
  });

  it('IGNORED for unknown status', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      refundAmount: 100,
    };
    const deps = buildDeps({
      prisma: {
        ...buildDeps().prisma,
        return: {
          findFirst: jest.fn().mockResolvedValue(ret),
          update: jest.fn(),
        },
      },
    });
    const svc = new RazorpayRefundWebhookService(
      deps.prisma as any,
      deps.logger as any,
      deps.eventBus as any,
    );
    const out = await svc.handleEvent(
      makePayload({ refundStatus: 'pending' }),
    );
    expect(out.outcome).toBe('NO_OP');
    expect(deps.prisma.return.update).not.toHaveBeenCalled();
  });
});
