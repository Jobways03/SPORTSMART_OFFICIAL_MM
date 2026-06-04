import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';

/**
 * Single ioredis client used for:
 *   • Inbound webhook dedup via SET NX (modules/webhooks).
 *   • Readiness check (PING) in the health controller.
 *   • Future: leader-elected cron locks, idempotency cache.
 *
 * The connection is lazy — ioredis dials on first command, not on
 * construction. We force an early ping in onModuleInit so a misconfigured
 * Redis URL surfaces during boot rather than on the first hot request.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LogisticsRedisService');
  private readonly client: Redis;

  constructor(env: EnvService) {
    this.client = new Redis(env.getString('LOGISTICS_REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log('Logistics Redis connected');
    } catch (error) {
      this.logger.error(
        `Logistics Redis connection failed: ${error instanceof Error ? error.message : error}`,
      );
      this.logger.warn(
        'App will start but webhook dedup will fail until the connection is available',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // ignore — best-effort cleanup
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
