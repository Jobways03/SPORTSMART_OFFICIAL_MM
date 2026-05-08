import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor';
import { IdempotencySweeperCron } from './idempotency-sweeper.cron';

/**
 * Wires the idempotency feature into the app:
 *   - Global APP_INTERCEPTOR — runs on every request, but no-ops
 *     unless the handler is decorated with @Idempotent() AND the
 *     IDEMPOTENCY_ENABLED env flag is true.
 *   - Sweeper cron — periodic cleanup of expired/orphan rows.
 *
 * No request-scoped state is held in memory; the entire feature is
 * driven by the idempotency_keys table.
 */
@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    IdempotencySweeperCron,
  ],
})
export class IdempotencyModule {}
