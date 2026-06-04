import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CatalogCacheService } from '../services/catalog-cache.service';

/**
 * Phase 195 (#16) — the storefront product-list / search cache keys by query
 * params but not by live stock, so a product going out of stock stayed
 * visible in cached results until the TTL lapsed. This invalidates the list
 * cache when a product transitions out of stock.
 *
 * Debounced to at most once per DEBOUNCE_MS: an out-of-stock storm (e.g. a
 * bulk stock sync) would otherwise wipe + re-stampede the cache repeatedly.
 * Only `out_of_stock` is consumed (not every `adjusted`) because that's the
 * transition that actually removes a product from in-stock-filtered lists;
 * routine quantity changes don't change list membership. Combined with the
 * 30s list TTL the effective staleness window is ≤ DEBOUNCE_MS.
 */
@Injectable()
export class StockCacheInvalidationHandler {
  private readonly logger = new Logger(StockCacheInvalidationHandler.name);
  private static readonly DEBOUNCE_MS = 10_000;
  private lastInvalidatedAt = 0;

  constructor(private readonly cache: CatalogCacheService) {}

  @OnEvent('inventory.stock.out_of_stock')
  async handleOutOfStock(): Promise<void> {
    const now = Date.now();
    if (now - this.lastInvalidatedAt < StockCacheInvalidationHandler.DEBOUNCE_MS) return;
    this.lastInvalidatedAt = now;
    try {
      await this.cache.invalidateProductLists();
    } catch (err) {
      this.logger.warn(`Product-list cache invalidation on out_of_stock failed: ${(err as Error).message}`);
    }
  }
}
