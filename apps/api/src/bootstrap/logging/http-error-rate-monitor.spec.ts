import 'reflect-metadata';
import { HttpErrorRateMonitor } from './http-error-rate-monitor';

/**
 * Phase 5 (PR 5.8) — HTTP 5xx burst alerting.
 *
 * The `http_request_duration_ms` histogram (PR 5.7) gives Prometheus
 * what it needs to alert via PromQL rules. PR 5.8 adds an in-process
 * burst detector that runs on every request finish, so:
 *
 *   - Signal latency is < a single request (vs Prometheus scrape +
 *     alertmanager-eval cycle, which is typically 30s–2min).
 *   - The alert path stays live even if Prometheus is down.
 *   - The emitted event hooks into the existing notification module
 *     for Slack / email.
 *
 * Design:
 *   - Fixed-window counter (default 60s). Simple, deterministic, low
 *     memory footprint. Sliding-window adds accuracy but is overkill
 *     for "did we just have a burst?" detection.
 *   - Threshold = N 5xx in the window (default 10).
 *   - Cooldown = M seconds after firing (default 300s). Prevents one
 *     storm from emitting N events.
 *   - Threshold values are env-configurable but the SERVICE is the
 *     single source of truth; the middleware just calls
 *     `monitor.recordStatus(status)` per request.
 */

const noopLogger = {
  warn: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
} as any;

function buildMonitor(opts: {
  threshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  publish?: jest.Mock;
} = {}) {
  const eventBus = { publish: opts.publish ?? jest.fn().mockResolvedValue(undefined) } as any;
  return new HttpErrorRateMonitor(
    eventBus,
    noopLogger,
    {
      threshold: opts.threshold ?? 10,
      windowMs: opts.windowMs ?? 60_000,
      cooldownMs: opts.cooldownMs ?? 300_000,
    },
  );
}

describe('HttpErrorRateMonitor (PR 5.8)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does NOT fire below the threshold', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({ threshold: 10, publish });

    for (let i = 0; i < 9; i++) {
      await monitor.recordStatus(500);
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it('fires `http.error_rate.elevated` when threshold reached', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({ threshold: 10, publish });

    for (let i = 0; i < 10; i++) {
      await monitor.recordStatus(500);
    }
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'http.error_rate.elevated',
        payload: expect.objectContaining({
          count: 10,
          thresholdN: 10,
          windowSeconds: 60,
        }),
      }),
    );
  });

  it('does NOT count 2xx / 3xx / 4xx toward the threshold', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({ threshold: 5, publish });

    for (let i = 0; i < 20; i++) {
      await monitor.recordStatus(200);
      await monitor.recordStatus(301);
      await monitor.recordStatus(404);
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it('suppresses re-firing during the cooldown window', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({
      threshold: 10,
      cooldownMs: 5 * 60 * 1000,
      publish,
    });

    // First burst — fires.
    for (let i = 0; i < 10; i++) await monitor.recordStatus(500);
    expect(publish).toHaveBeenCalledTimes(1);

    // 2 minutes later, another 10 errors — within cooldown, no second event.
    jest.setSystemTime(new Date('2026-05-12T10:02:00Z'));
    for (let i = 0; i < 10; i++) await monitor.recordStatus(500);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('re-fires after the cooldown expires', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({
      threshold: 10,
      cooldownMs: 5 * 60 * 1000,
      publish,
    });

    for (let i = 0; i < 10; i++) await monitor.recordStatus(500);
    expect(publish).toHaveBeenCalledTimes(1);

    // 6 minutes later — past cooldown.
    jest.setSystemTime(new Date('2026-05-12T10:06:00Z'));
    for (let i = 0; i < 10; i++) await monitor.recordStatus(500);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('forgets old errors outside the rolling window', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({
      threshold: 10,
      windowMs: 60_000,
      cooldownMs: 0, // disable cooldown to isolate the windowing
      publish,
    });

    // 8 errors at T=0
    for (let i = 0; i < 8; i++) await monitor.recordStatus(500);
    expect(publish).not.toHaveBeenCalled();

    // 90s later, 5 more errors. The first 8 are outside the 60s
    // window, so the total IN-window count is 5 — still below 10.
    jest.setSystemTime(new Date('2026-05-12T10:01:30Z'));
    for (let i = 0; i < 5; i++) await monitor.recordStatus(500);
    expect(publish).not.toHaveBeenCalled();
  });

  it('swallows publish errors so a wedged event bus does not crash the request path', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('outbox unreachable'));
    const monitor = buildMonitor({ threshold: 1, publish });

    // Must not throw — middleware calls this synchronously off
    // res.on('finish'), so a throw would surface as an unhandled
    // rejection.
    await expect(monitor.recordStatus(500)).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('the emitted event payload carries the breach context for downstream alerting', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const monitor = buildMonitor({ threshold: 5, windowMs: 60_000, publish });

    for (let i = 0; i < 5; i++) await monitor.recordStatus(503);

    expect(publish).toHaveBeenCalledTimes(1);
    const event = publish.mock.calls[0][0];
    expect(event.eventName).toBe('http.error_rate.elevated');
    expect(event.aggregate).toBe('HttpErrorRate');
    expect(event.payload).toMatchObject({
      count: 5,
      thresholdN: 5,
      windowSeconds: 60,
    });
    // The first-error timestamp lets downstream alerts compute "how
    // long was the burst" rather than just "when did we detect it".
    expect(typeof event.payload.firstErrorAt).toBe('string');
    expect(event.payload.firstErrorAt).toMatch(/^2026-/);
  });
});
