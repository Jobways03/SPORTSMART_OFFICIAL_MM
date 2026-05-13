import 'reflect-metadata';
import { CronInstrumentationService } from './cron-instrumentation.service';
import { MetricsRegistry } from '../metrics/metrics.registry';

/**
 * Phase 5 (PR 5.6) — cron-instrumentation Prometheus metrics.
 *
 * Every wrap() call must emit two metrics:
 *
 *   `cron_runs_total{jobName, status}`
 *     Counter — incremented exactly once per finish.
 *     status ∈ { SUCCEEDED, FAILED }.
 *
 *   `cron_run_duration_ms{jobName}`
 *     Histogram — one observation per finish (success or failure).
 *
 * The metrics are emitted in `markFinished`, BEFORE the
 * `cron_runs` row update. A DB blip on the audit-row update should
 * NOT mean the duration / status is also missing from /metrics —
 * that's the very dashboard that pages on-call.
 */

const PROMETHEUS_RENDER_LINE = (
  metric: string,
  labels: Record<string, string>,
  value: number,
): RegExp => {
  // Stable label key order: sorted alphabetical.
  const keys = Object.keys(labels).sort();
  const parts = keys.map((k) => `${k}="${labels[k]}"`);
  const labelBlock = parts.length === 0 ? '' : `\\{${parts.join(',')}\\}`;
  return new RegExp(`${metric}${labelBlock}\\s+${value}\\b`);
};

function buildPrismaMock(opts: { failInsert?: boolean } = {}) {
  return {
    cronRun: {
      create: opts.failInsert
        ? jest.fn().mockRejectedValue(new Error('DB unreachable'))
        : jest.fn().mockResolvedValue({ id: 'run-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe('CronInstrumentationService — Prometheus metrics (PR 5.6)', () => {
  it('emits cron_runs_total{status=SUCCEEDED} on a clean wrap', async () => {
    const metrics = new MetricsRegistry();
    const prisma = buildPrismaMock();
    const instr = new CronInstrumentationService(prisma, metrics);

    await instr.wrap('my-job', async () => ({ processed: 5 }));

    const exposition = metrics.render();
    expect(exposition).toMatch(
      PROMETHEUS_RENDER_LINE('cron_runs_total', { jobName: 'my-job', status: 'SUCCEEDED' }, 1),
    );
  });

  it('emits cron_runs_total{status=FAILED} when the body throws', async () => {
    const metrics = new MetricsRegistry();
    const prisma = buildPrismaMock();
    const instr = new CronInstrumentationService(prisma, metrics);

    await expect(
      instr.wrap('my-job', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const exposition = metrics.render();
    expect(exposition).toMatch(
      PROMETHEUS_RENDER_LINE('cron_runs_total', { jobName: 'my-job', status: 'FAILED' }, 1),
    );
  });

  it('increments the counter per call (3 SUCCEEDED + 1 FAILED → 4 total samples)', async () => {
    const metrics = new MetricsRegistry();
    const prisma = buildPrismaMock();
    const instr = new CronInstrumentationService(prisma, metrics);

    await instr.wrap('my-job', async () => ({ ok: true }));
    await instr.wrap('my-job', async () => ({ ok: true }));
    await instr.wrap('my-job', async () => ({ ok: true }));
    await expect(
      instr.wrap('my-job', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();

    const exposition = metrics.render();
    expect(exposition).toMatch(
      PROMETHEUS_RENDER_LINE('cron_runs_total', { jobName: 'my-job', status: 'SUCCEEDED' }, 3),
    );
    expect(exposition).toMatch(
      PROMETHEUS_RENDER_LINE('cron_runs_total', { jobName: 'my-job', status: 'FAILED' }, 1),
    );
  });

  it('emits a cron_run_duration_ms histogram observation per finish', async () => {
    const metrics = new MetricsRegistry();
    const prisma = buildPrismaMock();
    const instr = new CronInstrumentationService(prisma, metrics);

    await instr.wrap('fast-job', async () => ({ ok: true }));
    await instr.wrap('fast-job', async () => ({ ok: true }));

    const exposition = metrics.render();
    // Two observations → _count should be 2.
    expect(exposition).toMatch(/cron_run_duration_ms_count\{jobName="fast-job"\}\s+2\b/);
    // _sum is a non-negative number.
    const sumMatch = exposition.match(/cron_run_duration_ms_sum\{jobName="fast-job"\}\s+(\d+)/);
    expect(sumMatch).not.toBeNull();
    expect(Number(sumMatch![1])).toBeGreaterThanOrEqual(0);
  });

  it('still emits metrics even when the cron_runs DB insert fails', async () => {
    // The whole point of /metrics is observability under DB stress.
    // If we only emitted metrics when the audit row succeeded, a
    // wedged DB would simultaneously break the audit trail AND the
    // dashboard — exactly when on-call needs the dashboard most.
    const metrics = new MetricsRegistry();
    const prisma = buildPrismaMock({ failInsert: true });
    const instr = new CronInstrumentationService(prisma, metrics);

    await instr.wrap('resilient-job', async () => ({ ok: true }));

    const exposition = metrics.render();
    expect(exposition).toMatch(
      PROMETHEUS_RENDER_LINE(
        'cron_runs_total',
        { jobName: 'resilient-job', status: 'SUCCEEDED' },
        1,
      ),
    );
    expect(exposition).toMatch(/cron_run_duration_ms_count\{jobName="resilient-job"\}\s+1\b/);
  });

  it('the registry exposes HELP and TYPE lines from instr construction (visible even before any wrap)', async () => {
    // A Grafana panel pinned to `cron_runs_total` must resolve even
    // on a freshly-booted replica that hasn't run any cron yet. The
    // descriptor lines come from registering the counter/histogram
    // at construct time, not at first-emit time.
    const metrics = new MetricsRegistry();
    new CronInstrumentationService(buildPrismaMock(), metrics);
    const exposition = metrics.render();
    expect(exposition).toMatch(/# HELP cron_runs_total /);
    expect(exposition).toMatch(/# TYPE cron_runs_total counter/);
    expect(exposition).toMatch(/# HELP cron_run_duration_ms /);
    expect(exposition).toMatch(/# TYPE cron_run_duration_ms histogram/);
  });
});
