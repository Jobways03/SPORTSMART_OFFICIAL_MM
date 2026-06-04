import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/bootstrap/database/prisma.service';
import { RedisService } from '../../src/bootstrap/cache/redis.service';
import { GlobalExceptionFilter } from '../../src/core/filters/global-exception.filter';

/**
 * Minimal smoke test. Asserts three things:
 *   1. The app boots end-to-end (every module wires, no DI cycles).
 *   2. /health responds 200 without authentication.
 *   3. The ApiKey contract on internal routes is honoured —
 *      missing header => 401, valid header => stub 501.
 *
 * Prisma and Redis are mocked because:
 *   • The smoke surface (controllers + filters + guards) does not
 *     hit either; the stubs throw NotImplementedException before
 *     any repository call.
 *   • CI doesn't have a logistics DB / Redis instance and
 *     installing them would balloon the test setup.
 *
 * Real DB-touching tests land in M1 next to the partner adapter PR
 * with testcontainers-managed Postgres + Redis.
 */
describe('logistics-facade — smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
      })
      .overrideProvider(RedisService)
      .useValue({
        getClient: () => ({
          ping: jest.fn().mockResolvedValue('PONG'),
          quit: jest.fn().mockResolvedValue('OK'),
        }),
      })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /health returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
      }),
    );
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('GET /internal/shipments/dummy without Authorization returns 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/internal/shipments/dummy',
    );
    expect(res.status).toBe(401);
    // RFC 7807 body
    expect(res.headers['content-type']).toEqual(
      expect.stringContaining('application/problem+json'),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 401,
        code: 'UNAUTHORIZED',
      }),
    );
  });

  it('GET /internal/shipments/dummy with a valid ApiKey returns 501 NotImplemented', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/shipments/dummy')
      .set('Authorization', `ApiKey ${process.env.INTERNAL_API_KEY}`);

    expect(res.status).toBe(501);
    expect(res.headers['content-type']).toEqual(
      expect.stringContaining('application/problem+json'),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 501,
        code: 'NOT_IMPLEMENTED',
        detail: expect.stringContaining('Stub'),
      }),
    );
  });

  it('GET /internal/shipments/dummy with a wrong ApiKey returns 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/shipments/dummy')
      .set('Authorization', 'ApiKey nope-this-is-not-the-key');

    expect(res.status).toBe(401);
  });

  it('GET /internal/shipments/dummy with a non-ApiKey scheme returns 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/shipments/dummy')
      .set('Authorization', `Bearer ${process.env.INTERNAL_API_KEY}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        detail: expect.stringContaining('ApiKey'),
      }),
    );
  });
});
