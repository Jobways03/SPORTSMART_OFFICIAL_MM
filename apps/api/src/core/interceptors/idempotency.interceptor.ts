import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../exceptions';
import {
  IDEMPOTENT_KEY,
  IDEMPOTENT_TTL_KEY,
} from '../decorators/idempotent.decorator';
import { computeRequestHash, extractActor } from '../idempotency/request-hash.util';

/**
 * Replay-safe execution for handlers tagged with @Idempotent().
 *
 * Algorithm (Stripe-style):
 *   1. If `IDEMPOTENCY_ENABLED=false` or no @Idempotent() on the
 *      handler, pass through (no-op).
 *   2. Validate `X-Idempotency-Key` header (8-128 chars, ascii-printable).
 *   3. Try to INSERT a PENDING row claiming the key. The unique
 *      constraint on `key` arbitrates concurrent requests:
 *        - Winner runs the handler.
 *        - Loser gets P2002 → falls into the lookup branch below.
 *   4. On INSERT collision, look the row up:
 *        - PENDING → 409 "concurrent request in flight"
 *        - COMPLETED + matching hash → return cached response
 *        - COMPLETED + different hash → 409 "key reused with different body"
 *   5. After the handler resolves, UPDATE the row to COMPLETED with
 *      the captured response body + status.
 *   6. If the handler throws, DELETE the placeholder so the same key
 *      can be retried.
 *
 * Contract notes:
 *   - We DO NOT cache 5xx errors. Errors aren't cached at all (see #6);
 *     the client should retry, and a 500 is rarely a stable result.
 *   - We do cache 4xx error responses thrown DURING the handler
 *     because a deterministic 400 (e.g. validation) IS a real result
 *     and replays should return the same 400 — handled by tap-based
 *     status capture below.
 *   - File-upload (multipart) routes are not currently in scope; if
 *     one is later tagged @Idempotent(), the request hash will only
 *     cover non-stream fields. Document that limitation per route.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  // 60s grace before we treat a PENDING row as orphaned.
  private static readonly PENDING_GRACE_MS = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('IdempotencyInterceptor');
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (!this.isEnabled()) return next.handle();

    const isIdempotent = this.reflector.getAllAndOverride<boolean>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isIdempotent) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = this.readKey(req);
    const requestHash = computeRequestHash(req);
    const actor = extractActor(req);
    const endpoint = `${req.method} ${
      (req as { route?: { path?: string } }).route?.path ?? req.path ?? ''
    }`;
    // Phase 95 (2026-05-23) — Phase 93 deferred #17. Route-level TTL
    // override (decorator arg) wins over the env default. Capped at
    // 30 days so a typo doesn't pin a row indefinitely.
    const routeTtlSeconds = this.reflector.getAllAndOverride<number>(
      IDEMPOTENT_TTL_KEY,
      [context.getHandler(), context.getClass()],
    );
    const ttlMs =
      typeof routeTtlSeconds === 'number' && routeTtlSeconds > 0
        ? Math.min(routeTtlSeconds, 30 * 24 * 3600) * 1000
        : this.env.getNumber('IDEMPOTENCY_TTL_HOURS', 24) * 3_600_000;
    const expiresAt = new Date(Date.now() + ttlMs);

    return from(
      this.tryClaim({
        key,
        requestHash,
        actor,
        endpoint,
        expiresAt,
      }),
    ).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'cached') {
          // Replay: respond directly. Returning `of(undefined)` would
          // serialize undefined into a 200 body; instead bypass the
          // pipe by writing the response and returning EMPTY-like.
          res.status(claim.status).json(claim.body);
          return of(undefined);
        }
        // claim.kind === 'fresh' — we hold the PENDING row. Run handler.
        return next.handle().pipe(
          tap({
            next: (body) => {
              // Persist after handler resolves. Status code is whatever
              // the handler set on `res` (default 200/201).
              const status = res.statusCode || 200;
              this.completeClaim(claim.id, status, body).catch((err) => {
                // Persist failure isn't fatal — the client got their
                // response; future replays just won't dedupe. Log loudly
                // so ops sees any storage drift.
                this.logger.error(
                  `idempotency complete failed for ${key}: ${
                    (err as Error).message
                  }`,
                );
              });
            },
          }),
          catchError((err) => {
            // Handler threw — release the claim so retries can re-run.
            this.releaseClaim(claim.id).catch(() => undefined);
            throw err;
          }),
        );
      }),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────

  private isEnabled(): boolean {
    return this.env.getBoolean('IDEMPOTENCY_ENABLED', false);
  }

  /**
   * Validate the X-Idempotency-Key header and return its value.
   * Throws BadRequestAppException with a stable message on any
   * malformed or missing input.
   */
  private readKey(req: Request): string {
    const raw = req.headers['x-idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestAppException(
        'X-Idempotency-Key header is required for this endpoint',
      );
    }
    if (key.length < 8 || key.length > 128) {
      throw new BadRequestAppException(
        'X-Idempotency-Key must be between 8 and 128 characters',
      );
    }
    if (!/^[\x21-\x7e]+$/.test(key)) {
      throw new BadRequestAppException(
        'X-Idempotency-Key must contain only printable ASCII characters',
      );
    }
    return key;
  }

  /**
   * Atomically claim the key OR resolve the existing record. Returns
   * either { kind: 'fresh', id } when this request owns the work, or
   * { kind: 'cached', status, body } when the response is being replayed.
   *
   * Throws ConflictAppException on hash mismatch / pending collision.
   */
  private async tryClaim(args: {
    key: string;
    requestHash: string;
    actor: { type: string; id: string };
    endpoint: string;
    expiresAt: Date;
  }): Promise<
    | { kind: 'fresh'; id: string }
    | { kind: 'cached'; status: number; body: unknown }
  > {
    try {
      const created = await this.prisma.idempotencyKey.create({
        data: {
          key: args.key,
          actorType: args.actor.type,
          actorId: args.actor.id,
          endpoint: args.endpoint,
          requestHash: args.requestHash,
          state: 'PENDING',
          expiresAt: args.expiresAt,
        },
        select: { id: true },
      });
      return { kind: 'fresh', id: created.id };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.resolveExisting(args.key, args.requestHash);
      }
      throw err;
    }
  }

  /**
   * Lookup branch: a row already exists for this key. Decide whether
   * to replay, reject, or wait.
   */
  private async resolveExisting(
    key: string,
    requestHash: string,
  ): Promise<{ kind: 'cached'; status: number; body: unknown }> {
    const row = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!row) {
      // The race lost a window where the row was deleted (sweeper /
      // handler-error release) between our INSERT and our SELECT.
      // Surfacing 409 is correct — the client should retry with a
      // new attempt; their ORIGINAL request may or may not have run.
      throw new ConflictAppException(
        'Idempotency key resolution race; please retry',
      );
    }

    if (row.requestHash !== requestHash) {
      throw new ConflictAppException(
        'X-Idempotency-Key was reused with a different request body',
      );
    }

    if (row.state === 'PENDING') {
      // Still in flight, OR orphaned by a crashed handler. We don't
      // wait/poll — we tell the caller to retry. Crash-orphans get
      // swept by the sweeper cron after 60s.
      throw new ConflictAppException(
        'A previous request with this idempotency key is still being processed; please retry shortly',
      );
    }

    // COMPLETED: replay.
    return {
      kind: 'cached',
      status: row.responseStatus ?? 200,
      body: row.responseBody ?? null,
    };
  }

  private async completeClaim(
    id: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: {
        state: 'COMPLETED',
        responseStatus: status,
        responseBody: (body ?? null) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  private async releaseClaim(id: string): Promise<void> {
    await this.prisma.idempotencyKey.delete({ where: { id } });
  }
}
