import { Injectable } from '@nestjs/common';

/**
 * Phase 10 (PR 10.1) — Token-bucket rate limiter for API keys.
 *
 * In-memory per-pod. A multi-pod deploy gets per-pod buckets — for
 * abuse-prevention this is fine because the actual scrape-protection
 * line is in the load-balancer / WAF; this layer enforces fair-share
 * per-key behaviour.
 *
 * Bucket math: each key gets `rate` tokens replenished per minute,
 * up to a burst of 2× rate. Each request consumes 1 token; an
 * empty bucket denies until refill catches up.
 *
 * Per-key rate comes from `ApiKey.rateLimitPerMinute` (when set) or
 * the global default (`API_DEFAULT_RATE_PER_MINUTE`).
 */

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerMs: number; // tokens added per ms
  lastRefillMs: number;
}

@Injectable()
export class ApiKeyRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * Try to consume one token. Returns:
   *   - `{ allowed: true, remaining }` on success.
   *   - `{ allowed: false, retryAfterSeconds }` on deny.
   */
  consume(
    keyId: string,
    ratePerMinute: number,
  ): { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const refillPerMs = ratePerMinute / 60_000;
    const capacity = ratePerMinute * 2;

    let bucket = this.buckets.get(keyId);
    if (!bucket) {
      bucket = {
        tokens: capacity,
        capacity,
        refillPerMs,
        lastRefillMs: now,
      };
      this.buckets.set(keyId, bucket);
    } else if (
      bucket.refillPerMs !== refillPerMs ||
      bucket.capacity !== capacity
    ) {
      // Rate limit changed (admin edited the key). Resize the bucket
      // gracefully — don't reset tokens that the holder already has,
      // just clip to the new capacity.
      bucket.refillPerMs = refillPerMs;
      bucket.capacity = capacity;
      bucket.tokens = Math.min(bucket.tokens, capacity);
    }

    // Refill since last touch.
    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + elapsed * bucket.refillPerMs,
      );
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }

    // Out of tokens. Compute how long until 1 token regenerates.
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(tokensNeeded / bucket.refillPerMs);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  /** Test introspection. */
  bucketCount(): number {
    return this.buckets.size;
  }

  /** Test-only reset. */
  reset(): void {
    this.buckets.clear();
  }
}
