import 'reflect-metadata';
import { HttpStatus, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from '../../src/core/filters/global-exception.filter';
import { NotFoundAppException } from '../../src/core/exceptions';

/**
 * Regression test for the global exception filter's Prisma branch.
 *
 * Before: PrismaClientKnownRequestError was not handled explicitly, so
 * a duplicate-key insert (P2002) that escaped a use-case's local
 * try/catch surfaced as a generic 500 "Internal server error" — both
 * misleading to API consumers (should be 409) and noisy in ops
 * dashboards that alert on 5xx rates. Record-not-found (P2025) had
 * the same problem.
 *
 * After: the filter maps the common Prisma error codes to the right
 * HTTP status + app error code, with generic user-facing messages so
 * we don't leak schema details (table / column names) to clients.
 * Unmapped Prisma codes are logged with full detail and still surface
 * a generic 500 so we don't silently hide a new class of DB error.
 */

describe('GlobalExceptionFilter — Prisma error translation', () => {
  const buildHarness = () => {
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const filter = new GlobalExceptionFilter(logger);

    const captured: { status?: number; body?: any } = {};
    const response: any = {
      status: (s: number) => {
        captured.status = s;
        return response;
      },
      json: (b: any) => {
        captured.body = b;
        return response;
      },
    };
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
      }),
    };

    return { filter, logger, host, captured };
  };

  const makePrismaError = (code: string, message = 'boom', meta: any = {}) =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: '5.0.0',
      meta,
    });

  it('maps P2002 unique-violation to 409 CONFLICT with a generic message', () => {
    const { filter, host, captured, logger } = buildHarness();
    filter.catch(
      makePrismaError(
        'P2002',
        'Unique constraint failed on fields: (`email`)',
        { target: ['email'] },
      ),
      host,
    );

    expect(captured.status).toBe(HttpStatus.CONFLICT);
    expect(captured.body).toMatchObject({
      success: false,
      code: 'CONFLICT',
    });
    // The user-facing message must NOT include the column name — that's
    // what makes the filter safe for public-facing callers.
    const msg = (captured.body.message as string[]).join(' ');
    expect(msg).not.toMatch(/email/i);
    expect(msg).toMatch(/already exists/i);

    // We log the raw Prisma error with meta for ops — assert that the
    // warn call included the target so it shows up in log search.
    expect(logger.warn).toHaveBeenCalled();
    const warnArg = logger.warn.mock.calls[0][0];
    expect(warnArg).toContain('P2002');
    expect(warnArg).toContain('email');
  });

  it('maps P2025 record-not-found to 404 NOT_FOUND', () => {
    const { filter, host, captured } = buildHarness();
    filter.catch(
      makePrismaError(
        'P2025',
        'An operation failed because it depends on one or more records that were required but not found.',
      ),
      host,
    );

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.code).toBe('NOT_FOUND');
    expect((captured.body.message as string[])[0]).toMatch(/not found/i);
  });

  it('maps P2003 foreign-key violation to 400 BAD_REQUEST', () => {
    const { filter, host, captured } = buildHarness();
    filter.catch(makePrismaError('P2003'), host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.code).toBe('BAD_REQUEST');
  });

  it('maps P2014 required-relation violation to 400 BAD_REQUEST', () => {
    const { filter, host, captured } = buildHarness();
    filter.catch(makePrismaError('P2014'), host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.code).toBe('BAD_REQUEST');
  });

  it('falls back to 500 INTERNAL_ERROR for unmapped Prisma codes', () => {
    const { filter, host, captured, logger } = buildHarness();
    filter.catch(makePrismaError('P9999', 'some novel prisma failure'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.code).toBe('INTERNAL_ERROR');
    // Unmapped codes MUST be logged at error level so a new DB failure
    // mode isn't silently masked.
    expect(logger.error).toHaveBeenCalled();
    const errorArg = logger.error.mock.calls[0][0];
    expect(errorArg).toContain('P9999');
  });

  it('still routes HttpException through the HTTP branch (not the Prisma branch)', () => {
    const { filter, host, captured } = buildHarness();
    filter.catch(new NotFoundException('widget missing'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.code).toBe('HTTP_ERROR');
  });

  it('still routes AppException through the AppException branch', () => {
    const { filter, host, captured } = buildHarness();
    filter.catch(new NotFoundAppException('missing thing'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.code).toBe('NOT_FOUND');
  });

  it('unknown non-HTTP, non-Prisma exceptions still become a generic 500', () => {
    const { filter, host, captured, logger } = buildHarness();
    filter.catch(new Error('unexpected'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });
});
