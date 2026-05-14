import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { DuplicateCaseException } from '../exceptions/duplicate-case.exception';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../bootstrap/env/env.service';
import {
  APP_CODE_TO_PROBLEM_SLUG,
  PROBLEM_TYPES,
  ProblemTypeSlug,
  problemTypeUri,
} from './problem-types';

/**
 * Internal canonical error shape that both the legacy and RFC 7807
 * emit paths build from. Keeps the translation logic flag-agnostic.
 */
interface NormalizedError {
  status: number;
  /** Stable code matching APP_CODE_TO_PROBLEM_SLUG keys. */
  code: string;
  /** Short-and-stable summary, suitable as the `title` field. */
  title: string;
  /** Human-readable detail; may include user-supplied text. */
  detail: string;
  /** Optional override for the problem-type slug (e.g. idempotency.* override the generic CONFLICT). */
  problemSlug?: ProblemTypeSlug;
  /** Validation field-level breakdown (RFC 7807 `errors` extension). */
  errors?: Array<{ field: string; message: string; code?: string }>;
  /** Free-form RFC 7807 extension members (e.g. duplicateOfId). */
  extensions?: Record<string, unknown>;
}

/**
 * The single global error filter.
 *
 * Two emit modes, switched by `PROBLEM_DETAILS_ENABLED`:
 *
 *   OFF (default): legacy shape — `{ success, message, code, timestamp }`.
 *                  Backward-compatible with every existing frontend.
 *   ON  (PR 1.3+): RFC 7807 — `{ type, title, status, detail, instance,
 *                  code, errors[]? }` with `Content-Type:
 *                  application/problem+json`. Stable type URIs from
 *                  `problem-types.ts`.
 *
 * Both modes share `normalizeException()` so the translation logic only
 * lives in one place. The flag only controls the wire format.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly env?: EnvService,
  ) {
    this.logger.setContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Pulled set by RequestLoggingMiddleware on every request. Threaded
    // into normalizeException so internal error logs include req=<id>
    // and can be correlated with the [HTTP] line written on response
    // finish. Empty-string fallback keeps the log line shape stable
    // (`req=` with no value) when the filter is invoked outside the
    // HTTP context (e.g., from unit tests).
    const requestId = (request as Request & { id?: string })?.id ?? '';

    const normalized = this.normalizeException(exception, requestId);

    if (this.problemDetailsEnabled()) {
      this.emitProblemDetails(response, request, normalized);
    } else {
      this.emitLegacy(response, normalized);
    }
  }

  // ─── Translation (shared) ─────────────────────────────────────────

  private normalizeException(
    exception: unknown,
    requestId = '',
  ): NormalizedError {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (exception instanceof AppException) {
      return this.fromAppException(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception, requestId);
    }
    return this.fromUnknown(exception, requestId);
  }

  private fromHttpException(err: HttpException): NormalizedError {
    const status = err.getStatus();
    const body = err.getResponse();

    // class-validator surfaces validation failures as a BadRequestException
    // with `body = { message: string[], error: 'Bad Request', statusCode: 400 }`.
    // Detect that shape and expand into RFC 7807 `errors[]`.
    let errors: NormalizedError['errors'];
    let detail: string;
    if (
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as { message?: unknown }).message) &&
      status === HttpStatus.BAD_REQUEST
    ) {
      const rawMessages = (body as { message: string[] }).message;
      errors = rawMessages.map((m) => ({ field: this.parseField(m), message: m }));
      detail = `Validation failed (${rawMessages.length} issue${
        rawMessages.length === 1 ? '' : 's'
      })`;
      return {
        status,
        code: 'VALIDATION_FAILED',
        title: 'Validation Failed',
        detail,
        problemSlug: PROBLEM_TYPES.validation,
        errors,
      };
    }

    detail =
      typeof body === 'string'
        ? body
        : (body as Record<string, unknown>)?.message as string ||
          err.message;
    return {
      status,
      code: 'HTTP_ERROR',
      title: this.titleForStatus(status),
      detail,
    };
  }

  private fromAppException(err: AppException): NormalizedError {
    const status = this.mapAppExceptionToStatus(err.code);
    const base: NormalizedError = {
      status,
      code: err.code,
      title: this.titleForCode(err.code, status),
      detail: err.message,
    };
    // DuplicateCaseException carries `duplicateOfId` + `rule` — surface
    // them as RFC 7807 extension members so clients can deep-link to
    // the existing active case without re-running the rule themselves.
    if (err instanceof DuplicateCaseException) {
      base.extensions = {
        duplicateOfId: err.duplicateOfId,
        rule: err.rule,
      };
    }
    return base;
  }

  private fromPrismaError(
    err: Prisma.PrismaClientKnownRequestError,
    requestId = '',
  ): NormalizedError {
    // Log the raw Prisma message + meta server-side; client only sees
    // the sanitized version. Prisma messages leak table / column names
    // which are noise in customer-facing error UI. req=<id> matches the
    // request id the request-logging middleware writes on response
    // finish so error + HTTP lines correlate by grep.
    this.logger.warn(
      `Prisma error ${err.code}: ${err.message.split('\n')[0]} | meta=${JSON.stringify(err.meta ?? {})} req=${requestId}`,
    );

    switch (err.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          title: 'Conflict',
          detail: 'A record with these details already exists',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'The requested record was not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'BAD_REQUEST',
          title: 'Bad Request',
          detail: 'A referenced record does not exist',
        };
      case 'P2014':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'BAD_REQUEST',
          title: 'Bad Request',
          detail: 'The operation would break a required relation',
        };
      default:
        this.logger.error(
          `Unmapped Prisma error ${err.code}: ${err.message} req=${requestId}`,
          err.stack,
        );
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_ERROR',
          title: 'Internal Server Error',
          detail: 'Internal server error',
        };
    }
  }

  private fromUnknown(
    exception: unknown,
    requestId = '',
  ): NormalizedError {
    this.logger.error(
      `Unhandled exception: ${
        exception instanceof Error ? exception.message : String(exception)
      } req=${requestId}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      title: 'Internal Server Error',
      detail: 'Internal server error',
    };
  }

  // ─── Emit: RFC 7807 ───────────────────────────────────────────────

  private emitProblemDetails(
    response: Response,
    request: Request,
    err: NormalizedError,
  ): void {
    const baseUri =
      this.env?.getString('PROBLEM_DETAILS_BASE_URI', 'https://api.sportsmart.com/problems') ??
      'https://api.sportsmart.com/problems';

    const slug =
      err.problemSlug ??
      APP_CODE_TO_PROBLEM_SLUG[err.code] ??
      this.slugForStatus(err.status);

    const body: Record<string, unknown> = {
      type: problemTypeUri(baseUri, slug),
      title: err.title,
      status: err.status,
      detail: err.detail,
      instance: request.originalUrl ?? request.url ?? '',
      code: err.code,
      timestamp: new Date().toISOString(),
    };
    if (err.errors && err.errors.length > 0) {
      // RFC 7807 §3.2 allows extension members. `errors` is the
      // de-facto convention (used by the JSON:API spec, ASP.NET Core's
      // ProblemDetails, the rfc-7807-extensions IETF draft).
      body.errors = err.errors;
    }
    // Extension members (e.g. duplicateOfId, rule). Merged last so a
    // domain extension can't accidentally overwrite the canonical
    // type / title / status fields above.
    if (err.extensions) {
      for (const [k, v] of Object.entries(err.extensions)) {
        if (
          k !== 'type' && k !== 'title' && k !== 'status' &&
          k !== 'detail' && k !== 'instance' && k !== 'errors'
        ) {
          body[k] = v;
        }
      }
    }

    response
      .status(err.status)
      .header('Content-Type', 'application/problem+json')
      .json(body);
  }

  // ─── Emit: legacy ─────────────────────────────────────────────────

  private emitLegacy(response: Response, err: NormalizedError): void {
    response.status(err.status).json({
      success: false,
      message: Array.isArray(err.detail) ? err.detail : [err.detail],
      code: err.code,
      timestamp: new Date().toISOString(),
      ...(err.errors ? { errors: err.errors } : {}),
      ...(err.extensions ?? {}),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private problemDetailsEnabled(): boolean {
    return this.env?.getBoolean('PROBLEM_DETAILS_ENABLED', false) ?? false;
  }

  private mapAppExceptionToStatus(code: string): number {
    const map: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
      FORBIDDEN: HttpStatus.FORBIDDEN,
      CONFLICT: HttpStatus.CONFLICT,
      DUPLICATE_CASE: HttpStatus.CONFLICT,
      DOMAIN_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
      BAD_REQUEST: HttpStatus.BAD_REQUEST,
      EXTERNAL_SERVICE_ERROR: HttpStatus.BAD_GATEWAY,
      // Phase 7 (PR 7.3) — file-URL audit rate limit, plus a reusable
      // 429 surface for any future rate-limited domain code.
      TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
      // Phase 0 (PR 0.1) — gateway-payment verification codes. All map to
      // 400 because they represent client-facing "your call cannot be
      // accepted" outcomes rather than server-side faults. The specific
      // code surfaces in the response body so frontends / Razorpay's
      // own retry logic can branch on it.
      GATEWAY_PAYMENT_NOT_CAPTURED: HttpStatus.BAD_REQUEST,
      GATEWAY_ORDER_ID_MISMATCH: HttpStatus.BAD_REQUEST,
      GATEWAY_AMOUNT_MISMATCH: HttpStatus.BAD_REQUEST,
    };
    return map[code] || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private titleForCode(code: string, status: number): string {
    switch (code) {
      case 'NOT_FOUND':
        return 'Not Found';
      case 'UNAUTHORIZED':
        return 'Unauthorized';
      case 'FORBIDDEN':
        return 'Forbidden';
      case 'CONFLICT':
        return 'Conflict';
      case 'DUPLICATE_CASE':
        return 'Duplicate Case';
      case 'DOMAIN_ERROR':
        return 'Unprocessable Entity';
      case 'BAD_REQUEST':
        return 'Bad Request';
      case 'EXTERNAL_SERVICE_ERROR':
        return 'Upstream Service Error';
      default:
        return this.titleForStatus(status);
    }
  }

  private titleForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Unprocessable Entity';
      case 429:
        return 'Too Many Requests';
      case 502:
        return 'Bad Gateway';
      case 503:
        return 'Service Unavailable';
      default:
        return status >= 500 ? 'Internal Server Error' : 'Error';
    }
  }

  private slugForStatus(status: number): ProblemTypeSlug {
    switch (status) {
      case 400:
        return PROBLEM_TYPES.badRequest;
      case 401:
        return PROBLEM_TYPES.unauthorized;
      case 403:
        return PROBLEM_TYPES.forbidden;
      case 404:
        return PROBLEM_TYPES.notFound;
      case 409:
        return PROBLEM_TYPES.conflict;
      case 422:
        return PROBLEM_TYPES.unprocessable;
      case 429:
        return PROBLEM_TYPES.rateLimited;
      case 502:
        return PROBLEM_TYPES.badGateway;
      default:
        return PROBLEM_TYPES.internal;
    }
  }

  /**
   * class-validator messages look like "subOrderId must be a UUID".
   * The first whitespace-bounded token is the field name when the
   * validator put it there. Best-effort — we still ship the full
   * message in `message` so clients aren't left guessing.
   */
  private parseField(message: string): string {
    const m = message.match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
    return m ? m[1] : 'unknown';
  }
}
