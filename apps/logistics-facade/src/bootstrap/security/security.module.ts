import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * App-level security knobs:
 *   • A global throttler — 60 req/min/IP by default. Tighter than
 *     apps/api's customer-facing default because the facade only
 *     receives traffic from a handful of internal services.
 *   • Helmet + CORS are configured in main.ts (consistent with
 *     apps/api which also wires them at bootstrap rather than module
 *     time so the request flow runs them before Nest's routing layer).
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 60,
        },
      ],
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class SecurityModule {}
