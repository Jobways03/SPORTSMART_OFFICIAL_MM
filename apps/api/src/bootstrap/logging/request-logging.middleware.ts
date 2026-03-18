import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppLoggerService } from './app-logger.service';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`,
        'HTTP',
      );
    });

    next();
  }
}
