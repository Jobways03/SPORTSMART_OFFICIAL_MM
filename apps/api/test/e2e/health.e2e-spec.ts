import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../../src/core/health/health.controller';
import { PrismaService } from '../../src/bootstrap/database/prisma.service';
import { RedisService } from '../../src/bootstrap/cache/redis.service';
import { buildTestApp } from './helpers/test-app';

/**
 * Smoke test validating the e2e scaffolding end-to-end.
 *
 * Why a health test first:
 *   - It has the smallest dependency surface (Prisma + Redis, both
 *     straightforward to fake).
 *   - It exercises every piece that future e2e tests need: NestJS
 *     bootstrap, global prefix, URI versioning, controller routing,
 *     JSON response shape, and HTTP status mapping.
 *   - The Dockerfile HEALTHCHECK hits `/api/v1/health/live`, so a
 *     test that pins that path is load-bearing for deploys, not just
 *     an example.
 *
 * What it proves:
 *   1. buildTestApp() boots a real INestApplication with the same
 *      global prefix + versioning main.ts uses.
 *   2. HealthController returns HTTP 200 when deps are healthy.
 *   3. HealthController returns HTTP 503 when a dep is down — the
 *      bug fixed in Area 29, now regression-tested at the HTTP layer.
 *   4. /health/live does not touch deps, so it stays 200 even when
 *      /health would 503.
 */

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: PrismaService,
      useValue: { $queryRawUnsafe: jest.fn().mockResolvedValue(undefined) },
    },
    {
      provide: RedisService,
      useValue: {
        getClient: () => ({ ping: jest.fn().mockResolvedValue('PONG') }),
      },
    },
  ],
})
class HealthyHealthModule {}

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: PrismaService,
      useValue: {
        $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('db down')),
      },
    },
    {
      provide: RedisService,
      useValue: {
        getClient: () => ({ ping: jest.fn().mockResolvedValue('PONG') }),
      },
    },
  ],
})
class DegradedHealthModule {}

describe('GET /api/v1/health — healthy deps', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildTestApp({ imports: [HealthyHealthModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status=healthy when both checks pass', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: 'healthy',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('GET /api/v1/health/live is reachable and returns alive', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
  });

  it('routing respects the global api prefix — bare /health must 404', async () => {
    // If main.ts drops the global prefix, this test starts passing
    // where it should 404, flagging the drift.
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/health — degraded deps', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildTestApp({ imports: [DegradedHealthModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with status=degraded when the database check fails', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      status: 'degraded',
      checks: { database: 'error', redis: 'ok' },
    });
  });

  it('GET /api/v1/health/live stays 200 even when readiness 503s', async () => {
    // The whole point of a separate liveness probe: a DB blip must
    // not restart every pod via the liveness path.
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
  });
});
