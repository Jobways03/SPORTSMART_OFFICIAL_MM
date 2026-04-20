import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { throttlingConfig } from './throttling.config';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: throttlingConfig.ttl * 1000,
          limit: throttlingConfig.limit,
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
