import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppLoggerService } from './app-logger.service';

const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Trust an upstream request id when present (load balancer, API
    // gateway, or chained service) so one id flows end-to-end. If the
    // client sends a nonsense long value, truncate — we don't want a
    // 4KB id showing up in every downstream log line. Generate a fresh
    // UUID if nothing usable was supplied.
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && typeof incoming === 'string' && incoming.length > 0
        ? incoming.slice(0, 128)
        : randomUUID();

    (req as Request & { id?: string }).id = requestId;
    // Echo in the response so clients can correlate their retries /
    // support requests with our server logs.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms req=${requestId}`,
        'HTTP',
      );
    });

    next();
  }
}
