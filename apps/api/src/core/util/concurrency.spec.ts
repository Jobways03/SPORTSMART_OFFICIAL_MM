// Phase 101 (2026-05-23) — Phase 104 audit Gap #4 coverage.

import { runWithConcurrency } from './concurrency';

describe('runWithConcurrency', () => {
  it('returns results in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('handles empty input', async () => {
    const out = await runWithConcurrency([], 5, async (n: number) => n);
    expect(out).toEqual([]);
  });

  it('limits in-flight work to concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [...Array(20).keys()];
    await runWithConcurrency(items, 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 'ok';
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('rejects concurrency <= 0', async () => {
    await expect(
      runWithConcurrency([1], 0, async (n) => n),
    ).rejects.toThrow(/concurrency/);
  });

  it('propagates per-item errors', async () => {
    const items = [1, 2, 3];
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
