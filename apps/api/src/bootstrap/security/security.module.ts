import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
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
})
export class SecurityModule {}
