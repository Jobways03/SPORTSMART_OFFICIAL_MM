import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PROBLEM_TYPES, ProblemTypeSlug, problemTypeUri } from './problem-types';
import { RequestContextService } from '../../bootstrap/logging/request-context';

/**
 * RFC 7807 problem-details filter. Every error response from the
 * facade flows through here so the wire shape stays uniform:
 *
 *   {
 *     "type":   "https://sportsmart.com/problems/<slug>",
 *     "title":  "<short stable summary>",
 *     "status": <int>,
 *     "detail": "<long human-readable message>",
 *     "instance": "<request path>",
 *     "code":   "<APP_CODE>",
 *     "errors": [{ field, message }]?,
 *     "requestId": "<x-request-id>"
 *   }
 *
 * Content-Type is `application/problem+json` so partner clients can
 * route problem responses through a single deserializer.
 *
 * Apps/api has a flag-gated dual path (legacy `{success,message,...}`
 * + RFC 7807). The facade is new — it ships RFC 7807 from day one.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const normalised = this.normalise(exception);

    // Log 5xx with stack — 4xx is expected traffic, log at debug.
    if (normalised.status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${normalised.status} ${normalised.code}: ${normalised.detail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.debug(
        `${req.method} ${req.originalUrl} -> ${normalised.status} ${normalised.code}: ${normalised.detail}`,
      );
    }

    const requestId = RequestContextService.requestId() ?? (req.headers['x-request-id'] as string | undefined);

    res
      .status(normalised.status)
      .setHeader('Content-Type', 'application/problem+json')
      .json({
        type: problemTypeUri(normalised.slug),
        title: normalised.title,
        status: normalised.status,
        detail: normalised.detail,
        instance: req.originalUrl,
        code: normalised.code,
        requestId,
        ...(normalised.errors ? { errors: normalised.errors } : {}),
      });
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string; errors?: unknown[] };

      const detail =
        typeof response === 'string'
          ? response
          : Array.isArray(response.message)
            ? response.message.join('; ')
            : (response.message ?? response.error ?? exception.message);

      return {
        status,
        code: this.codeForStatus(status),
        title: this.titleForStatus(status),
        slug: this.slugForStatus(status),
        detail: String(detail),
        errors: typeof response === 'object' && Array.isArray((response as { errors?: unknown }).errors)
          ? ((response as { errors: Array<{ field?: string; message?: string }> }).errors.map((e) => ({
              field: String(e.field ?? ''),
              message: String(e.message ?? ''),
            })))
          : undefined,
      };
    }

    // Unknown error class — surface as 500 but hide the message.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      title: 'Internal server error',
      slug: PROBLEM_TYPES.internal,
      detail:
        exception instanceof Error
          ? exception.message
          : 'An unexpected error occurred',
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST: return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED: return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN: return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND: return 'NOT_FOUND';
      case HttpStatus.CONFLICT: return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY: return 'UNPROCESSABLE';
      case HttpStatus.TOO_MANY_REQUESTS: return 'RATE_LIMITED';
      case HttpStatus.NOT_IMPLEMENTED: return 'NOT_IMPLEMENTED';
      case HttpStatus.BAD_GATEWAY: return 'UPSTREAM_GATEWAY_ERROR';
      default: return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
    }
  }

  private titleForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST: return 'Bad request';
      case HttpStatus.UNAUTHORIZED: return 'Unauthorized';
      case HttpStatus.FORBIDDEN: return 'Forbidden';
      case HttpStatus.NOT_FOUND: return 'Not found';
      case HttpStatus.CONFLICT: return 'Conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY: return 'Unprocessable entity';
      case HttpStatus.TOO_MANY_REQUESTS: return 'Too many requests';
      case HttpStatus.NOT_IMPLEMENTED: return 'Not implemented';
      case HttpStatus.BAD_GATEWAY: return 'Upstream gateway error';
      default: return status >= 500 ? 'Internal server error' : 'Error';
    }
  }

  private slugForStatus(status: number): ProblemTypeSlug {
    switch (status) {
      case HttpStatus.BAD_REQUEST: return PROBLEM_TYPES.badRequest;
      case HttpStatus.UNAUTHORIZED: return PROBLEM_TYPES.unauthorized;
      case HttpStatus.FORBIDDEN: return PROBLEM_TYPES.forbidden;
      case HttpStatus.NOT_FOUND: return PROBLEM_TYPES.notFound;
      case HttpStatus.CONFLICT: return PROBLEM_TYPES.conflict;
      case HttpStatus.UNPROCESSABLE_ENTITY: return PROBLEM_TYPES.unprocessable;
      case HttpStatus.TOO_MANY_REQUESTS: return PROBLEM_TYPES.rateLimited;
      case HttpStatus.NOT_IMPLEMENTED: return PROBLEM_TYPES.notImplemented;
      case HttpStatus.BAD_GATEWAY: return PROBLEM_TYPES.badGateway;
      default: return status >= 500 ? PROBLEM_TYPES.internal : PROBLEM_TYPES.badRequest;
    }
  }
}

interface NormalisedError {
  status: number;
  code: string;
  title: string;
  slug: ProblemTypeSlug;
  detail: string;
  errors?: Array<{ field: string; message: string }>;
}
