import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppLoggerService } from './app-logger.service';
import { RequestLoggingMiddleware } from './request-logging.middleware';
import { HttpErrorRateMonitor } from './http-error-rate-monitor';

/**
 * Phase 5 (PR 5.8) — `HttpErrorRateMonitor` rides alongside the
 * request-logging middleware. It listens for 5xx responses via the
 * middleware's finish hook and emits `http.error_rate.elevated`
 * events when bursts cross the configured threshold (default: 10
 * 5xx within 60s, 5-minute cooldown).
 */
@Global()
@Module({
  providers: [AppLoggerService, HttpErrorRateMonitor],
  exports: [AppLoggerService, HttpErrorRateMonitor],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*path');
  }
}
