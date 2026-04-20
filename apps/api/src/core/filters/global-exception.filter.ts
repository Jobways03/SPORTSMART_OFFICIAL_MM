import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let message: string;
    let code: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message as string ||
            exception.message;
      code = 'HTTP_ERROR';
    } else if (exception instanceof AppException) {
      status = this.mapAppExceptionToStatus(exception.code);
      message = exception.message;
      code = exception.code;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma errors that escape a use-case's local try/catch used to
      // fall into the else-branch and be returned as generic 500s —
      // which is both misleading to clients (a duplicate email should
      // be 409, not 500) and noisy in ops dashboards. Translate the
      // common ones here so the filter stays a proper safety net.
      const translated = this.translatePrismaError(exception);
      status = translated.status;
      message = translated.message;
      code = translated.code;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      code = 'INTERNAL_ERROR';
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      success: false,
      message: Array.isArray(message) ? message : [message],
      code,
      timestamp: new Date().toISOString(),
    });
  }

  private mapAppExceptionToStatus(code: string): number {
    const map: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
      FORBIDDEN: HttpStatus.FORBIDDEN,
      CONFLICT: HttpStatus.CONFLICT,
      DOMAIN_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
      BAD_REQUEST: HttpStatus.BAD_REQUEST,
      EXTERNAL_SERVICE_ERROR: HttpStatus.BAD_GATEWAY,
    };
    return map[code] || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private translatePrismaError(
    err: Prisma.PrismaClientKnownRequestError,
  ): { status: number; message: string; code: string } {
    // The message is intentionally generic — Prisma's own err.message
    // leaks table and column names, which is fine in server logs (we
    // log below) but noisy for customer-facing error UI. Meta fields
    // like `target` are the useful-for-logging bits.
    this.logger.warn(
      `Prisma error ${err.code}: ${err.message.split('\n')[0]} | meta=${JSON.stringify(err.meta ?? {})}`,
    );

    switch (err.code) {
      case 'P2002':
        // Unique constraint violation — caller probably meant CONFLICT.
        return {
          status: HttpStatus.CONFLICT,
          message: 'A record with these details already exists',
          code: 'CONFLICT',
        };
      case 'P2025':
        // "An operation failed because it depends on one or more records
        // that were required but not found."
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found',
          code: 'NOT_FOUND',
        };
      case 'P2003':
        // Foreign-key constraint violation.
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'A referenced record does not exist',
          code: 'BAD_REQUEST',
        };
      case 'P2014':
        // Change would violate a required relation.
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'The operation would break a required relation',
          code: 'BAD_REQUEST',
        };
      default:
        // Unmapped Prisma error — log in detail and surface a generic
        // 500 rather than the raw Prisma message.
        this.logger.error(
          `Unmapped Prisma error ${err.code}: ${err.message}`,
          err.stack,
        );
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        };
    }
  }
}
