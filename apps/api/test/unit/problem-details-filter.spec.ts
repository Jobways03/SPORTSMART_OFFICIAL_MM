import 'reflect-metadata';
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from '../../src/core/filters/global-exception.filter';
import {
  PROBLEM_TYPES,
  problemTypeUri,
} from '../../src/core/filters/problem-types';
import {
  AppException,
  BadRequestAppException,
  ConflictAppException,
  DuplicateCaseException,
  ForbiddenAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '../../src/core/exceptions';

/**
 * Unit tests for the dual-shape GlobalExceptionFilter (PR 1.3).
 *
 * Covers:
 *   - Legacy emit (PROBLEM_DETAILS_ENABLED=false) — keeps the existing
 *     { success, message, code, timestamp } shape that frontends parse.
 *   - RFC 7807 emit (flag=true) — { type, title, status, detail,
 *     instance, code, errors[] } with application/problem+json.
 *   - Stable type URIs for AppException codes.
 *   - class-validator BadRequest gets expanded into errors[] with field
 *     names parsed from messages.
 *   - Prisma errors translate to the right HTTP code + slug.
 *   - Both modes share normalization (one bug surface, two emit paths).
 */
describe('GlobalExceptionFilter', () => {
  const BASE_URI = 'https://api.sportsmart.com/problems';

  function buildFilter(opts: { problemDetailsEnabled: boolean }) {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as never;
    const env = {
      getBoolean: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'PROBLEM_DETAILS_ENABLED'
            ? opts.problemDetailsEnabled
            : false,
        ),
      getString: jest.fn().mockReturnValue(BASE_URI),
    } as never;
    return new GlobalExceptionFilter(logger, env);
  }

  function buildHost(opts: { url?: string } = {}): {
    host: ArgumentsHost;
    res: { status: jest.Mock; header: jest.Mock; json: jest.Mock };
    req: { url?: string; originalUrl?: string };
  } {
    const json = jest.fn();
    const header = jest.fn(() => ({ json }));
    const status = jest.fn(() => ({ json, header }));
    const res = { status, json, header };
    const req = {
      url: opts.url ?? '/api/v1/customer/returns',
      originalUrl: opts.url ?? '/api/v1/customer/returns',
    };
    const host: ArgumentsHost = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as never;
    return { host, res, req };
  }

  // ─── Legacy emit ──────────────────────────────────────────────────

  describe('emit: legacy (PROBLEM_DETAILS_ENABLED=false)', () => {
    it('emits the {success,message,code,timestamp} shape for an AppException', () => {
      const filter = buildFilter({ problemDetailsEnabled: false });
      const { host, res } = buildHost();
      filter.catch(new ConflictAppException('Already exists'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: ['Already exists'],
          code: 'CONFLICT',
        }),
      );
      // Legacy mode does NOT set application/problem+json.
      expect(res.header).not.toHaveBeenCalled();
    });

    it('still expands class-validator errors[] in legacy mode', () => {
      const filter = buildFilter({ problemDetailsEnabled: false });
      const { host, res } = buildHost();
      const exc = new BadRequestException({
        message: ['email must be an email', 'password should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      });
      filter.catch(exc, host);
      const body = res.json.mock.calls[0][0];
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'password' }),
        ]),
      );
    });
  });

  // ─── RFC 7807 emit ────────────────────────────────────────────────

  describe('emit: RFC 7807 (PROBLEM_DETAILS_ENABLED=true)', () => {
    it('sets the application/problem+json content type', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      filter.catch(new NotFoundAppException('Return not found'), host);
      expect(res.header).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json',
      );
    });

    it('emits {type, title, status, detail, instance, code} for an AppException', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost({ url: '/api/v1/admin/returns/abc' });
      filter.catch(new ForbiddenAppException('Insufficient permission'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      const body = res.json.mock.calls[0][0];
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.forbidden));
      expect(body.title).toBe('Forbidden');
      expect(body.status).toBe(403);
      expect(body.detail).toBe('Insufficient permission');
      expect(body.instance).toBe('/api/v1/admin/returns/abc');
      expect(body.code).toBe('FORBIDDEN');
      expect(typeof body.timestamp).toBe('string');
    });

    it('expands class-validator BadRequestException into errors[]', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      const exc = new BadRequestException({
        message: [
          'subOrderId must be a UUID',
          'items should not be empty',
          'forfeitConsent must be a boolean value',
        ],
        error: 'Bad Request',
        statusCode: 400,
      });
      filter.catch(exc, host);
      const body = res.json.mock.calls[0][0];
      expect(body.type).toBe(
        problemTypeUri(BASE_URI, PROBLEM_TYPES.validation),
      );
      expect(body.title).toBe('Validation Failed');
      expect(body.status).toBe(400);
      expect(body.errors).toHaveLength(3);
      expect(body.errors[0]).toEqual({
        field: 'subOrderId',
        message: 'subOrderId must be a UUID',
      });
      expect(body.errors[1]).toEqual({
        field: 'items',
        message: 'items should not be empty',
      });
    });

    it('maps Prisma P2002 to a CONFLICT problem-type', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      const err = new Prisma.PrismaClientKnownRequestError(
        'unique constraint failed',
        { code: 'P2002', clientVersion: 'test' } as never,
      );
      filter.catch(err, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = res.json.mock.calls[0][0];
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.conflict));
      expect(body.code).toBe('CONFLICT');
    });

    it('maps Prisma P2025 to a NOT_FOUND problem-type', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      const err = new Prisma.PrismaClientKnownRequestError(
        'record not found',
        { code: 'P2025', clientVersion: 'test' } as never,
      );
      filter.catch(err, host);
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe(404);
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.notFound));
    });

    it('falls back to the internal slug for unmapped Prisma codes', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      const err = new Prisma.PrismaClientKnownRequestError(
        'something exotic',
        { code: 'P9999', clientVersion: 'test' } as never,
      );
      filter.catch(err, host);
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe(500);
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.internal));
    });

    it('emits 500 + internal slug for unknown exceptions', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      filter.catch(new Error('boom'), host);
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe(500);
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.internal));
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('emits duplicateOfId + rule extensions for DuplicateCaseException', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      filter.catch(
        new DuplicateCaseException(
          'An active return already exists',
          'RET-2026-001234',
          'ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM',
        ),
        host,
      );
      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body.type).toBe(problemTypeUri(BASE_URI, PROBLEM_TYPES.duplicateCase));
      expect(body.code).toBe('DUPLICATE_CASE');
      expect(body.title).toBe('Duplicate Case');
      // Extension members travel through the body un-namespaced.
      expect(body.duplicateOfId).toBe('RET-2026-001234');
      expect(body.rule).toBe('ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM');
    });

    it('round-trips an HttpException with a string body', () => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      filter.catch(
        new HttpException('teapot is short and stout', HttpStatus.I_AM_A_TEAPOT),
        host,
      );
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe(418);
      expect(body.detail).toBe('teapot is short and stout');
    });
  });

  // ─── Type URI stability ───────────────────────────────────────────

  describe('problem-type URIs', () => {
    it.each([
      ['NOT_FOUND', new NotFoundAppException('x'), PROBLEM_TYPES.notFound],
      ['UNAUTHORIZED', new UnauthorizedAppException('x'), PROBLEM_TYPES.unauthorized],
      ['FORBIDDEN', new ForbiddenAppException('x'), PROBLEM_TYPES.forbidden],
      ['CONFLICT', new ConflictAppException('x'), PROBLEM_TYPES.conflict],
      ['BAD_REQUEST', new BadRequestAppException('x'), PROBLEM_TYPES.badRequest],
    ])('maps %s code to the expected slug', (_, exception, slug) => {
      const filter = buildFilter({ problemDetailsEnabled: true });
      const { host, res } = buildHost();
      filter.catch(exception, host);
      const body = res.json.mock.calls[0][0];
      expect(body.type).toBe(problemTypeUri(BASE_URI, slug));
    });
  });

  // ─── Backwards compat (no env service) ────────────────────────────

  describe('no EnvService injected', () => {
    it('falls back to legacy emit (default)', () => {
      const logger = {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as never;
      const filter = new GlobalExceptionFilter(logger);
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));
      const res = { status, json, header: jest.fn() };
      const host: ArgumentsHost = {
        switchToHttp: () => ({
          getRequest: () => ({ url: '/x', originalUrl: '/x' }),
          getResponse: () => res,
        }),
      } as never;
      filter.catch(new ConflictAppException('x'), host);
      // Legacy: header not set, body shape is {success, message, code}
      expect(res.header).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, code: 'CONFLICT' }),
      );
    });
  });
});

