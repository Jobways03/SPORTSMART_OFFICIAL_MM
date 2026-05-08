import 'reflect-metadata';
import { CronInstrumentationService } from '../../src/core/cron-observability/cron-instrumentation.service';

/**
 * Phase 8 (PR 8.3) — CronInstrumentationService.wrap.
 *
 * The wrap helper has to:
 *   - record start, end, duration, and result on success,
 *   - record start, end, duration, and error on throw,
 *   - rethrow the original error so cron retry semantics survive,
 *   - swallow registry-write failures (cron must run even when audit
 *     table is unhealthy).
 */
describe('CronInstrumentationService', () => {
  function setup(opts: { failCreate?: boolean; failUpdate?: boolean } = {}) {
    const created: any[] = [];
    const updated: any[] = [];
    const fakePrisma: any = {
      cronRun: {
        create: jest.fn(async ({ data, select }) => {
          if (opts.failCreate) throw new Error('create-fail');
          const row = { ...data, id: `run-${created.length + 1}` };
          created.push(row);
          return select ? { id: row.id } : row;
        }),
        update: jest.fn(async ({ where, data }) => {
          if (opts.failUpdate) throw new Error('update-fail');
          updated.push({ where, data });
          return { ...where, ...data };
        }),
      },
    };
    return {
      svc: new CronInstrumentationService(fakePrisma),
      created,
      updated,
    };
  }

  it('records start + finish on success and returns the function value', async () => {
    const { svc, created, updated } = setup();
    const result = await svc.wrap('test.job', async () => ({ processed: 7 }));
    expect(result).toEqual({ processed: 7 });
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('RUNNING');
    expect(updated).toHaveLength(1);
    expect(updated[0].data.status).toBe('SUCCEEDED');
    expect(updated[0].data.durationMs).toBeGreaterThanOrEqual(0);
    expect(updated[0].data.result).toEqual({ processed: 7 });
  });

  it('records FAILED + error on throw, then rethrows the original error', async () => {
    const { svc, updated } = setup();
    const boom = new Error('boom!');
    await expect(
      svc.wrap('test.job', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(updated).toHaveLength(1);
    expect(updated[0].data.status).toBe('FAILED');
    expect(String(updated[0].data.error)).toMatch(/boom!/);
  });

  it('swallows a registry insert failure but still runs the job', async () => {
    const { svc, updated } = setup({ failCreate: true });
    const out = await svc.wrap('test.job', async () => 42);
    expect(out).toBe(42);
    // No id from create → update is skipped.
    expect(updated).toHaveLength(0);
  });

  it('swallows a registry update failure (we already returned the result)', async () => {
    const { svc } = setup({ failUpdate: true });
    const out = await svc.wrap('test.job', async () => 'ok');
    expect(out).toBe('ok');
  });

  it('truncates oversized error stack to 4 KB', async () => {
    const { svc, updated } = setup();
    const huge = 'x'.repeat(10_000);
    await expect(
      svc.wrap('test.job', async () => {
        const e = new Error('big');
        e.stack = huge;
        throw e;
      }),
    ).rejects.toBeDefined();
    const errText = updated[0].data.error as string;
    expect(errText.length).toBeLessThanOrEqual(4 * 1024);
  });

  it('only stores plain-object results, ignores arrays / scalars', async () => {
    const { svc, updated } = setup();

    await svc.wrap('test.job', async () => 'plain string');
    expect(updated[0].data.result).toBeUndefined();

    await svc.wrap('test.job', async () => [1, 2, 3]);
    expect(updated[1].data.result).toBeUndefined();

    await svc.wrap('test.job', async () => ({ a: 1 }));
    expect(updated[2].data.result).toEqual({ a: 1 });
  });
});
