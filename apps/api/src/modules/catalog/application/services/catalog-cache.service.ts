import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';

/**
 * Owns all caching policy for the Catalog module.
 * Controllers and services call this instead of touching Redis directly.
 */

const TTL = {
  PRODUCT_LIST: 30,   // 30 seconds — balances freshness with DB load
  PRODUCT_DETAIL: 60, // 60 seconds — detail pages change less frequently
  // Phase 40 (2026-05-21) — storefront filter list. 60s matches the
  // categories + brands cache. Invalidated immediately by any admin
  // filter-config mutation or metafield filterable-flag toggle.
  FILTER_LIST: 60,
} as const;

const PREFIX = 'catalog:cache:';

@Injectable()
export class CatalogCacheService {
  constructor(private readonly redis: RedisService) {}

  /** Get or compute cached product list result */
  async getOrSetProductList<T>(
    params: Record<string, any>,
    factory: () => Promise<T>,
  ): Promise<T> {
    // Build cache key from all params to ensure uniqueness
    const parts = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v ?? ''}`)
      .join(':');
    const key = `${PREFIX}products:${parts}`;
    return this.redis.getOrSet(key, TTL.PRODUCT_LIST, factory);
  }

  /** Get or compute cached product detail result */
  async getOrSetProductDetail<T>(slug: string, factory: () => Promise<T>): Promise<T> {
    const key = `${PREFIX}product:${slug}`;
    return this.redis.getOrSet(key, TTL.PRODUCT_DETAIL, factory);
  }

  /** Invalidate product list cache (e.g., after stock change or product update) */
  async invalidateProductLists(): Promise<void> {
    await this.redis.delPattern(`${PREFIX}products:*`);
  }

  /** Invalidate a specific product detail cache */
  async invalidateProductDetail(slug: string): Promise<void> {
    await this.redis.del(`${PREFIX}product:${slug}`);
  }

  /** Invalidate all catalog caches */
  async invalidateAll(): Promise<void> {
    await this.redis.delPattern(`${PREFIX}*`);
  }

  /**
   * Phase 40 (2026-05-21) — storefront filter list cache. Keyed by the
   * filter-resolution inputs (categoryId, collectionId, search, active
   * filter values). Each unique combination gets its own slot; the
   * `delPattern` in invalidateFilters wipes them all on admin write.
   */
  async getOrSetFilters<T>(
    params: Record<string, unknown>,
    factory: () => Promise<T>,
  ): Promise<T> {
    const parts = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v ?? ''}`)
      .join(':');
    const key = `${PREFIX}filters:${parts}`;
    return this.redis.getOrSet(key, TTL.FILTER_LIST, factory);
  }

  async invalidateFilters(): Promise<void> {
    await this.redis.delPattern(`${PREFIX}filters:*`);
  }
}