class ChildAppException extends AppException {
  constructor(message: string) {
    super(message, 'CUSTOM_DOMAIN_ERROR');
  }
}

describe('GlobalExceptionFilter — unmapped AppException codes', () => {
  const BASE_URI = 'https://api.sportsmart.com/problems';

  it('falls back to status-derived slug for unknown app exception codes', () => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as never;
    const env = {
      getBoolean: jest.fn().mockReturnValue(true),
      getString: jest.fn().mockReturnValue(BASE_URI),
    } as never;
    const filter = new GlobalExceptionFilter(logger, env);

    const json = jest.fn();
    const header = jest.fn(() => ({ json }));
    const status = jest.fn(() => ({ json, header }));
    const res = { status, json, header };
    const host: ArgumentsHost = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/x', originalUrl: '/x' }),
        getResponse: () => res,
      }),
    } as never;

    filter.catch(new ChildAppException('exotic'), host);
    const body = res.json.mock.calls[0][0];
    // Unknown app code with no APP_CODE_TO_PROBLEM_SLUG entry → 500 →
    // internal slug (see slugForStatus default).
    expect(body.status).toBe(500);
    expect(body.code).toBe('CUSTOM_DOMAIN_ERROR');
    expect(body.type).toContain(PROBLEM_TYPES.internal);
  });
});
