/**
 * Phase 66 (2026-05-22) — PaymentExpirySweepCron (audit Gap #18).
 *
 * Pre-Phase-66 PENDING_PAYMENT orders past their paymentExpiresAt
 * sat forever. This cron flips them to CANCELLED + paymentStatus=
 * EXPIRED + emits an event for downstream consumers.
 */

import 'reflect-metadata';
import { PaymentExpirySweepCron } from './payment-expiry-sweep.cron';

const FIXED_NOW = new Date('2026-05-22T12:00:00Z').getTime();

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

function build(opts: { candidates?: any[]; updatedCount?: number; enabled?: boolean } = {}) {
  const prisma: any = {
    masterOrder: {
      findMany: jest.fn().mockResolvedValue(opts.candidates ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updatedCount ?? 1 }),
    },
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const leader: any = {
    run: jest.fn(async (_n: string, _ttl: number, fn: () => Promise<void>) => fn()),
  };
  return {
    cron: new PaymentExpirySweepCron(prisma, env, eventBus, leader),
    prisma,
    env,
    eventBus,
    leader,
  };
}

describe('PaymentExpirySweepCron (Phase 66 — Gap #18)', () => {
  it('returns 0 when no expired candidates', async () => {
    const { cron } = build({ candidates: [] });
    const res = await cron.runOnce();
    expect(res.expired).toBe(0);
  });

  it('flips each candidate to CANCELLED + EXPIRED inside a status-conditional update', async () => {
    const candidates = [
      { id: 'o-1', orderNumber: 'SM-0001', customerId: 'c-1' },
      { id: 'o-2', orderNumber: 'SM-0002', customerId: 'c-2' },
    ];
    const { cron, prisma } = build({ candidates });
    const res = await cron.runOnce();
    expect(res.expired).toBe(2);
    expect(prisma.masterOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderStatus: 'PENDING_PAYMENT' }),
        data: expect.objectContaining({
          orderStatus: 'CANCELLED',
          paymentStatus: 'EXPIRED',
        }),
      }),
    );
  });

  it('emits payments.payment.expired event for each expired order', async () => {
    const candidates = [
      { id: 'o-1', orderNumber: 'SM-0001', customerId: 'c-1' },
    ];
    const { cron, eventBus } = build({ candidates });
    await cron.runOnce();
    // The handler (OrderExpiredHandler) consumes `payments.payment.expired`;
    // the previous `orders.master.payment_expired` name had no subscriber, so
    // sweep-cancelled orders got no wallet refund / notification / audit.
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'payments.payment.expired',
        aggregateId: 'o-1',
      }),
    );
  });

  it('does NOT emit when status-conditional update lost the race (count=0)', async () => {
    const candidates = [
      { id: 'o-1', orderNumber: 'SM-0001', customerId: 'c-1' },
    ];
    const { cron, eventBus } = build({ candidates, updatedCount: 0 });
    const res = await cron.runOnce();
    expect(res.expired).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does not run when env flag is false', async () => {
    const { cron, prisma } = build({ enabled: false });
    await cron.sweep();
    expect(prisma.masterOrder.findMany).not.toHaveBeenCalled();
  });
});
