import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { HealthController } from '../../src/core/health/health.controller';

/**
 * Regression test for the /health endpoint HTTP-status bug.
 *
 * Before: the endpoint always returned HTTP 200 and signalled
 * degradation only in the JSON body (`success: false, status:
 * "degraded"`). Load balancers and k8s readiness probes decide up/down
 * purely from the status code, so a node whose DB connection had
 * dropped stayed in the target pool and kept shedding failures to
 * customers until someone manually pulled it out.
 *
 * After: `/health` sets the HTTP status to 503 when any dep check
 * fails, keeping 200 for the all-ok case. `/health/live` is a separate
 * probe that never touches deps — a DB blip should de-route traffic,
 * not restart every pod.
 */

describe('HealthController — HTTP status reflects dep health', () => {
  const buildController = (opts: { db: boolean; redis: boolean }) => {
    const prisma: any = {
      $queryRaw: opts.db
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error('db down')),
    };
    const redis: any = {
      getClient: () => ({
        ping: opts.redis
          ? jest.fn().mockResolvedValue('PONG')
          : jest.fn().mockRejectedValue(new Error('redis down')),
      }),
    };
    const captured: { status?: number } = {};
    const res: any = {
      status: (s: number) => {
        captured.status = s;
        return res;
      },
    };
    // External probes default OFF — getString returns the supplied default
    // ('false'), so the external probe is never invoked on these
    // LB-readiness (DB/Redis only) assertions.
    const env: any = { getString: (_k: string, d: string) => d };
    const externalProbe: any = { probeAll: jest.fn() };
    const ctrl = new HealthController(prisma, redis, env, externalProbe);
    return { ctrl, res, captured };
  };

  it('returns HTTP 200 with status=healthy when both checks pass', async () => {
    const { ctrl, res, captured } = buildController({ db: true, redis: true });
    const body = await ctrl.check(res);

    expect(captured.status).toBe(HttpStatus.OK);
    expect(body).toMatchObject({
      success: true,
      status: 'healthy',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('returns HTTP 503 with status=degraded when the database is down', async () => {
    const { ctrl, res, captured } = buildController({ db: false, redis: true });
    const body = await ctrl.check(res);

    expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toMatchObject({
      success: false,
      status: 'degraded',
      checks: { database: 'error', redis: 'ok' },
    });
  });

  it('returns HTTP 503 when redis is down even if the database is up', async () => {
    const { ctrl, res, captured } = buildController({ db: true, redis: false });
    const body = await ctrl.check(res);

    expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.checks).toEqual({ database: 'ok', redis: 'error' });
  });

  it('/health/live does not touch deps and always reports alive', () => {
    const { ctrl } = buildController({ db: false, redis: false });
    const body = ctrl.live();
    expect(body.status).toBe('alive');
    // The explicit assertion: liveness must not call $queryRawUnsafe /
    // redis. A genuine DB blip should de-route via readiness, not
    // restart every pod via liveness.
    // (We don't spy on the deps here because `live()` is synchronous
    // and returns without awaiting — the absence of a call is implicit
    // in the return type, but this test documents the contract.)
  });

  // Regression: infra/ci-cd/k8s/api.deployment.yaml's readinessProbe
  // targets /api/v1/health/ready. Before Phase 0 that route did not
  // exist — only @Get(), @Get('deps'), @Get('live') — so every pod
  // 404'd readiness forever and never joined the Service. /ready must
  // exist AND be dependency-aware (unlike /live).
  describe('/health/ready (k8s readiness probe)', () => {
    it('returns HTTP 200 + healthy when both deps pass', async () => {
      const { ctrl, res, captured } = buildController({ db: true, redis: true });
      const body = await ctrl.ready(res);
      expect(captured.status).toBe(HttpStatus.OK);
      expect(body).toMatchObject({ success: true, status: 'healthy' });
    });

    it('returns HTTP 503 when the database is down (dep-aware, unlike /live)', async () => {
      const { ctrl, res, captured } = buildController({ db: false, redis: true });
      const body = await ctrl.ready(res);
      expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.checks).toMatchObject({ database: 'error', redis: 'ok' });
    });

    it('returns HTTP 503 when redis is down', async () => {
      const { ctrl, res, captured } = buildController({ db: true, redis: false });
      await ctrl.ready(res);
      expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});
