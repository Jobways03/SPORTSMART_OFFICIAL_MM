/**
 * Phase 61 (2026-05-22) — cart abandonment sweep cron (audit Gap
 * #12). Validates env gating, cutoff computation, event emission,
 * and the no-op log path.
 */

import 'reflect-metadata';
import { CartAbandonmentSweepCron } from './cart-abandonment-sweep.cron';

const FIXED_NOW = new Date('2026-05-22T10:00:00Z').getTime();

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

function build(overrides: {
  enabled?: string;
  cutoffDays?: number;
  deleted?: number;
} = {}) {
  const cartService: any = {
    sweepAbandonedCarts: jest.fn().mockResolvedValue(overrides.deleted ?? 0),
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(overrides.enabled !== 'false'),
    getNumber: jest.fn().mockReturnValue(overrides.cutoffDays ?? 90),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const leader: any = {
    run: jest.fn(async (_n: string, _ttl: number, fn: () => Promise<void>) => fn()),
  };
  const cron = new CartAbandonmentSweepCron(cartService, env, eventBus, leader);
  return { cron, cartService, env, eventBus, leader };
}

describe('CartAbandonmentSweepCron (Phase 61)', () => {
  it('computes the cutoff from now() minus cutoffDays', async () => {
    const { cron, cartService } = build({ cutoffDays: 90, deleted: 0 });
    await cron.runOnce();
    const expected = new Date(FIXED_NOW - 90 * 24 * 60 * 60 * 1000);
    expect(cartService.sweepAbandonedCarts).toHaveBeenCalledWith(expected);
  });

  it('emits cart.abandonment.swept when at least one cart was deleted', async () => {
    const { cron, eventBus } = build({ cutoffDays: 30, deleted: 5 });
    await cron.runOnce();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'cart.abandonment.swept',
        payload: expect.objectContaining({ deleted: 5, cutoffDays: 30 }),
      }),
    );
  });

  it('does NOT emit when zero carts were deleted (silence on no-op)', async () => {
    const { cron, eventBus } = build({ deleted: 0 });
    await cron.runOnce();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('returns the deleted count and cutoffDays from runOnce', async () => {
    const { cron } = build({ cutoffDays: 45, deleted: 3 });
    const res = await cron.runOnce();
    expect(res).toEqual({ cutoffDays: 45, deleted: 3 });
  });

  it('skips runOnce work when env flag is false', async () => {
    const { cron, cartService } = build({ enabled: 'false' });
    expect(cron.enabled()).toBe(false);
    // The decorator-driven entry point calls leader.run only when
    // enabled() — exercise the contract directly.
    await cron.sweep();
    expect(cartService.sweepAbandonedCarts).not.toHaveBeenCalled();
  });
});
