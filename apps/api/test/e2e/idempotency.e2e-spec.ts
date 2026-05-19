import 'reflect-metadata';
import {
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import { IdempotencyInterceptor } from '../../src/core/interceptors/idempotency.interceptor';
import { Idempotent } from '../../src/core/decorators/idempotent.decorator';
import { GlobalExceptionFilter } from '../../src/core/filters/global-exception.filter';
import { PrismaService } from '../../src/bootstrap/database/prisma.service';
import { EnvService } from '../../src/bootstrap/env/env.service';
import { AppLoggerService } from '../../src/bootstrap/logging/app-logger.service';
import { buildTestApp } from './helpers/test-app';

/**
 * Phase 4 / H46 lock-in — idempotent POST replay behaviour.
 *
 * Mounts a tiny `POST /api/v1/test/echo` route tagged with @Idempotent()
 * and stubs PrismaService.idempotencyKey + EnvService so the interceptor
 * runs the production code path against an in-memory fake. Asserts the
 * documented contract:
 *   - Flag-off  : pass-through (key ignored, every call hits handler)
 *   - Flag-on   : same key + same body → second call replays cached body
 *                 same key + different body → 409
 *                 missing/short key → 400
 *
 * Why an e2e rather than a unit test: the interceptor is wired through
 * Nest's RxJS pipe; only an HTTP-layer test catches drift in the pipe
 * shape (e.g. `of(undefined)` vs `next.handle()` selection).
 */

let handlerCalls = 0;

@Controller('test')
class TestEchoController {
  @Post('echo')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  echo(@Body() body: Record<string, unknown>) {
    handlerCalls += 1;
    return { echoed: body, callNumber: handlerCalls };
  }
}

interface FakeRow {
  id: string;
  key: string;
  actorType: string;
  actorId: string;
  endpoint: string;
  requestHash: string;
  state: 'PENDING' | 'COMPLETED';
  expiresAt: Date;
  responseStatus: number | null;
  responseBody: unknown;
  completedAt: Date | null;
}

function makeFakePrisma() {
  const store = new Map<string, FakeRow>();
  let idSeq = 0;
  return {
    store,
    idempotencyKey: {
      create: jest.fn(async ({ data, select }: { data: Omit<FakeRow, 'id' | 'responseStatus' | 'responseBody' | 'completedAt'>; select: { id: true } }) => {
        if (store.has(data.key)) {
          const err: Error & { code?: string; clientVersion?: string } =
            new Error('Unique constraint failed on key');
          err.code = 'P2002';
          err.clientVersion = 'test';
          Object.setPrototypeOf(err, require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype);
          throw err;
        }
        idSeq += 1;
        const row: FakeRow = {
          id: `fake-${idSeq}`,
          responseStatus: null,
          responseBody: null,
          completedAt: null,
          ...data,
        };
        store.set(data.key, row);
        return select?.id ? { id: row.id } : row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
        return store.get(where.key) ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        for (const row of store.values()) {
          if (row.id === where.id) {
            Object.assign(row, data);
            return row;
          }
        }
        throw new Error(`fake update miss: ${where.id}`);
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, row] of store.entries()) {
          if (row.id === where.id) {
            store.delete(k);
            return row;
          }
        }
        throw new Error(`fake delete miss: ${where.id}`);
      }),
    },
  };
}

function envStub(enabled: boolean) {
  return {
    getBoolean: jest.fn((name: string, dflt: boolean) =>
      name === 'IDEMPOTENCY_ENABLED' ? enabled : dflt,
    ),
    getString: jest.fn((_: string, dflt = '') => dflt),
    getNumber: jest.fn((name: string, dflt: number) =>
      name === 'IDEMPOTENCY_TTL_HOURS' ? 24 : dflt,
    ),
  } as unknown as EnvService;
}

const loggerStub = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as AppLoggerService;

function makeModule(prisma: ReturnType<typeof makeFakePrisma>, env: EnvService) {
  @Module({
    controllers: [TestEchoController],
    providers: [
      IdempotencyInterceptor,
      { provide: PrismaService, useValue: prisma },
      { provide: EnvService, useValue: env },
      { provide: AppLoggerService, useValue: loggerStub },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class TestIdempotencyModule {}
  return TestIdempotencyModule;
}

describe('POST /api/v1/test/echo — IDEMPOTENCY_ENABLED=false', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeAll(async () => {
    handlerCalls = 0;
    prisma = makeFakePrisma();
    app = await buildTestApp({
      imports: [makeModule(prisma, envStub(false))],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('passes through — header is ignored, handler runs every call', async () => {
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', 'flag-off-key-123')
      .send({ a: 1 });
    expect(r1.status).toBe(201);
    expect(r1.body.callNumber).toBe(1);

    const r2 = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', 'flag-off-key-123')
      .send({ a: 1 });
    expect(r2.status).toBe(201);
    expect(r2.body.callNumber).toBe(2);
    expect(prisma.store.size).toBe(0);
  });
});

describe('POST /api/v1/test/echo — IDEMPOTENCY_ENABLED=true', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeAll(async () => {
    handlerCalls = 0;
    prisma = makeFakePrisma();
    app = await buildTestApp({
      imports: [makeModule(prisma, envStub(true))],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('replays the cached body on a repeat call with same key + same body', async () => {
    const key = 'replay-key-aaaaaaaa';
    const body = { product: 'P1', quantity: 3 };

    const first = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.callNumber).toBe(1);

    const second = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', key)
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.callNumber).toBe(1);
    expect(handlerCalls).toBe(1);
  });

  it('rejects with 409 when the same key is reused with a different body', async () => {
    const key = 'mismatched-body-key-1';
    const first = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', key)
      .send({ a: 1 });
    expect(first.status).toBe(201);

    const conflict = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', key)
      .send({ a: 2 });
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.body)).toMatch(/different request body/i);
  });

  it('rejects with 400 when the X-Idempotency-Key header is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ a: 1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/X-Idempotency-Key.*required/i);
  });

  it('rejects with 400 when the key is shorter than 8 chars', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .set('X-Idempotency-Key', 'short')
      .send({ a: 1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/between 8 and 128/i);
  });
});
