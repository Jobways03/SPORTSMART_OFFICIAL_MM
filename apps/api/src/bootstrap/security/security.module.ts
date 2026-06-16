import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisService } from '../cache/redis.service';
import { throttlingConfig } from './throttling.config';

@Global()
@Module({
  imports: [
    // Redis-backed throttler storage so the rate limit is SHARED across all
    // ECS replicas. With the default in-memory store each of the 2–6 API
    // replicas keeps its own counter and every @Throttle limit is silently
    // multiplied by the live replica count (a real bypass). Reuses the
    // existing singleton ioredis client (RedisModule is @Global); the storage
    // does NOT own that client, so it won't quit it on shutdown.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          {
            ttl: throttlingConfig.ttl * 1000,
            limit: throttlingConfig.limit,
          },
        ],
        storage: new ThrottlerStorageRedisService(redis.getClient()),
      }),
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
