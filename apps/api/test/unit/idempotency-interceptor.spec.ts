import 'reflect-metadata';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../src/core/interceptors/idempotency.interceptor';
import { IDEMPOTENT_KEY } from '../../src/core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../src/core/exceptions';

/**
 * Unit tests for IdempotencyInterceptor.
 *
 * The interceptor is responsible for:
 *   1. No-op when feature flag is OFF.
 *   2. No-op when handler is not @Idempotent().
 *   3. Validate the X-Idempotency-Key header (format, length).
 *   4. Atomically claim the key via INSERT; on collision resolve the
 *      existing row (replay / pending / hash mismatch).
 *   5. Persist the response on handler success; release on handler error.
 */

describe('IdempotencyInterceptor', () => {
  let prismaMock: {
    idempotencyKey: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let envMock: { getBoolean: jest.Mock; getNumber: jest.Mock };
  let loggerMock: { setContext: jest.Mock; log: jest.Mock; error: jest.Mock };
  let reflector: Reflector;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    prismaMock = {
      idempotencyKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    envMock = {
      getBoolean: jest.fn().mockReturnValue(true),
      getNumber: jest.fn().mockReturnValue(24),
    };
    loggerMock = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    reflector = new Reflector();
    interceptor = new IdempotencyInterceptor(
      reflector,
      prismaMock as any,
      envMock as any,
      loggerMock as any,
    );
  });

  const buildContext = (opts: {
    isIdempotent: boolean;
    headers?: Record<string, string>;
    body?: unknown;
    method?: string;
    path?: string;
    actor?: { type: string; id: string };
    ip?: string;
  }): { ctx: ExecutionContext; res: any } => {
    const res = {
      statusCode: 200,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const req: Record<string, unknown> = {
      headers: opts.headers ?? {},
      body: opts.body ?? {},
      method: opts.method ?? 'POST',
      path: opts.path ?? '/customer/returns',
      route: { path: opts.path ?? '/customer/returns' },
    };
    if (opts.actor?.type === 'CUSTOMER') req.userId = opts.actor.id;
    if (opts.ip) req.ip = opts.ip;

    const handler: any = function namedHandler() {};
    if (opts.isIdempotent) {
      Reflect.defineMetadata(IDEMPOTENT_KEY, true, handler);
    }

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => handler,
      getClass: () => class Dummy {},
    } as unknown as ExecutionContext;

    return { ctx, res };
  };

  const buildHandler = (returnValue: unknown): CallHandler => ({
    handle: () => of(returnValue),
  });

  // ─── Pass-through paths ───────────────────────────────────────────

  it('passes through when the flag is OFF', async () => {
    envMock.getBoolean.mockReturnValue(false);
    const { ctx } = buildContext({ isIdempotent: true });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, buildHandler({ ok: 1 })),
    );
    expect(result).toEqual({ ok: 1 });
    expect(prismaMock.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('passes through when the handler is not @Idempotent()', async () => {
    const { ctx } = buildContext({ isIdempotent: false });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, buildHandler({ ok: 1 })),
    );
    expect(result).toEqual({ ok: 1 });
    expect(prismaMock.idempotencyKey.create).not.toHaveBeenCalled();
  });

  // ─── Header validation ────────────────────────────────────────────

  // Header validation throws synchronously (before the rxjs pipeline),
  // which is correct: NestJS catches sync throws from interceptors the
  // same way it catches observable errors. We mirror that here.

  it('rejects missing X-Idempotency-Key header', () => {
    const { ctx } = buildContext({ isIdempotent: true });
    expect(() => interceptor.intercept(ctx, buildHandler({}))).toThrow(
      BadRequestAppException,
    );
  });

  it('rejects too-short keys', () => {
    const { ctx } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'tiny' },
    });
    expect(() => interceptor.intercept(ctx, buildHandler({}))).toThrow(
      BadRequestAppException,
    );
  });

  it('rejects keys with non-printable ASCII', () => {
    const { ctx } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'key\nwith\tcontrol' },
    });
    expect(() => interceptor.intercept(ctx, buildHandler({}))).toThrow(
      BadRequestAppException,
    );
  });

  // ─── Fresh request path ──────────────────────────────────────────

  it('claims the key, runs the handler, and persists the response on success', async () => {
    prismaMock.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prismaMock.idempotencyKey.update.mockResolvedValue({});
    const { ctx, res } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'idemkey-12345' },
      body: { foo: 'bar' },
      actor: { type: 'CUSTOMER', id: 'user-1' },
    });
    res.statusCode = 201;

    const result = await lastValueFrom(
      interceptor.intercept(ctx, buildHandler({ ok: 1 })),
    );

    expect(result).toEqual({ ok: 1 });
    expect(prismaMock.idempotencyKey.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.idempotencyKey.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        // Stored key is namespaced per actor (<type>:<id>:<clientKey>) to
        // prevent cross-actor collision on the global @unique; the raw actor
        // is still in the actorType/actorId columns.
        key: 'CUSTOMER:user-1:idemkey-12345',
        actorType: 'CUSTOMER',
        actorId: 'user-1',
        endpoint: 'POST /customer/returns',
        state: 'PENDING',
      }),
    );
    // Update is queued asynchronously inside `tap` — wait a microtask.
    await new Promise((r) => setImmediate(r));
    expect(prismaMock.idempotencyKey.update).toHaveBeenCalledWith({
      where: { id: 'idem-1' },
      data: expect.objectContaining({
        state: 'COMPLETED',
        responseStatus: 201,
        responseBody: { ok: 1 },
      }),
    });
  });

  it('namespaces the stored key per actor — same X-Idempotency-Key, different principals do NOT collide', async () => {
    // Regression for the cross-actor collision: with a global @unique on the
    // raw key, two authenticated principals reusing the same client key would
    // collide (replay one actor's response to the other, or 409). The stored
    // key is now <actorType>:<actorId>:<clientKey>.
    prismaMock.idempotencyKey.create.mockResolvedValue({ id: 'idem-x' });
    prismaMock.idempotencyKey.update.mockResolvedValue({});

    const sharedKey = 'shared-key-1234';
    const run = async (actorId: string) => {
      const { ctx } = buildContext({
        isIdempotent: true,
        headers: { 'x-idempotency-key': sharedKey },
        body: { foo: 'bar' },
        actor: { type: 'CUSTOMER', id: actorId },
      });
      await lastValueFrom(interceptor.intercept(ctx, buildHandler({ ok: 1 })));
    };

    await run('user-1');
    await run('user-2');

    const storedKeys = prismaMock.idempotencyKey.create.mock.calls.map(
      (c) => c[0].data.key,
    );
    expect(storedKeys).toEqual([
      'CUSTOMER:user-1:shared-key-1234',
      'CUSTOMER:user-2:shared-key-1234',
    ]);
    expect(storedKeys[0]).not.toEqual(storedKeys[1]);
  });

  it('namespaces ANONYMOUS callers by client IP (no shared global anon namespace)', async () => {
    // POST /auth/register is @Idempotent AND unauthenticated → ANONYMOUS actor
    // (id '-'). Without IP discrimination every anon client would share one
    // namespace (cross-client 409 DoS). Same key + different IPs → distinct
    // stored keys.
    prismaMock.idempotencyKey.create.mockResolvedValue({ id: 'idem-a' });
    prismaMock.idempotencyKey.update.mockResolvedValue({});

    const sharedKey = 'anon-key-1234';
    const run = async (ip: string) => {
      const { ctx } = buildContext({
        isIdempotent: true,
        headers: { 'x-idempotency-key': sharedKey },
        body: { foo: 'bar' },
        ip, // no actor → ANONYMOUS
      });
      await lastValueFrom(interceptor.intercept(ctx, buildHandler({ ok: 1 })));
    };

    await run('1.1.1.1');
    await run('2.2.2.2');

    const storedKeys = prismaMock.idempotencyKey.create.mock.calls.map(
      (c) => c[0].data.key,
    );
    expect(storedKeys).toEqual([
      'ANONYMOUS:1.1.1.1:anon-key-1234',
      'ANONYMOUS:2.2.2.2:anon-key-1234',
    ]);
  });

  it('releases the claim if the handler throws', async () => {
    prismaMock.idempotencyKey.create.mockResolvedValue({ id: 'idem-2' });
    prismaMock.idempotencyKey.delete.mockResolvedValue({});
    const { ctx } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'idemkey-67890' },
      actor: { type: 'CUSTOMER', id: 'user-1' },
    });
    const failingHandler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, failingHandler)),
    ).rejects.toThrow('boom');

    await new Promise((r) => setImmediate(r));
    expect(prismaMock.idempotencyKey.delete).toHaveBeenCalledWith({
      where: { id: 'idem-2' },
    });
    expect(prismaMock.idempotencyKey.update).not.toHaveBeenCalled();
  });

  // ─── Replay path ─────────────────────────────────────────────────

  it('returns the cached response on hash match (replay)', async () => {
    const collisionErr = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      { code: 'P2002', clientVersion: 'test' } as any,
    );
    prismaMock.idempotencyKey.create.mockRejectedValue(collisionErr);
    // Hash for POST /customer/returns body {"foo":"bar"} is the same as
    // the body we send below, so we don't need to hand-compute it.
    prismaMock.idempotencyKey.findUnique.mockImplementation(async () => ({
      id: 'idem-3',
      state: 'COMPLETED',
      responseStatus: 200,
      responseBody: { cached: true },
      requestHash: '__will_be_overridden__',
    }));

    const { ctx, res } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'replay-key-001' },
      body: { foo: 'bar' },
      actor: { type: 'CUSTOMER', id: 'user-1' },
    });

    // Patch findUnique to echo back the same hash the interceptor
    // computes for this request, so the replay path is taken.
    prismaMock.idempotencyKey.findUnique.mockImplementation(async () => {
      // Reach into the just-attempted create() args to pull the hash.
      const createCall =
        prismaMock.idempotencyKey.create.mock.calls[0]?.[0]?.data;
      return {
        id: 'idem-3',
        state: 'COMPLETED',
        responseStatus: 200,
        responseBody: { cached: true },
        requestHash: createCall?.requestHash ?? 'unknown',
      };
    });

    const result = await lastValueFrom(
      interceptor.intercept(ctx, buildHandler({ shouldNotRun: true })),
    );

    expect(result).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it('rejects a hash mismatch with 409', async () => {
    const collisionErr = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      { code: 'P2002', clientVersion: 'test' } as any,
    );
    prismaMock.idempotencyKey.create.mockRejectedValue(collisionErr);
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-4',
      state: 'COMPLETED',
      responseStatus: 200,
      responseBody: { cached: true },
      requestHash: 'a-completely-different-hash',
    });

    const { ctx } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'mismatch-key-001' },
      body: { foo: 'bar' },
      actor: { type: 'CUSTOMER', id: 'user-1' },
    });

    await expect(
      lastValueFrom(interceptor.intercept(ctx, buildHandler({}))),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('returns 409 when an in-flight request is still PENDING', async () => {
    const collisionErr = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      { code: 'P2002', clientVersion: 'test' } as any,
    );
    prismaMock.idempotencyKey.create.mockRejectedValue(collisionErr);
    prismaMock.idempotencyKey.findUnique.mockImplementation(async () => {
      const createCall =
        prismaMock.idempotencyKey.create.mock.calls[0]?.[0]?.data;
      return {
        id: 'idem-5',
        state: 'PENDING',
        responseStatus: null,
        responseBody: null,
        requestHash: createCall?.requestHash ?? 'unknown',
      };
    });

    const { ctx } = buildContext({
      isIdempotent: true,
      headers: { 'x-idempotency-key': 'pending-key-001' },
      body: { foo: 'bar' },
      actor: { type: 'CUSTOMER', id: 'user-1' },
    });

    await expect(
      lastValueFrom(interceptor.intercept(ctx, buildHandler({}))),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});
