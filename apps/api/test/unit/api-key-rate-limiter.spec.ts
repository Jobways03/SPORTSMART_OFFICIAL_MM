import 'reflect-metadata';
import { ApiKeyRateLimiter } from '../../src/core/api-keys/api-key-rate-limiter.service';

/**
 * Phase 10 (PR 10.1) — ApiKeyRateLimiter (token bucket).
 *
 * The bucket math is the trust boundary for partner abuse: a bug here
 * either lets an attacker hammer the API ignoring limits or makes
 * legitimate clients see 429s during normal traffic. Pin the
 * starting capacity, refill, and rate-change graceful resize.
 */
describe('ApiKeyRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with full burst capacity (2× rate)', () => {
    const lim = new ApiKeyRateLimiter();
    // rate=60/min ⇒ capacity=120. We can consume 120 instantly.
    let allowed = 0;
    for (let i = 0; i < 130; i++) {
      const d = lim.consume('k1', 60);
      if (d.allowed) allowed += 1;
    }
    expect(allowed).toBe(120);
  });

  it('denies once tokens drained, returns sane retryAfter', () => {
    const lim = new ApiKeyRateLimiter();
    // Drain.
    for (let i = 0; i < 120; i++) lim.consume('k', 60);
    const denied = lim.consume('k', 60);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      // 60/min ⇒ 1 token per second; 1 token needed ⇒ ~1s.
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(2);
    }
  });

  it('refills tokens over time', () => {
    const lim = new ApiKeyRateLimiter();
    for (let i = 0; i < 120; i++) lim.consume('k', 60);
    expect(lim.consume('k', 60).allowed).toBe(false);
    // Advance 5 seconds at 60/min ⇒ 5 tokens regenerated.
    jest.advanceTimersByTime(5_000);
    let allowed = 0;
    for (let i = 0; i < 7; i++) {
      const d = lim.consume('k', 60);
      if (d.allowed) allowed += 1;
    }
    expect(allowed).toBe(5);
  });

  it('keeps separate buckets per key', () => {
    const lim = new ApiKeyRateLimiter();
    for (let i = 0; i < 120; i++) lim.consume('a', 60);
    expect(lim.consume('a', 60).allowed).toBe(false);
    expect(lim.consume('b', 60).allowed).toBe(true);
  });

  it('handles a rate change gracefully (clip tokens to new capacity)', () => {
    const lim = new ApiKeyRateLimiter();
    // First call seeds bucket at rate=300 ⇒ capacity=600.
    lim.consume('k', 300);
    // Now rate drops to 30 ⇒ capacity=60. Existing tokens clipped.
    let allowedAtNewRate = 0;
    for (let i = 0; i < 70; i++) {
      const d = lim.consume('k', 30);
      if (d.allowed) allowedAtNewRate += 1;
    }
    expect(allowedAtNewRate).toBeLessThanOrEqual(60);
  });
});
