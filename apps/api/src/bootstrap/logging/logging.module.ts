import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppLoggerService } from './app-logger.service';
import { RequestLoggingMiddleware } from './request-logging.middleware';

@Global()
@Module({
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*path');
  }
}
