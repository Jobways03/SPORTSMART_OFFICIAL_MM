import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';

/**
 * Phase 1 (PR 1.7) — fenced lock release.
 *
 * The plain `acquireLock` / `releaseLock` pair below has a small race
 * window: a holder whose lock has expired (TTL ran out mid-work) can
 * `DEL` a key that a SUBSEQUENT acquirer has since taken. The next
 * tick then finds the key gone and acquires a "fresh" lock — except
 * the previous holder is still running, so two replicas execute the
 * critical section concurrently.
 *
 * The fenced variants close this. Each acquirer writes a per-acquire
 * UUID as the lock value. Release is a Lua CAS:
 *
 *   if redis.call('GET', KEYS[1]) == ARGV[1] then
 *     return redis.call('DEL', KEYS[1])  -- delete only our own lock
 *   else
 *     return 0                            -- someone else holds it now
 *   end
 *
 * Atomic on the Redis server. A late release-after-expiry returns 0
 * and leaves the new holder's lock untouched.
 */
const RELEASE_LOCK_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

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

  /** Release a distributed lock — UNFENCED. Prefer `releaseLockWithToken`. */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Phase 1 (PR 1.7) — fenced acquire.
   *
   * Returns `{ acquired, token }`. When `acquired === true`, the
   * caller must pass `token` back to `releaseLockWithToken` to
   * release. The token is a UUID v4 minted per acquire so a stale
   * release can never delete a successor's lock.
   *
   * When `acquired === false`, `token` is `null` — there's nothing
   * to release. Caller should skip the body and move on.
   */
  async acquireLockWithToken(
    key: string,
    ttlSeconds: number,
  ): Promise<{ acquired: boolean; token: string | null }> {
    const token = randomUUID();
    const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') return { acquired: true, token };
    return { acquired: false, token: null };
  }

  /**
   * Phase 1 (PR 1.7) — fenced release.
   *
   * Atomically delete the lock iff the current value matches the
   * supplied token. Returns true if we actually deleted (the lock
   * was still ours), false if not (TTL expired and someone else
   * acquired since, or the lock was already released).
   *
   * Best-effort behavior on Redis errors: log + return false. The
   * lock TTL will eventually expire even if release fails.
   */
  async releaseLockWithToken(key: string, token: string): Promise<boolean> {
    if (!token) return false; // defensive — empty token would match nothing
    try {
      const deleted = await this.client.eval(
        RELEASE_LOCK_LUA,
        1, // numkeys
        key,
        token,
      );
      return deleted === 1 || deleted === '1';
    } catch (err) {
      this.logger.error(
        `releaseLockWithToken failed for ${key}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
