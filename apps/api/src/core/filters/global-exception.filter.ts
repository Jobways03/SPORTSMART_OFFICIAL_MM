import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
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
}
