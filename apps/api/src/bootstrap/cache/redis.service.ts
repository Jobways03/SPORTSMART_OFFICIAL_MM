import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger('RedisService');

  constructor(private readonly envService: EnvService) {
    this.client = new Redis(this.envService.getString('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  getClient(): Redis {
    return this.client;
  }

  // ── Caching helpers ──────────────────────────────────────────────────

  /** Get cached value, or compute + cache it if missing */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.client.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      // Cache miss or parse error — fall through to factory
    }

    const value = await factory();
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Best-effort cache write
    }
    return value;
  }

  /** Set a value with TTL */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Get a cached value */
  async get<T>(key: string): Promise<T | null> {
    const cached = await this.client.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  }

  /** Delete a cached key */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Delete keys matching a pattern */
  async delPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  /** Acquire a distributed lock (returns true if acquired) */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Release a distributed lock */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
